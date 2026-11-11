"""Public, per-metric observation history for trailing-seven-day forecasts. No API calls."""
import json
import re
from datetime import datetime, timedelta

KEYS = ('cumulativeUsers', 'donorCount', 'balloonCount')


def compact(snapshot):
    automatic = snapshot.get('collectionMode') == 'automatic'
    observed = (snapshot.get('actualObservedAt') if automatic else None) or snapshot.get('updatedAt') or snapshot.get('observedAt')
    if not observed:
        return None
    manual = {} if automatic else snapshot.get('manualOverride', {})
    source = snapshot.get('manualBatchOverride', {}).get('sourceObservation') or manual.get('sourceObservation', {})
    # A receipt date is not an exact source observation; do not invent intraday rates.
    if not automatic and source.get('precision') == 'day':
        return None
    extras = {r['soopId']: r for r in snapshot.get('viewerAdjustmentMetadata', [])}
    rows = []
    for item in snapshot.get('streamers', snapshot.get('rows', [])):
        row = {**extras.get(item['soopId'], {}), **item}
        fallback = manual.get('observedAt', observed) if row['soopId'] == 'singgyul' else snapshot.get('competitorDataAsOf', observed)
        if snapshot.get('collectionMode') != 'manual_partial':
            fallback = snapshot.get('actualObservedAt') or observed
        values = {key: row.get(key) for key in KEYS}
        if row['soopId'] == 'singgyul':
            # Suspected-bot adjustments change levels, not measured organic growth.
            raw = manual.get('rawViewer', row.get('rawMetrics', {}).get('viewer'))
            if raw is not None:
                values['cumulativeUsers'] = raw
        rows.append({'soopId': row['soopId'], **values,
                     'metricObservedAt': {key: fallback if automatic else row.get('metricObservedAt', {}).get(key) or fallback for key in KEYS}})
    return {'observedAt': observed, 'rows': rows}


def attach_recent_trend(root, snapshot):
    as_of = snapshot.get('actualObservedAt') if snapshot.get('collectionMode') == 'automatic' else None
    end = datetime.fromisoformat(as_of or snapshot['updatedAt'])
    lower = end - timedelta(days=21)
    points = list(snapshot.get('recentTrend', {}).get('observations', []))
    history = root / 'history'
    paths = [*history.glob('daily/*.json'), *history.glob('manual/before-*.json'), *history.glob('20*.json')]
    for path in sorted(paths):
        # Filename date filtering avoids reading old full snapshots on every update.
        match = re.search(r'(20\d{2})-?(\d{2})-?(\d{2})', path.name)
        if not match or not lower.date().isoformat() <= '-'.join(match.groups()) <= end.date().isoformat():
            continue
        data = json.loads(path.read_text(encoding='utf-8'))
        point = compact(data)
        if point:
            points.append(point)
    current = compact(snapshot)
    if current:
        points.append(current)
    unique = {}
    for point in points:
        at = datetime.fromisoformat(point['observedAt'])
        if lower <= at <= end:
            unique[at.isoformat()] = point
    snapshot['recentTrend'] = {'version': 1, 'method': 'trailing_7d_average', 'windowDays': 7, 'asOf': end.isoformat(),
        'boundaryPolicy': 'linear_within_observed_interval; no fabricated daily rows',
        'observations': [unique[key] for key in sorted(unique, key=datetime.fromisoformat)]}
    return snapshot['recentTrend']
