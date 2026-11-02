import copy
import json
import tempfile
import unittest
from pathlib import Path
from datetime import datetime
from unittest.mock import patch
from services.trackify import KST
from scripts.live_collect import live_snapshot
from scripts.collect import collect

ROOT=Path(__file__).resolve().parents[1]

class LiveCollectorTests(unittest.TestCase):
    def setUp(self):
        self.old=json.loads((ROOT/'tests/fixtures/legacy-ranking.json').read_text())
        self.old['liveTargetVersion']=1
        self.now=datetime(2026,10,15,12,tzinfo=KST)
        self.rows=[{'broadUserId':r['soopId'],'uniqueViewers':r['cumulativeUsers']} for r in self.old['streamers']]

    def api(self):
        from unittest.mock import Mock
        api=Mock();api.candidates.return_value=self.rows
        return api

    def test_all_viewers_only_and_baseline_scores_inputs_are_immutable(self):
        for row in self.rows:row['uniqueViewers']+=123
        api=self.api();result=live_snapshot(api,self.old,self.now)
        self.assertEqual(result['simulationBaseline'],self.old['simulationBaseline'])
        self.assertEqual(result['forecast'],self.old['forecast'])
        baseline={r['soopId']:r for r in self.old['simulationBaseline']['rows']}
        for before,after in zip(self.old['streamers'],result['streamers']):
            self.assertEqual(after['cumulativeUsers'],before['cumulativeUsers']+123)
            self.assertEqual(after['donorCount'],baseline[after['soopId']]['donorCount'])
            self.assertEqual(after['balloonCount'],baseline[after['soopId']]['balloonCount'])
        api.overview.assert_not_called()

    def test_unchanged_skips_publication_and_all_detail_calls(self):
        api=self.api();self.assertIsNone(live_snapshot(api,self.old,self.now));api.overview.assert_not_called()

    def test_fixed_cohort_missing_from_summary_uses_detail_without_new_candidates(self):
        missing=self.rows.pop();api=self.api();api.overview.return_value={'userId':missing['broadUserId'],'totalViewCountDelta':missing['uniqueViewers']+1}
        result=live_snapshot(api,self.old,self.now)
        self.assertEqual(len(result['streamers']),100)
        api.overview.assert_called_once_with(missing['broadUserId'])

    def test_incomplete_summary_never_becomes_zero(self):
        self.rows[0]['uniqueViewers']=None
        with self.assertRaises(ValueError):live_snapshot(self.api(),self.old,self.now)

    def test_final_observation_written_even_without_change(self):
        result=live_snapshot(self.api(),self.old,datetime(2026,11,30,23,58,tzinfo=KST))
        self.assertIn('finalObservationAt',result)
        self.assertEqual(result['simulationBaseline'],self.old['simulationBaseline'])
