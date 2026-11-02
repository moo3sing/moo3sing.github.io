import copy,json,os,tempfile,unittest
from pathlib import Path
from datetime import datetime
from unittest.mock import Mock,patch
from scripts.source_corrections import confirm_correction
from scripts.dynamic_collect import annual_actual,dynamic_snapshot,calculate_targets
from scripts.collect import collect
from services.trackify import KST
ROOT=Path(__file__).resolve().parents[1]

class CorrectionTests(unittest.TestCase):
    def setUp(self):
        self.old=json.loads((ROOT/'tests/fixtures/legacy-ranking.json').read_text())
        self.base=next(r for r in self.old['simulationBaseline']['rows'] if r['soopId']=='sccha21')
        self.previous=next(r for r in self.old['streamers'] if r['soopId']=='sccha21')
        self.previous['balloonCount']=2318049
        self.raw={r['soopId']:{'userId':r['soopId'],'totalViewCountDelta':r['cumulativeUsers'],'monthDonors':r['donorCount'],'monthBalloon':r['balloonCount'],'isBalloonHidden':r['status']=='unavailable'} for r in self.old['streamers']}
        self.raw['sccha21']['monthBalloon']=2290254
        self.api=Mock();self.api.overview.side_effect=lambda account:copy.deepcopy(self.raw[account])
        self.api.get.return_value={'periodType':'yearly','periodKey':'2026','items':[{'broadUserId':'sccha21','balloon':2290254,'uniqueViewers':self.previous['cumulativeUsers']}]}
        self.sleep=patch('scripts.source_corrections.time.sleep');self.sleep.start();self.addCleanup(self.sleep.stop)
    def confirm(self):
        return confirm_correction(self.api,self.base,self.previous,annual_actual(self.raw['sccha21'],self.base),annual_actual)
    def test_A_stable_sccha21_correction_allowed_with_evidence(self):
        row,records=self.confirm();self.assertEqual(row['balloonCount'],2290254);self.assertEqual(self.api.overview.call_count,2)
        c=records[0];self.assertEqual(c['delta'],-27795);self.assertEqual(c['reason'],'source_correction');self.assertEqual(len(c['observations']),3)
        self.assertEqual(c['crossCheck']['value'],2290254)
        for k in ['streamerId','streamerName','metric','previous','current','firstDetectedTime','confirmedTime','source']:self.assertIn(k,c)
    def test_B_zero_blocked_without_confirmation(self):
        self.raw['sccha21']['monthBalloon']=0
        with self.assertRaises(ValueError):self.confirm()
        self.api.overview.assert_not_called()
    def test_C_null_blocked(self):
        self.raw['sccha21']['monthBalloon']=None
        with self.assertRaises(ValueError):self.confirm()
    def test_D_rebound_to_previous_is_unstable(self):
        stable=copy.deepcopy(self.raw['sccha21']);rebound={**stable,'monthBalloon':2318049}
        self.api.overview.side_effect=[stable,rebound]
        with self.assertRaisesRegex(ValueError,'unstable'):self.confirm()
    def test_changing_decreased_value_blocked(self):
        self.api.overview.side_effect=lambda _: {**self.raw['sccha21'],'monthBalloon':2290255}
        with self.assertRaisesRegex(ValueError,'unstable'):self.confirm()
    def test_large_decrease_blocked(self):
        self.raw['sccha21']['monthBalloon']=1000000
        with self.assertRaisesRegex(ValueError,'limits'):self.confirm()
    def test_timeout_during_recheck_blocked(self):
        self.api.overview.side_effect=TimeoutError('timeout')
        with self.assertRaises(TimeoutError):self.confirm()
    def test_parse_or_schema_failure_blocked(self):
        for raw in [None,[],{'userId':'sccha21'}, {**self.raw['sccha21'],'userId':'wrong'}]:
            self.api.overview.side_effect=None;self.api.overview.return_value=raw
            with self.assertRaises(ValueError):self.confirm()
    def test_summary_disagreement_and_wrong_period_blocked(self):
        for response in [{'periodType':'monthly','periodKey':'2026','items':[]},{'periodType':'yearly','periodKey':'2026','items':[{'broadUserId':'sccha21','balloon':2318049}]}]:
            self.api.get.return_value=response
            with self.assertRaises(ValueError):self.confirm()
    def test_viewer_and_donor_corrections_supported(self):
        for metric,field in [('cumulativeUsers','totalViewCountDelta'),('donorCount','monthDonors')]:
            raw={**self.raw['sccha21'],'monthBalloon':2318049,field:self.previous[metric]-1}
            self.api.overview.side_effect=lambda _,r=raw:dict(r)
            self.api.get.return_value={'periodType':'yearly','periodKey':'2026','items':[{'broadUserId':'sccha21','uniqueViewers':raw['totalViewCountDelta']}]}
            _,records=confirm_correction(self.api,self.base,self.previous,annual_actual(raw,self.base),annual_actual)
            self.assertEqual(records[0]['metric'],metric)
    def test_E_full_candidate_recalculation_archive_and_status(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'ranking.json';h=Path(folder)/'history';p.write_text(json.dumps(self.old))
            before=copy.deepcopy(self.old['simulationBaseline'])
            with patch('scripts.collect.Trackify',return_value=self.api):self.assertTrue(collect(p,True,h))
            published=json.loads(p.read_text());self.assertEqual(published['simulationBaseline'],before)
            self.assertEqual({r['soopId'] for r in published['streamers']},{r['soopId'] for r in self.old['streamers']})
            report=calculate_targets(ROOT,published,datetime.fromisoformat(published['updatedAt']))
            self.assertEqual(published['targetResults'],report);self.assertEqual(len(report['dynamic']['projectedRows']),98)
            self.assertEqual(len(report['dynamic']['models']),3);self.assertIsNotNone(report['dynamic']['safe'])
            records=list((h/'corrections').glob('*.json'));self.assertEqual(len(records),1)
            self.assertEqual(json.loads(records[0].read_text())['corrections'][0]['delta'],-27795)
            archives=[json.loads(x.read_text()) for x in h.glob('*.json')];self.assertIn(self.old,archives)
            status=json.loads(p.with_name('collection-status.json').read_text());self.assertEqual(status['collectionStatus'],'source_correction')
            original=p.read_bytes()
            with patch('scripts.collect.Trackify',return_value=self.api):self.assertTrue(collect(p,True,h))
            self.assertEqual(p.read_bytes(),original)
            status=json.loads(p.with_name('collection-status.json').read_text());self.assertEqual(status['collectionStatus'],'metrics_unchanged')
            self.raw['sccha21']['monthBalloon']=0
            with patch('scripts.collect.Trackify',return_value=self.api):self.assertFalse(collect(p,True,h))
            self.assertEqual(p.read_bytes(),original)
            failed=json.loads(p.with_name('collection-status.json').read_text());self.assertEqual(failed['collectionStatus'],'anomaly');self.assertEqual(failed['lastSuccessfulCollection'],status['lastSuccessfulCollection']);self.assertEqual(failed['lastDataChange'],status['lastDataChange'])
    def test_later_candidate_failure_cancels_confirmed_correction(self):
        self.raw['singgyul']['monthDonors']=None
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'ranking.json';p.write_text(json.dumps(self.old));before=p.read_bytes()
            with patch('scripts.collect.Trackify',return_value=self.api):self.assertFalse(collect(p,True,Path(folder)/'history'))
            self.assertEqual(p.read_bytes(),before);self.assertFalse((Path(folder)/'history/corrections').exists())
