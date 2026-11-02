import copy,io,json,tempfile,unittest
from datetime import datetime,timezone,timedelta
from pathlib import Path
from unittest.mock import Mock,patch
from urllib.error import HTTPError
from scripts.manual_update_singgyul import metric,run
from scripts.collect import collect
from scripts.trackify_block import active as active_block

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'tests/fixtures/legacy-ranking.json'

class ManualTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.addCleanup(self.folder.cleanup)
        self.root=Path(self.folder.name);self.output=self.root/'ranking.json';self.output.write_bytes(DATA.read_bytes())
        self.history=self.root/'history';self.backups=self.root/'backups'
        self.old=json.loads(self.output.read_text());self.prior=next(x for x in self.old['streamers'] if x['soopId']=='singgyul')
        self.now=datetime.now(timezone.utc)
        self.values={'viewer':self.prior['cumulativeUsers']+100,'donor':self.prior['donorCount']+2,'balloon':self.prior['balloonCount']+500}
    def call(self,values=None,**kw):return run(values or self.values,output=self.output,history=self.history,backups=self.backups,now=self.now,root=ROOT,**kw)
    def test_A_publish_and_full_recalculation(self):
        with patch('services.trackify.Trackify.get',side_effect=AssertionError('network forbidden')):
            result=self.call()
        published=json.loads(self.output.read_text());self.assertTrue(result['published'])
        self.assertEqual(published['collectionMode'],'manual_partial');self.assertEqual(published['actualDataScope'],'singgyul_only')
        self.assertEqual(published['simulationBaseline'],self.old['simulationBaseline'])
        self.assertEqual(published['supportBaseline'],self.old['supportBaseline'])
        self.assertEqual([r for r in published['streamers'] if r['soopId']!='singgyul'],[r for r in self.old['streamers'] if r['soopId']!='singgyul'])
        self.assertEqual(len(published['targetResults']['dynamic']['projectedRows']),98)
        self.assertEqual(set(result['models']),{'rank','ratio','minmax'});self.assertEqual(result['safeTarget'],max(result['models'].values()))
        self.assertEqual(result['competitorDataAsOf'],self.old['actualObservedAt'])
        self.assertEqual(next(x for x in published['targetResults']['dynamic']['projectedRows'] if x['soopId']=='singgyul')['forecast']['observedDate'],self.now.astimezone(timezone(timedelta(hours=9))).date().isoformat())
        rival=next(x for x in published['targetResults']['dynamic']['projectedRows'] if x['soopId']!='singgyul')
        self.assertEqual(rival['forecast']['observedDate'],datetime.fromisoformat(self.old['actualObservedAt']).astimezone(timezone(timedelta(hours=9))).date().isoformat())
        self.assertEqual(json.loads((self.history/'daily'/self.now.astimezone(timezone(timedelta(hours=9))).date().isoformat().__add__('.json')).read_text())['source'],'manual')
        self.assertEqual(len(list((self.history/'manual').glob('*.json'))),1)
        backup=list(self.backups.glob('manual-*'));self.assertEqual(len(backup),1);self.assertEqual((backup[0]/'ranking-before.json').read_bytes(),DATA.read_bytes())
        self.assertEqual(json.loads(self.output.with_name('collection-status.json').read_text())['collectionMode'],'manual_partial')
    def test_B_dry_run_never_publishes_or_creates_history(self):
        before=self.output.read_bytes()
        with patch('services.trackify.Trackify.get',side_effect=AssertionError('network forbidden')):result=self.call(dry_run=True)
        self.assertFalse(result['published']);self.assertEqual(self.output.read_bytes(),before)
        self.assertFalse(self.history.exists());self.assertFalse(self.backups.exists())
    def test_C_decrease_requires_explicit_flag(self):
        values={**self.values,'viewer':self.prior['cumulativeUsers']-1};before=self.output.read_bytes()
        with self.assertRaisesRegex(ValueError,'allow-correction'):self.call(values)
        self.assertEqual(self.output.read_bytes(),before)
    def test_D_manual_correction_history(self):
        values={**self.values,'viewer':self.prior['cumulativeUsers']-1};result=self.call(values,allow_correction=True)
        self.assertEqual(result['corrections'][0]['reason'],'manual_correction')
        record=json.loads(next((self.history/'manual-corrections').glob('*.json')).read_text())
        self.assertEqual(record['corrections'][0]['delta'],-1)
    def test_E_invalid_numbers_and_old_observation_blocked(self):
        for text in ['null','NaN','-1','1.2','9'*40]:
            with self.subTest(text=text):
                from argparse import ArgumentTypeError
                with self.assertRaises(ArgumentTypeError):metric(text)
        with self.assertRaises(ValueError):self.call({**self.values,'donor':None})
        with self.assertRaises(ValueError):self.call({**self.values,'balloon':0},allow_correction=True)
        with self.assertRaises(ValueError):self.call({**self.values,'viewer':1_000_000_001})
        with self.assertRaises(ValueError):self.call(observed_at='2026-10-01 00:00')
    def test_H_full_auto_replaces_manual_with_source_values(self):
        self.call();old=json.loads(self.output.read_text());raw={r['soopId']:{'userId':r['soopId'],'totalViewCountDelta':r['cumulativeUsers'],'monthDonors':r['donorCount'],'monthBalloon':r['balloonCount'],'isBalloonHidden':r['status']=='unavailable'} for r in self.old['streamers']}
        raw['singgyul']['totalViewCountDelta']+=1
        api=Mock();api.overview.side_effect=lambda account:copy.deepcopy(raw[account])
        with patch('scripts.collect.Trackify',return_value=api):self.assertTrue(collect(self.output,True,self.history,self.root/'empty-block.json'))
        published=json.loads(self.output.read_text());target=next(x for x in published['streamers'] if x['soopId']=='singgyul')
        self.assertEqual(target['cumulativeUsers'],self.prior['cumulativeUsers']+1)
        self.assertEqual(published['collectionMode'],'automatic');self.assertNotIn('manualOverride',published)
        self.assertEqual(published['actualDataScope'],'all_candidates');self.assertEqual(len(published['targetResults']['dynamic']['projectedRows']),98)
        self.assertEqual(api.overview.call_count,100);api.get.assert_not_called()
    def test_H_full_auto_clears_manual_even_if_source_matches_last_auto(self):
        self.call();raw={r['soopId']:{'userId':r['soopId'],'totalViewCountDelta':r['cumulativeUsers'],'monthDonors':r['donorCount'],'monthBalloon':r['balloonCount'],'isBalloonHidden':r['status']=='unavailable'} for r in self.old['streamers']}
        api=Mock();api.overview.side_effect=lambda account:copy.deepcopy(raw[account])
        with patch('scripts.collect.Trackify',return_value=api):self.assertTrue(collect(self.output,True,self.history,self.root/'empty-block.json'))
        published=json.loads(self.output.read_text());self.assertEqual(published['collectionMode'],'automatic');self.assertNotIn('manualOverride',published)
        self.assertEqual(next(x for x in published['streamers'] if x['soopId']=='singgyul')['cumulativeUsers'],self.prior['cumulativeUsers'])
    def test_I_429_preserves_manual_and_blocks_subsequent_api(self):
        self.call();before=self.output.read_bytes();error=HTTPError('https://www.trackify.kr/api/v1/p/soop/streamer/a',429,'Too Many Requests',{'Retry-After':'3600'},io.BytesIO(b'{"message":"Blocked IP","retryAfter":3600}'))
        api=Mock();api.overview.side_effect=error;state=self.root/'trackify-block.json'
        with patch('scripts.collect.Trackify',return_value=api):self.assertFalse(collect(self.output,True,self.history,state))
        self.assertEqual(self.output.read_bytes(),before);self.assertTrue(state.exists())
        self.assertEqual(json.loads(self.output.with_name('collection-status.json').read_text())['collectionStatus'],'api_blocked')
        api.reset_mock()
        with patch('scripts.collect.Trackify',return_value=api):self.assertTrue(collect(self.output,True,self.history,state))
        api.overview.assert_not_called();self.assertEqual(self.output.read_bytes(),before)
        self.assertEqual(json.loads(self.output.with_name('collection-status.json').read_text())['collectionStatus'],'api_blocked')
        self.assertIsNone(active_block(state,datetime.now(timezone.utc)+timedelta(hours=2)))

if __name__=='__main__':unittest.main()
