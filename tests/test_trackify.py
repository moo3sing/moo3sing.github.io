import unittest
import io
from datetime import datetime, timezone
from unittest.mock import patch
from urllib.error import HTTPError
from services.trackify import normalize, select_candidates, collection_date, Trackify


class AdapterTests(unittest.TestCase):
    def test_sequential_request_spacing_does_not_add_requests_and_cache_needs_no_sleep(self):
        with patch('services.trackify.urlopen') as request,\
             patch('services.trackify.time.monotonic',side_effect=[100,100,100.1,102]),\
             patch('services.trackify.time.sleep') as sleep:
            response=request.return_value.__enter__.return_value
            response.status=200;response.read.return_value=b'{"value":1}'
            api=Trackify();api.get('/a',{});api.get('/a',{});api.get('/b',{})
        self.assertEqual(request.call_count,2)
        self.assertEqual(api.cache_hits,1)
        self.assertAlmostEqual(sleep.call_args_list[1].args[0],1.9)

    def test_verified_fields(self):
        c={'broadUserId':'khm11903','nick':'봉준','rank':1}
        o={'userId':'khm11903','totalViewCountDelta':113705545,'monthBalloon':11752539,'monthDonors':42876,'donors':{'total':50}}
        result=normalize(c,o)
        self.assertEqual(result['donorCount'],42876)
        self.assertEqual(result['cumulativeUsers'],113705545)
        self.assertEqual(result['balloonCount'],11752539)
        del o['monthDonors']
        with self.assertRaises(ValueError): normalize(c,o)

    def test_exclusion_before_selection(self):
        rows=[{'broadUserId':str(i)} for i in range(200)]
        selected=select_candidates(rows,[{'soopId':str(i)} for i in range(10)])
        self.assertEqual(len(selected),100)
        self.assertEqual(selected[-1]['broadUserId'],'109')

    def test_hidden_stats_are_never_zero_filled(self):
        row=normalize({'broadUserId':'hidden','nick':'hidden','rank':10}, {'userId':'hidden','totalViewCountDelta':100,'isBalloonHidden':True,'monthBalloon':123})
        self.assertEqual(row['status'],'unavailable')
        self.assertIsNone(row['balloonCount'])
        self.assertIsNone(row['donorCount'])

    def test_korean_date_and_december_guard(self):
        self.assertEqual(collection_date(datetime(2026,9,29,16,tzinfo=timezone.utc)),'2026-09-30')
        for date in [datetime(2026,11,30,15,tzinfo=timezone.utc),datetime(2025,12,1,tzinfo=timezone.utc)]:
            with self.assertRaises(ValueError): collection_date(date)

    def test_429_is_not_retried(self):
        error=HTTPError('https://www.trackify.kr/api/v1/p/soop/streamer/a',429,'Too Many Requests',{'Retry-After':'3600'},io.BytesIO(b'{}'))
        with patch('services.trackify.urlopen',side_effect=error) as request,patch('services.trackify.time.sleep'):
            with self.assertRaises(HTTPError):Trackify().overview('a')
        request.assert_called_once()
