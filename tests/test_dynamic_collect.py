import copy,json,tempfile,unittest
from pathlib import Path
from datetime import datetime
from unittest.mock import Mock,patch
from services.trackify import KST
from scripts.dynamic_collect import dynamic_snapshot,annual_actual,daily_record,daily_observations
from scripts.collect import collect
ROOT=Path(__file__).resolve().parents[1]
class DynamicCollectorTests(unittest.TestCase):
    def setUp(self):
        self.old=json.loads((ROOT/'tests/fixtures/legacy-ranking.json').read_text())
        self.now=datetime(2026,10,15,12,tzinfo=KST)
        self.raw={r['soopId']:{'userId':r['soopId'],'totalViewCountDelta':r['cumulativeUsers'],'monthDonors':r['donorCount'],'monthBalloon':r['balloonCount'],'isBalloonHidden':r['status']=='unavailable'} for r in self.old['streamers']}
        self.api=Mock();self.api.overview.side_effect=lambda account:self.raw[account]
    def test_all_actual_metrics_update_but_baselines_do_not(self):
        for r in self.raw.values():
            r['totalViewCountDelta']+=100
            if not r['isBalloonHidden']:r['monthDonors']+=2;r['monthBalloon']+=500
        result=dynamic_snapshot(self.api,self.old,self.now)
        self.assertEqual(result['simulationBaseline'],self.old['simulationBaseline']);self.assertEqual(result['supportBaseline'],self.old['supportBaseline'])
        for a,b in zip(self.old['streamers'],result['streamers']):
            self.assertEqual(b['cumulativeUsers'],a['cumulativeUsers']+100)
            if a['status']=='ok':self.assertEqual(b['donorCount'],a['donorCount']+2);self.assertEqual(b['balloonCount'],a['balloonCount']+500)
        self.assertEqual(self.api.overview.call_count,100)
    def test_donor_only_change_detected(self):
        self.raw['singgyul']['monthDonors']+=1
        self.assertIsNotNone(dynamic_snapshot(self.api,self.old,self.now))
    def test_monthly_counts_never_added_and_lifetime_ignored(self):
        raw=self.raw['singgyul'];raw['cumulDonors']=999999
        base=next(r for r in self.old['simulationBaseline']['rows'] if r['soopId']=='singgyul')
        self.assertEqual(annual_actual(raw,base)['donorCount'],raw['monthDonors'])
    def test_zero_null_or_large_decrease_rejected(self):
        for key in ['totalViewCountDelta','monthDonors','monthBalloon']:
            for value in [0,None,int(self.raw['singgyul'][key]*.5)]:
                with self.subTest(key=key,value=value):
                    old=self.raw['singgyul'][key];self.raw['singgyul'][key]=value
                    with self.assertRaises(ValueError):dynamic_snapshot(self.api,self.old,self.now)
                    self.raw['singgyul'][key]=old
    def test_anomaly_keeps_public_snapshot_byte_identical(self):
        self.raw['singgyul']['monthDonors']=0
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'ranking.json';p.write_text(json.dumps(self.old));before=p.read_bytes()
            with patch('scripts.collect.Trackify',return_value=self.api),patch('scripts.collect.collection_date',return_value='2026-10-15'):
                self.assertFalse(collect(p,True,Path(folder)/'history'))
            self.assertEqual(p.read_bytes(),before);self.assertTrue((Path(folder)/'history/last-error.json').exists())
    def test_unchanged_retained_and_daily_record_still_available(self):
        self.assertIsNone(dynamic_snapshot(self.api,self.old,self.now))
        r=daily_record(self.old,self.old['targetResults'],self.now)
        self.assertEqual(len(r['rows']),100);self.assertEqual(set(r['targets']),{'rank','ratio','minmax'});self.assertIn('safeTarget',r)
    def test_unchanged_poll_creates_daily_history_without_public_rewrite(self):
        self.old['forecastAsOf']='2026-10-15'
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);p=root/'ranking.json';p.write_text(json.dumps(self.old));before=p.read_bytes()
            with patch('scripts.collect.Trackify',return_value=self.api),patch('scripts.collect.collection_date',return_value='2026-10-15'),patch('scripts.collect.calculate_targets',return_value=self.old['targetResults']):
                self.assertTrue(collect(p,True,root/'history'))
            self.assertEqual(p.read_bytes(),before)
            self.assertTrue((root/'history/daily/2026-10-15.json').exists())
    def test_api_failure_preserves_snapshot(self):
        self.api.overview.side_effect=TimeoutError('Trackify timeout')
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'ranking.json';p.write_text(json.dumps(self.old));before=p.read_bytes()
            with patch('scripts.collect.Trackify',return_value=self.api),patch('scripts.collect.collection_date',return_value='2026-10-15'):
                self.assertFalse(collect(p,True))
            self.assertEqual(p.read_bytes(),before)
    def test_new_kst_day_recomputes_forecast_even_with_unchanged_actuals(self):
        self.old['forecastAsOf']='2026-10-01'
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'ranking.json';p.write_text(json.dumps(self.old))
            with patch('scripts.collect.Trackify',return_value=self.api),patch('scripts.collect.calculate_targets',return_value=self.old['targetResults']) as report:
                self.assertTrue(collect(p,True,Path(folder)/'history'))
            result=json.loads(p.read_text());self.assertNotEqual(result['forecastAsOf'],'2026-10-01')
            self.assertEqual(result['streamers'],self.old['streamers']);self.assertEqual(result['simulationBaseline'],self.old['simulationBaseline'])
            self.assertEqual(result['updatedAt'],self.old['updatedAt']);report.assert_called_once()
            self.assertEqual(result['lastDataChangeAt'],self.old['lastDataChangeAt'])
    def test_daily_history_excludes_today_and_missing_dates_not_faked(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder);(p/'daily').mkdir()
            for day in ['2026-10-13','2026-10-15']:(p/'daily'/f'{day}.json').write_text(json.dumps({'date':day,'observedAt':day+'T12:00:00+09:00','rows':[]}))
            self.assertEqual(len(daily_observations(p,self.now)),1)
    def test_december_guard_before_any_api_call(self):
        with self.assertRaises(ValueError):dynamic_snapshot(self.api,self.old,datetime(2026,12,1,tzinfo=KST))
        self.api.overview.assert_not_called()
    def test_final_observation_november_only(self):
        r=dynamic_snapshot(self.api,self.old,datetime(2026,11,30,23,58,tzinfo=KST));self.assertIn('finalObservationAt',r)
