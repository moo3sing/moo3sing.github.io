"""Compact, read-only chart history. Forecast inputs and source observations are untouched."""
import copy
import hashlib
import json
from datetime import datetime

MODEL_VERSION = 'recent-trend-actual-rolling-20261019-fixed'
METRICS = ('cumulativeUsers', 'donorCount', 'balloonCount')


def comparison_key(snapshot):
    inputs = {key: snapshot.get(key) for key in
              ('simulationBaseline', 'rollingForecast', 'supportBaseline', 'rankingExceptions')}
    if isinstance(inputs['rollingForecast'], dict):
        inputs['rollingForecast'] = {key: value for key, value in inputs['rollingForecast'].items()
                                     if key not in ('capturedAt', 'errors')}
    inputs['candidates'] = sorted(row['soopId'] for row in snapshot['streamers'])
    inputs['modelVersion'] = 'recent-seven-day-v1' if snapshot.get('recentTrend') else MODEL_VERSION
    return hashlib.sha256(json.dumps(inputs, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def compact_observation(snapshot):
    """Capture successful observations; retained rows keep their own metric dates."""
    report = snapshot.get('targetResults', {}).get('dynamic', {})
    data_updated = snapshot.get('updatedAt')
    automatic = snapshot.get('collectionMode') == 'automatic'
    observed = (snapshot.get('actualObservedAt') if automatic else None) or data_updated
    if not observed or report.get('updatedAt') != data_updated or snapshot.get('status', 'ok') != 'ok':
        return None
    target = next((r for r in snapshot['streamers'] if r['soopId'] == 'singgyul'), None)
    if not target or len(report.get('models', [])) != 3:
        return None
    manual = snapshot.get('manualOverride', {})
    def metric_dates(row):
        dates = copy.deepcopy(row.get('metricObservedAt', {}))
        for key in METRICS:
            fallback = observed if automatic or snapshot.get('collectionMode') != 'manual_partial' else (
                manual.get('observedAt') if row['soopId'] == 'singgyul' else snapshot.get('competitorDataAsOf'))
            dates[key] = fallback if automatic else dates.get(key) or fallback
        return dates
    rows = [{**{key: row.get(key) for key in ('soopId', 'name', *METRICS)},
             'metricObservedAt': metric_dates(row)} for row in snapshot['streamers']]
    target_row = next(row for row in rows if row['soopId'] == 'singgyul')
    def fresh(row):
        value = row['metricObservedAt'].get('cumulativeUsers')
        return bool(value) and datetime.fromisoformat(value) == datetime.fromisoformat(observed)
    if not fresh(target_row):
        return None
    fresh_count = sum(fresh(row) for row in rows)
    projected = [{key: row.get(key) for key in ('soopId', 'name', *METRICS)} for row in report['projectedRows']]
    models = {row['model']: {key: row.get(key) for key in
              ('currentRank', 'predictedRank', 'remaining', 'requiredFinal')} for row in report['models']}
    source = {} if automatic else manual.get('sourceObservation') or snapshot.get('manualBatchOverride', {}).get('sourceObservation', {})
    return {'observedAt': observed, 'precision': source.get('precision', 'minute'),
            'comparisonKey': comparison_key(snapshot), 'sourceHash': snapshot.get('manualBatchOverride', {}).get('sourceFileSha256'),
            'viewerAdjustment': manual.get('adjustment', target.get('viewerAdjustmentTotal', 0)),
            'rawUsers': manual.get('rawViewer', target.get('rawMetrics', {}).get('viewer', target['cumulativeUsers'])),
            'models': models, 'rows': rows, 'projectedRows': projected,
            'updatedCandidates': fresh_count, 'retainedCandidates': len(rows) - fresh_count,
            'reservedCount': report.get('reservedCount', 0)}


def history_before_update(previous, current):
    """Archive the PREVIOUS observation; the UI reads the current one with final source metadata.

    Calling this before callers attach the new source timestamp is safe. Repeated imports
    deduplicate by observation time. Failed collections cannot create new observations;
    a partial update keeps retained rows' original dates instead of inventing observations.
    """
    points = copy.deepcopy(previous.get('trendHistory', {}).get('points', []))
    last = compact_observation(previous)
    if last:
        points.append(last)
    key = comparison_key(current)
    unique = {p['observedAt']: p for p in points if p.get('comparisonKey') == key}
    ordered = sorted(unique.values(), key=lambda p: datetime.fromisoformat(p['observedAt']))
    version = 'recent-seven-day-v1' if current.get('recentTrend') else MODEL_VERSION
    return {'version': 2, 'modelVersion': version, 'comparisonKey': key,
            'definition': 'Successful observations with per-metric dates; retained values disclosed; no missing-day interpolation.',
            'points': ordered[-90:]}
