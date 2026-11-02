import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from datetime import datetime, timezone
from scripts.collect import collect, atomic_json, simulation_baseline


class FakeAPI:
    def monthly_users(self, soop_ids, period):
        return {'rows':[{'soopId':account,'recentMonthlyUsers':10} for account in soop_ids],'errors':[]}
    def candidates(self):
        return [{'broadUserId':'khm11903' if i==0 else f'id{i}', 'nick':f'테스트{i}', 'rank':i+1} for i in range(200)]

    def overview(self, account):
        return {'userId':account,'totalViewCountDelta':100,'monthBalloon':20,'monthDonors':10,'isBalloonHidden':account=='id1'}


class CollectorTests(unittest.TestCase):
    def test_simulation_baseline_is_provisional_then_locked_and_immutable(self):
        stats=[{'soopId':'one','donorCount':11,'balloonCount':22,'cumulativeUsers':33}]
        before=simulation_baseline(stats,{},datetime(2026,9,30,12,tzinfo=timezone.utc))
        self.assertEqual(before['status'],'provisional')
        locked=simulation_baseline(stats,{},datetime(2026,9,30,16,tzinfo=timezone.utc))
        self.assertEqual(locked['status'],'locked')
        changed=[{'soopId':'one','donorCount':999,'balloonCount':999,'cumulativeUsers':999}]
        retained=simulation_baseline(changed,{'simulationBaseline':locked},datetime(2026,10,2,tzinfo=timezone.utc))
        self.assertIs(retained,locked)
        self.assertEqual(retained['rows'][0]['donorCount'],11)

    def test_monthly_failure_does_not_break_existing_ranking(self):
        class MonthlyFailure(FakeAPI):
            def monthly_users(self, *args):raise TimeoutError('monthly timeout')
        with tempfile.TemporaryDirectory() as folder, patch('scripts.collect.Trackify',MonthlyFailure), patch('scripts.collect.collection_date',return_value='2026-09-30'):
            path=Path(folder)/'ranking.json'
            self.assertTrue(collect(path,True))
            data=json.loads(path.read_text())
            self.assertEqual(data['status'],'ok');self.assertEqual(data['forecast']['status'],'unavailable')
            self.assertEqual(len(data['streamers']),100)
    def test_success_archives_previous_snapshot(self):
        with tempfile.TemporaryDirectory() as folder, patch('scripts.collect.Trackify',FakeAPI), patch('scripts.collect.collection_date',return_value='2026-09-30'):
            path=Path(folder)/'ranking.json'; history=Path(folder)/'history'
            previous={'status':'ok','updatedAt':'2026-09-01T00:00:00+00:00','streamers':[{'soopId':'previous'}]}
            atomic_json(path,previous)
            self.assertTrue(collect(path,True,history))
            self.assertEqual(json.loads((history/'20260901T000000Z.json').read_text()),previous)
            self.assertEqual(len(json.loads(path.read_text())['streamers']),100)

    def test_end_of_period_keeps_exact_snapshot_without_network(self):
        with tempfile.TemporaryDirectory() as folder, patch('scripts.collect.Trackify') as api, patch('scripts.collect.collection_date',side_effect=ValueError('outside evaluation period')):
            path=Path(folder)/'ranking.json';atomic_json(path,{'updatedAt':'2026-11-30T12:15:00+00:00','streamers':[{'soopId':'last'}]})
            original=path.read_bytes()
            self.assertTrue(collect(path,True))
            self.assertEqual(path.read_bytes(),original)
            api.assert_not_called()

    def test_partial_private_data_preserves_candidate(self):
        with tempfile.TemporaryDirectory() as folder, patch('scripts.collect.Trackify',FakeAPI), patch('scripts.collect.collection_date',return_value='2026-09-30'):
            path=Path(folder)/'ranking.json'
            self.assertTrue(collect(path,True))
            data=json.loads(path.read_text())
            self.assertEqual(len(data['streamers']),100)
            self.assertEqual(data['unavailableCount'],1)
            self.assertIsNone(data['streamers'][1]['balloonCount'])

    def test_transient_failure_retains_last_success(self):
        with tempfile.TemporaryDirectory() as folder, patch('scripts.collect.Trackify',side_effect=TimeoutError('timeout')), patch('scripts.collect.collection_date',return_value='2026-09-30'):
            path=Path(folder)/'ranking.json'
            old={'status':'ok','updatedAt':'2026-09-01T00:00:00+00:00','streamers':[{'soopId':'last-good'}]}
            atomic_json(path,old)
            self.assertFalse(collect(path,True))
            new=json.loads(path.read_text())
            self.assertEqual(new['status'],'stale')
            self.assertEqual(new['updatedAt'],old['updatedAt'])
            self.assertEqual(new['streamers'],old['streamers'])

    def test_first_failure_is_unavailable(self):
        with tempfile.TemporaryDirectory() as folder, patch('scripts.collect.Trackify',side_effect=TimeoutError('timeout')), patch('scripts.collect.collection_date',return_value='2026-09-30'):
            path=Path(folder)/'ranking.json'
            self.assertFalse(collect(path,True))
            self.assertEqual(json.loads(path.read_text())['status'],'unavailable')
