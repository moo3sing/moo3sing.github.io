import unittest
from unittest.mock import patch
from datetime import datetime
from services.trackify import Trackify, forecast_reference, KST


class MonthlyTests(unittest.TestCase):
    def test_summary_and_missing_account_fallback_use_real_fields(self):
        api=Trackify()
        with patch.object(api,'get',side_effect=[
            {'periodType':'monthly','periodKey':'2026-09','items':[{'broadUserId':'a','uniqueViewers':872472}]},
            {'userId':'b','totalViewCountDelta':0,'monthDonors':999},
        ]) as get:
            result=api.monthly_users(['a','b'],'2026-09')
        self.assertEqual([r['recentMonthlyUsers'] for r in result['rows']],[872472,0])
        self.assertEqual(get.call_args_list[1].args[1],{'granularity':'day','period':'2026-09'})

    def test_missing_is_not_zero_and_wrong_period_rejected(self):
        api=Trackify()
        with patch.object(api,'get',side_effect=[{'periodType':'monthly','periodKey':'2026-09','items':[]},{'userId':'a'}]):
            result=api.monthly_users(['a'],'2026-09')
        self.assertEqual(result['rows'],[]);self.assertEqual(result['errors'][0]['soopId'],'a')
        with patch.object(api,'get',return_value={'periodType':'yearly','periodKey':'2026'}):
            with self.assertRaises(ValueError):api.monthly_users(['a'],'2026-09')

    def test_actual_previous_month_fallback_is_labelled(self):
        api=Trackify()
        with patch.object(api,'get',side_effect=[
            {'periodType':'monthly','periodKey':'2026-09','items':[]},
            {'userId':'a','totalViewCountDelta':None},
            {'userId':'a','totalViewCountDelta':None},
            {'userId':'a','totalViewCountDelta':2890762},
        ]):result=api.monthly_users(['a'],'2026-09')
        self.assertEqual(result['rows'][0]['referenceMonth'],'2026-07')
        self.assertTrue(result['rows'][0]['fallback'])
        self.assertEqual(result['rows'][0]['recentMonthlyUsers'],2890762)

    def test_partial_september_then_latest_completed_month(self):
        sep=forecast_reference(datetime(2026,9,30,tzinfo=KST))
        self.assertEqual(sep['referenceMonth'],'2026-09');self.assertTrue(sep['isPartial'])
        oct=forecast_reference(datetime(2026,10,1,tzinfo=KST))
        self.assertEqual(oct['referenceMonth'],'2026-09');self.assertFalse(oct['isPartial'])
        self.assertEqual(forecast_reference(datetime(2026,11,10,tzinfo=KST))['referenceMonth'],'2026-10')
