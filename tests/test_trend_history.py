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

    def test_stale_target_and_stale_reports_do_not_create_observations(self):
        old=snapshot();old['streamers'][0]['metricObservedAt']['cumulativeUsers']='2026-10-18T00:00:00+09:00'
        self.assertIsNone(compact_observation(old))
        old=snapshot();old['targetResults']['dynamic']['updatedAt']='2026-10-18T00:00:00+09:00'
        self.assertIsNone(compact_observation(old))

    def test_partial_update_is_kept_without_promoting_retained_candidates_to_new_observations(self):
        old=snapshot()
        old['streamers'].append({'soopId':'rival','name':'경쟁자','cumulativeUsers':2000,'donorCount':20,'balloonCount':200,
            'metricObservedAt':{'cumulativeUsers':'2026-10-18T23:22:00+09:00'}})
        old['manualBatchOverride'].update(updatedCandidates=1,retainedCandidates=1)
        old['targetResults']['dynamic']['projectedRows']=copy.deepcopy(old['streamers'])
        before=copy.deepcopy(old);point=compact_observation(old)
        self.assertEqual(old,before)
        self.assertEqual(point['updatedCandidates'],1);self.assertEqual(point['retainedCandidates'],1)
        self.assertEqual(point['rows'][1]['metricObservedAt']['cumulativeUsers'],'2026-10-18T23:22:00+09:00')
        new=copy.deepcopy(old);new['updatedAt']=snapshot(20)['updatedAt']
        new['manualOverride']['observedAt']=new['updatedAt']
        new['streamers'][0]['metricObservedAt']['cumulativeUsers']=new['updatedAt']
        new['targetResults']['dynamic']['updatedAt']=new['updatedAt']
        history=history_before_update(old,new)
        self.assertEqual(history['points'][0]['observedAt'],old['updatedAt'])
        self.assertEqual(history['points'][0]['retainedCandidates'],1)

    def test_failed_source_is_excluded_and_successful_automatic_recheck_uses_observation_time(self):
        old=snapshot();old['status']='stale'
        self.assertIsNone(compact_observation(old))
        old=snapshot();old['collectionMode']='automatic';old['actualObservedAt']='2026-10-20T03:15:00+09:00'
        point=compact_observation(old)
        self.assertEqual(point['observedAt'],old['actualObservedAt'])
        self.assertEqual(point['rows'][0]['metricObservedAt']['cumulativeUsers'],old['actualObservedAt'])

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
