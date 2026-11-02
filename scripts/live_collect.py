"""Update only annual viewers for the immutable September candidate cohort."""
from datetime import datetime, timezone
from services.trackify import number, KST


def live_snapshot(api, old, now):
    baseline = old['simulationBaseline']
    if baseline['status'] != 'locked' or old['forecast']['referenceMonth'] != '2026-09':
        raise ValueError('Locked September baseline and pace are required')
    summary = api.candidates()
    indexed = {r['broadUserId']: r for r in summary}
    previous = {r['soopId']: r for r in old['streamers']}
    stats = []
    for base in baseline['rows']:
        account = base['soopId']
        row = indexed.get(account)
        if row is not None:
            viewers = number(row, 'uniqueViewers')
        else:
            detail = api.overview(account)
            if detail.get('userId') != account:
                raise ValueError('Annual streamer ID mismatch')
            viewers = number(detail, 'totalViewCountDelta')
        if not float(viewers).is_integer():
            raise ValueError('Non-integer annual viewer value')
        stats.append({**base, 'cumulativeUsers': int(viewers)})
    changed = any(r['cumulativeUsers'] != previous[r['soopId']]['cumulativeUsers'] for r in stats)
    # Record a final late observation even if the API values did not change.
    final = now.astimezone(KST).strftime('%m-%d %H:%M') >= '11-30 23:58'
    if not changed and not final and old.get('status') == 'ok' and old.get('liveTargetVersion') == 1:
        return None
    result = {**old, 'status':'ok', 'errors':[], 'streamers':stats, 'liveTargetVersion':1,
              'asOf':now.astimezone(KST).date().isoformat(), 'updatedAt':now.isoformat(),
              'attemptedAt':now.isoformat(), 'completedAt':datetime.now(timezone.utc).isoformat(),
              'viewerSource':'yearly-summary.uniqueViewers; missing IDs: annual overview.totalViewCountDelta',
              'lastViewerChangeAt':now.isoformat() if changed else old.get('lastViewerChangeAt',old['updatedAt'])}
    result.pop('message',None)
    if final:
        result['finalObservationAt'] = now.isoformat()
    return result
