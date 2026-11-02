import copy
import unittest
from scripts.trend_history import compact_observation, history_before_update, comparison_key


def snapshot(day=19):
    at=f'2026-10-{day:02d}T23:22:00+09:00'
    row={'soopId':'singgyul','name':'띵귤','cumulativeUsers':1000,'balloonCount':100,'donorCount':10,
         'metricObservedAt':{'cumulativeUsers':at}}
    return {'updatedAt':at,'streamers':[row], 'collectionMode':'manual_partial',
            'manualBatchOverride':{'updatedCandidates':1,'retainedCandidates':0},
            'manualOverride':{'rawViewer':71000,'adjustment':-70000},
            'simulationBaseline':{'status':'locked'},'rollingForecast':{'method':'recent'},
            'targetResults':{'dynamic':{'updatedAt':at,'projectedRows':[row],
                'models':[{'model':m,'currentRank':73,'predictedRank':71,'remaining':10,'requiredFinal':1010}
                          for m in ('rank','ratio','minmax')]}}}


class TrendHistoryTests(unittest.TestCase):
    def test_only_adds_chart_metadata_and_preserves_raw_actuals(self):
        old=snapshot();new=snapshot(20);before=copy.deepcopy(old)
        history=history_before_update(old,new)
        self.assertEqual(old,before)
        self.assertEqual(history['points'][0]['rawUsers'],71000)
        self.assertEqual(history['points'][0]['rows'][0]['cumulativeUsers'],1000)
        self.assertEqual(history['points'][0]['viewerAdjustment'],-70000)
        self.assertEqual(history['points'][0]['observedAt'],old['updatedAt'])

    def test_repeated_update_archives_previous_observation_once(self):
        old=snapshot();new=snapshot(20)
        old['trendHistory']=history_before_update(old,new)
        history=history_before_update(old,new)
        self.assertEqual(len(history['points']),1)
        self.assertNotIn(new['updatedAt'],[p['observedAt'] for p in history['points']])

    def test_partial_and_stale_reports_do_not_create_observations(self):
        old=snapshot();old['manualBatchOverride']['retainedCandidates']=1
        self.assertIsNone(compact_observation(old))
        old=snapshot();old['streamers'][0]['metricObservedAt']['cumulativeUsers']='2026-10-18T00:00:00+09:00'
        self.assertIsNone(compact_observation(old))
        old=snapshot();old['targetResults']['dynamic']['updatedAt']='2026-10-18T00:00:00+09:00'
        self.assertIsNone(compact_observation(old))

    def test_fixed_support_or_baseline_change_starts_separate_comparison(self):
        old=snapshot();new=snapshot(20);new['rankingExceptions']={'fixedSupport':[{'donorCount':999}]}
        self.assertNotEqual(comparison_key(old),comparison_key(new))
        self.assertEqual(history_before_update(old,new)['points'],[])

    def test_unknown_source_precision_is_retained(self):
        old=snapshot();old['manualBatchOverride']['sourceObservation']={'precision':'day'}
        self.assertEqual(compact_observation(old)['precision'],'day')

    def test_collection_timestamp_alone_does_not_erase_history(self):
        old=snapshot();new=snapshot(20)
        old['rollingForecast']['capturedAt']='2026-10-19T00:00:00+09:00'
        new['rollingForecast']['capturedAt']='2026-10-20T00:00:00+09:00'
        self.assertEqual(comparison_key(old),comparison_key(new))
        self.assertEqual(len(history_before_update(old,new)['points']),1)
