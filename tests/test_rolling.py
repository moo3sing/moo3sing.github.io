import copy,json,unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock,patch
from services.trackify import KST
from scripts.rolling_inputs import trend_selection,build_rolling_inputs,month_state
from scripts.growth_guard import confirm_growth
ROOT=Path(__file__).resolve().parents[1]
class RollingTests(unittest.TestCase):
    def test_three_month_daily_weights(self):
        r=trend_selection({'2026-07':310,'2026-08':620,'2026-09':900},1)
        self.assertEqual(r['daily'],23);self.assertEqual(r['weights'],[.2,.3,.5])
    def test_missing_july(self):
        r=trend_selection({'2026-08':620,'2026-09':900},1)
        self.assertEqual(r['daily'],26);self.assertEqual(r['weights'],[.4,.6])
    def test_only_september(self):
        r=trend_selection({'2026-09':900},1)
        self.assertEqual(r['daily'],30);self.assertEqual(r['weights'],[1])
    def test_missing_recent_keeps_legacy(self):
        self.assertEqual(trend_selection({'2026-07':310},7)['daily'],7)
    def test_monthly_api_failure_keeps_baseline_and_logs_fallback(self):
        old=json.loads((ROOT/'tests/fixtures/legacy-ranking.json').read_text());old.pop('rollingForecast',None);before=copy.deepcopy(old)
        api=Mock();api.get.side_effect=TimeoutError('unavailable');log=Mock()
        r=build_rolling_inputs(api,old,datetime(2026,10,2,tzinfo=KST),log)
        self.assertEqual(old,before);self.assertEqual(len(r['rows']),98);self.assertEqual(len(r['errors']),3)
        self.assertTrue(all(x['donorCount']['months']==[] for x in r['rows']));self.assertGreater(log.call_count,3)
    def test_oct31_anchor_uses_last_real_observation(self):
        row={'soopId':'a','cumulativeUsers':123,'donorCount':12,'balloonCount':456}
        old={'streamers':[row]};working=copy.deepcopy(old)
        month_state(working,old,datetime(2026,10,31,23,15,tzinfo=KST),[])
        next_state=copy.deepcopy(working);month_state(next_state,working,datetime(2026,11,1,tzinfo=KST),[])
        self.assertEqual(next_state['oct31Observation']['rows'],[row]);self.assertEqual(next_state['oct31Observation']['status'],'last_observation_not_exact_midnight')
    def test_missing_oct31_does_not_fabricate_anchor(self):
        old={'octoberObservation':{'observedAt':'2026-10-30T23:15:00+09:00','rows':[]}};result={}
        month_state(result,old,datetime(2026,11,2,tzinfo=KST),[])
        self.assertNotIn('oct31Observation',result);self.assertEqual(result['octoberObservation'],old['octoberObservation'])
    def growth(self,value=1500000,unstable=False,error=False,summary_bad=False):
        previous={'cumulativeUsers':1000000,'donorCount':100,'balloonCount':1000};current={**previous,'cumulativeUsers':value}
        api=Mock();api.overview.return_value={**current,'cumulativeUsers':value+(1 if unstable else 0)}
        if error:api.overview.side_effect=TimeoutError('timeout')
        api.get.return_value={'periodType':'yearly','periodKey':'2026','items':[{'broadUserId':'a','uniqueViewers':value+(1 if summary_bad else 0)}]}
        with patch('scripts.growth_guard.time.sleep'):
            result=confirm_growth(api,{'soopId':'a'},previous,current,lambda raw,base:raw,{},'2026-10-01T00:00:00+09:00',datetime(2026,10,2,tzinfo=KST))
        return api,result
    def test_verified_large_growth_retained_not_capped(self):
        api,(row,records)=self.growth();self.assertEqual(row['cumulativeUsers'],1500000);self.assertEqual(api.overview.call_count,2);self.assertEqual(records[0]['reason'],'verified_growth')
    def test_unstable_spike_blocked(self):
        with self.assertRaisesRegex(ValueError,'unstable'):self.growth(unstable=True)
    def test_spike_timeout_blocked(self):
        with self.assertRaises(TimeoutError):self.growth(error=True)
    def test_spike_cross_endpoint_disagreement_blocked(self):
        with self.assertRaisesRegex(ValueError,'disagreement'):self.growth(summary_bad=True)
    def test_small_growth_no_extra_requests(self):
        api,(_,records)=self.growth(value=1000100);api.overview.assert_not_called();self.assertEqual(records,[])
