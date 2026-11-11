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
    """Only capture an actual whole-cohort observation with its matching saved forecast."""
    report = snapshot.get('targetResults', {}).get('dynamic', {})
    observed = snapshot.get('updatedAt')
    if not observed or report.get('updatedAt') != observed:
        return None
    if snapshot.get('collectionMode') == 'manual_partial':
        batch = snapshot.get('manualBatchOverride', {})
        if batch.get('updatedCandidates') != len(snapshot['streamers']) or batch.get('retainedCandidates') != 0:
            return None
        if any(row.get('metricObservedAt', {}).get('cumulativeUsers') != observed for row in snapshot['streamers']):
            return None
    target = next((r for r in snapshot['streamers'] if r['soopId'] == 'singgyul'), None)
    if not target or len(report.get('models', [])) != 3:
        return None
    manual = snapshot.get('manualOverride', {})
    rows = [{key: row.get(key) for key in ('soopId', 'name', *METRICS)} for row in snapshot['streamers']]
    projected = [{key: row.get(key) for key in ('soopId', 'name', *METRICS)} for row in report['projectedRows']]
    models = {row['model']: {key: row.get(key) for key in
              ('currentRank', 'predictedRank', 'remaining', 'requiredFinal')} for row in report['models']}
    source = snapshot.get('manualBatchOverride', {}).get('sourceObservation', {})
    return {'observedAt': observed, 'precision': source.get('precision', 'minute'),
            'comparisonKey': comparison_key(snapshot), 'sourceHash': snapshot.get('manualBatchOverride', {}).get('sourceFileSha256'),
            'viewerAdjustment': manual.get('adjustment', target.get('viewerAdjustmentTotal', 0)),
            'rawUsers': manual.get('rawViewer', target.get('rawMetrics', {}).get('viewer', target['cumulativeUsers'])),
            'models': models, 'rows': rows, 'projectedRows': projected}


def history_before_update(previous, current):
    """Archive the PREVIOUS observation; the UI reads the current one with final source metadata.

    Calling this before callers attach the new source timestamp is safe. Repeated imports
    deduplicate by observation time, and partial/failed collections cannot create chart points.
    """
    points = copy.deepcopy(previous.get('trendHistory', {}).get('points', []))
    last = compact_observation(previous)
    if last:
        points.append(last)
    key = comparison_key(current)
    unique = {p['observedAt']: p for p in points if p.get('comparisonKey') == key}
    ordered = sorted(unique.values(), key=lambda p: datetime.fromisoformat(p['observedAt']))
    version = 'recent-seven-day-v1' if current.get('recentTrend') else MODEL_VERSION
    return {'version': 1, 'modelVersion': version, 'comparisonKey': key,
            'definition': 'Observed broadcasts only; fixed cohort and forecast inputs; no missing-day interpolation.',
            'points': ordered[-90:]}
