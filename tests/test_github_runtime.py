import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from urllib.error import HTTPError
from scripts.github_runtime import run_manual, run_collection, prepare_manual
from scripts import collect as collector
from services.trackify import KST
from scripts.viewer_adjustments import raw_previous

ROOT=Path(__file__).resolve().parents[1]
NOW=datetime(2026,11,2,12,0,tzinfo=KST)


class Clock(datetime):
    @classmethod
    def now(cls,tz=None):return NOW.astimezone(tz or timezone.utc)


class GitHubRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        for rel in ['assets/data/ranking.json','assets/data/collection-status.json','data/viewer-adjustments.json']:
            target=self.root/rel;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((ROOT/rel).read_bytes())
        (self.root/'state').mkdir();(self.root/'history').mkdir()
        self.old=json.loads((self.root/'assets/data/ranking.json').read_text())
        self.before=(self.root/'assets/data/ranking.json').read_bytes()
        self.policy=json.loads((self.root/'data/viewer-adjustments.json').read_text())
        for key in ['PRODUCTION_OUTPUT','BLOCK_STATE','DAILY_STATE']:
            value=getattr(collector,key)
            self.addCleanup(setattr,collector,key,value)

    def inputs(self):
        return dict(viewer=str(self.old['manualOverride']['rawViewer']+1000),
                    balloon=str(self.old['manualOverride']['metrics']['balloon']+500),donor='',now=NOW)

    def test_dry_run_writes_no_json_and_uses_raw_minus_existing_adjustment(self):
        before={str(p):p.read_bytes() for p in self.root.rglob('*.json')}
        with patch('services.trackify.Trackify',side_effect=AssertionError('No API in manual update')):
            result=run_manual(self.root,dry_run=True,**self.inputs())
        self.assertFalse(result['published']);self.assertEqual(result['viewerAdjustment'],-70000)
        self.assertEqual(result['adjustedViewer'],int(self.inputs()['viewer'])-70000)
        self.assertEqual(before,{str(p):p.read_bytes() for p in self.root.rglob('*.json')})

    def test_apply_preserves_donor_dates_competitors_baseline_and_raw_split(self):
        result=run_manual(self.root,dry_run=False,**self.inputs())
        self.assertTrue(result['published'])
        new=json.loads((self.root/'assets/data/ranking.json').read_text())
        old_target=next(r for r in self.old['streamers'] if r['soopId']=='singgyul')
        target=next(r for r in new['streamers'] if r['soopId']=='singgyul')
        self.assertEqual(target['metricObservedAt']['donorCount'],old_target['metricObservedAt']['donorCount'])
        self.assertEqual(target['donorCount'],old_target['donorCount'])
        self.assertEqual(new['manualOverride']['rawViewer'],int(self.inputs()['viewer']))
        self.assertEqual(new['manualOverride']['adjustedViewer'],target['cumulativeUsers'])
        self.assertEqual(new['simulationBaseline'],self.old['simulationBaseline'])
        self.assertEqual(new['rankingExceptions'],self.old['rankingExceptions'])
        self.assertNotIn('manualBatchOverride',new)
        old_rivals=[r for r in self.old['streamers'] if r['soopId']!='singgyul']
        self.assertEqual(old_rivals,[r for r in new['streamers'] if r['soopId']!='singgyul'])
        self.assertTrue(list((self.root/'history/manual').glob('*.json')))

    def test_existing_bot_policy_cannot_be_reset_by_default_or_reduced(self):
        with self.assertRaisesRegex(ValueError,'cannot be reset'):
            prepare_manual(self.old,self.policy,viewer_adjustment='0',**self.inputs())
        working,policy,summary=prepare_manual(self.old,self.policy,viewer_adjustment='-80000',reason='operator assumption',
            allow_correction=True,**self.inputs())
        self.assertEqual(summary['viewerAdjustment'],-80000)
        self.assertEqual(len(policy['viewerAdjustments']),len(self.policy['viewerAdjustments'])+1)
        self.assertEqual(working['manualOverride']['rawViewer'],int(self.inputs()['viewer']))

    def test_disabled_and_preview_collectors_make_zero_requests(self):
        with patch.object(collector,'Trackify',side_effect=AssertionError('No requests before handover')):
            result=run_collection(self.root,dry_run=True,enabled=True)
            result2=run_collection(self.root,dry_run=False,enabled=False)
        self.assertEqual(result['apiRequests'],0);self.assertEqual(result2['apiRequests'],0)
        self.assertEqual((self.root/'assets/data/ranking.json').read_bytes(),self.before)

    def test_429_aborts_once_persists_gate_and_never_changes_ranking(self):
        calls=[]
        class API:
            def __init__(self):self.requests=[]
            def overview(self,account):
                calls.append(account);self.requests.append({'httpStatus':429})
                raise HTTPError('https://example.invalid',429,'blocked',{'Retry-After':'3600'},io.BytesIO(b'{"message":"Blocked IP"}'))
            def request_report(self):return {'totalRequests':len(self.requests),'http429':len(self.requests),'requests':self.requests}
        with patch.object(collector,'Trackify',API),patch.object(collector,'datetime',Clock),\
             patch.object(collector,'collection_date',return_value='2026-11-02'),\
             patch('scripts.dynamic_collect.collection_date',return_value='2026-11-02'):
            result=run_collection(self.root,dry_run=False,enabled=True)
            with patch.object(collector,'Trackify',side_effect=AssertionError('Blocked gate must run before any request')):
                again=run_collection(self.root,dry_run=False,enabled=True)
        self.assertFalse(result['collectionOk']);self.assertEqual(calls,['singgyul'])
        self.assertEqual((self.root/'assets/data/ranking.json').read_bytes(),self.before)
        self.assertTrue((self.root/'state/trackify-block.json').exists())
        state=json.loads((self.root/'state/daily-collection.json').read_text())
        self.assertEqual(state['kstDate'],'2026-11-02');self.assertNotIn('requests',state['apiRequests'])
        self.assertEqual(again['collectionStatus'],'api_blocked')

    def test_validation_failure_never_publishes_changed_ranking(self):
        def corrupt(output,**kwargs):
            s=json.loads(output.read_text());s['simulationBaseline']['status']='bad';output.write_text(json.dumps(s))
            output.with_name('collection-status.json').write_text(json.dumps({'collectionStatus':'updated'}))
            return True
        with patch.object(collector,'collect',side_effect=corrupt):
            result=run_collection(self.root,dry_run=False,enabled=True)
        self.assertFalse(result['collectionOk'])
        self.assertEqual((self.root/'assets/data/ranking.json').read_bytes(),self.before)
        self.assertEqual(result['collectionStatus'],'validation_failed')

    def test_remote_gate_must_be_saved_before_any_api_request(self):
        with patch.dict('os.environ',{'PERSIST_DAILY_CLAIM':'true'}),\
             patch('scripts.github_runtime.persist_daily_claim',side_effect=RuntimeError('Push failed')) as save,\
             patch.object(collector,'datetime',Clock),\
             patch.object(collector,'Trackify',side_effect=AssertionError('No API before remote claim')):
            result=run_collection(self.root,dry_run=False,enabled=True)
        save.assert_called_once()
        self.assertFalse(result['collectionOk']);self.assertEqual(result['apiRequests'],0)
        self.assertEqual((self.root/'assets/data/ranking.json').read_bytes(),self.before)

    def test_success_uses_one_overview_per_candidate_then_daily_gate_stops_retries(self):
        calls=[]
        raw={}
        for row in self.old['streamers']:
            previous=raw_previous(self.old,row)
            raw[row['soopId']]={'userId':row['soopId'],'totalViewCountDelta':previous['cumulativeUsers']+100,
                'monthDonors':previous['donorCount'],'monthBalloon':previous['balloonCount'],
                'isBalloonHidden':row['status']=='unavailable'}
        class API:
            def __init__(self):self.requests=[]
            def overview(self,account):calls.append(account);self.requests.append({'account':account});return raw[account]
            def request_report(self):return {'totalRequests':len(calls),'http429':0,'requests':[]}
        with patch.object(collector,'Trackify',API),patch.object(collector,'datetime',Clock),\
             patch.object(collector,'collection_date',return_value='2026-11-02'),\
             patch('scripts.dynamic_collect.collection_date',return_value='2026-11-02'):
            result=run_collection(self.root,dry_run=False,enabled=True)
            with patch.object(collector,'Trackify',side_effect=AssertionError('Daily gate before requests')):
                again=run_collection(self.root,dry_run=False,enabled=True)
        self.assertTrue(result['collectionOk'])
        self.assertEqual(len(calls),100);self.assertEqual(len(set(calls)),100)
        new=json.loads((self.root/'assets/data/ranking.json').read_text())
        self.assertEqual(new['simulationBaseline'],self.old['simulationBaseline'])
        self.assertEqual(new['rankingExceptions'],self.old['rankingExceptions'])
        self.assertEqual(next(r for r in new['streamers'] if r['soopId']=='singgyul')['viewerAdjustmentTotal'],-70000)
        self.assertNotIn('manualBatchOverride',new)
        self.assertFalse(again['newAttempt']);self.assertEqual(again['apiRequests'],0)
        self.assertFalse(again['published'])

    def test_annual_input_cannot_read_files_outside_incoming(self):
        with self.assertRaisesRegex(ValueError,'inside data/incoming'):
            run_manual(self.root,mode='annual_batch',annual_table_path='../../credentials.txt',now=NOW)
