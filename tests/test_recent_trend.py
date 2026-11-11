import copy
import json
from pathlib import Path
import tempfile
import unittest
from scripts.recent_trend import compact, attach_recent_trend


def sample(day=12):
    stamp=f'2026-11-{day:02d}T01:35:00+09:00'
    return {'updatedAt':stamp,'collectionMode':'manual_partial','manualOverride':{'observedAt':stamp,'rawViewer':1700,'adjustment':-700},
        'manualBatchOverride':{'sourceObservation':{'precision':'minute'}},'streamers':[
            {'soopId':'singgyul','cumulativeUsers':1000,'donorCount':10,'balloonCount':100,
             'metricObservedAt':{'cumulativeUsers':stamp,'balloonCount':stamp,'donorCount':'2026-10-17T03:00:00+09:00'}}]}


class RecentTrendTests(unittest.TestCase):
    def test_raw_viewer_and_metric_dates_preserve_adjustment_and_stale_donor_meaning(self):
        s=sample();before=copy.deepcopy(s);point=compact(s)
        self.assertEqual(s,before)
        self.assertEqual(point['rows'][0]['cumulativeUsers'],1700)
        self.assertEqual(point['rows'][0]['metricObservedAt']['donorCount'],'2026-10-17T03:00:00+09:00')
        self.assertNotIn('adjustment',point)

    def test_unknown_source_timestamp_does_not_become_intraday_observation(self):
        s=sample();s['manualBatchOverride']['sourceObservation']['precision']='day'
        self.assertIsNone(compact(s))

    def test_successful_automatic_reobservation_is_fresh_even_when_counter_did_not_change(self):
        s=sample();s['collectionMode']='automatic';s['actualObservedAt']='2026-11-13T03:15:00+09:00'
        point=compact(s)
        self.assertEqual(point['observedAt'],s['actualObservedAt'])
        self.assertEqual(point['rows'][0]['metricObservedAt']['donorCount'],s['actualObservedAt'])
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(attach_recent_trend(Path(tmp),s)['asOf'],s['actualObservedAt'])

    def test_daily_and_manual_history_are_deduplicated_future_excluded_and_new_import_refreshed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'history/daily').mkdir(parents=True);(root/'history/manual').mkdir()
            for day in [5,7,13]:
                (root/f'history/daily/2026-11-{day:02d}.json').write_text(json.dumps(sample(day)))
            (root/'history/manual/before-20261107T000000Z.json').write_text(json.dumps(sample(7)))
            s=sample();before=copy.deepcopy(s);history=attach_recent_trend(root,s)
            self.assertEqual(len(history['observations']),3)
            self.assertEqual({k:v for k,v in s.items() if k!='recentTrend'},before)
            first=copy.deepcopy(history);self.assertEqual(attach_recent_trend(root,s),first)
            (root/'history/daily/2026-11-09.json').write_text(json.dumps(sample(9)))
            self.assertEqual(len(attach_recent_trend(root,s)['observations']),4)

    def test_daily_raw_metadata_is_used_without_inventing_private_support_values(self):
        s=sample();daily={'observedAt':s['updatedAt'],'rows':s['streamers'],
                         'viewerAdjustmentMetadata':[{'soopId':'singgyul','rawMetrics':{'viewer':1700}}]}
        point=compact(daily)
        self.assertEqual(point['rows'][0]['cumulativeUsers'],1700)
        daily['rows'][0]['donorCount']=None
        self.assertIsNone(compact(daily)['rows'][0]['donorCount'])
