import json
from pathlib import Path
import tempfile
import unittest
from datetime import datetime
from unittest.mock import Mock
from scripts.check_singgyul_viewer_once import check
from scripts.collect import atomic_json
from services.trackify import KST

ROOT=Path(__file__).resolve().parents[1]


class MorningViewerTests(unittest.TestCase):
    def test_one_viewer_request_preserves_ranking_and_support_and_never_repeats(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder);ranking=p/'ranking.json';output=p/'result.json'
            row={'soopId':'singgyul','cumulativeUsers':7382588,'donorCount':4895,'balloonCount':4929477,
                 'rawMetrics':{'viewer':7422588,'donor':4895,'balloon':4929477}}
            atomic_json(ranking,{'streamers':[row]});before=ranking.read_bytes()
            api=Mock();api.overview.return_value={'userId':'singgyul','totalViewCountDelta':7450000,'monthDonors':9999,'monthBalloon':9999999}
            result=check(output,ranking,p/'block.json',ROOT/'tests/fixtures/viewer-adjustments-two-events.json','2026-10-18',datetime(2026,10,18,9,15,tzinfo=KST),lambda:api)
            self.assertEqual(result['adjustedViewer'],7410000);self.assertEqual(result['viewerAdjustmentTotal'],-40000)
            self.assertEqual(ranking.read_bytes(),before);self.assertFalse(result['published']);self.assertFalse(result['donorBalloonUpdated'])
            api.overview.assert_called_once_with('singgyul')
            with self.assertRaises(FileExistsError):check(output,ranking,p/'block.json',ROOT/'tests/fixtures/viewer-adjustments-two-events.json','2026-10-18',datetime(2026,10,18,9,16,tzinfo=KST),lambda:api)
            api.overview.assert_called_once()

    def test_blocked_and_outside_morning_make_zero_requests(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder);ranking=p/'ranking.json';atomic_json(ranking,{'streamers':[]})
            api=Mock();atomic_json(p/'block.json',{'blockedUntil':'2026-10-19T00:00:00+09:00'})
            result=check(p/'result.json',ranking,p/'block.json',ROOT/'tests/fixtures/viewer-adjustments-two-events.json','2026-10-18',datetime(2026,10,18,9,15,tzinfo=KST),lambda:api)
            self.assertEqual(result['apiRequests'],0);api.overview.assert_not_called()
            result=check(p/'other.json',ranking,p/'block.json',ROOT/'tests/fixtures/viewer-adjustments-two-events.json','2026-10-18',datetime(2026,10,18,3,15,tzinfo=KST),lambda:api)
            self.assertEqual(result['apiRequests'],0);self.assertFalse((p/'other-started.json').exists())
