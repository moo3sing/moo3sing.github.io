#!/usr/bin/env python3
"""Run once daily at 03:15 KST. Publish one atomic, consistent snapshot."""
import argparse
import fcntl
import json
import os
import time
from pathlib import Path
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.dynamic_collect import dynamic_snapshot, daily_observations, calculate_targets, daily_record
from scripts.rolling_inputs import build_rolling_inputs, month_state
from scripts.trackify_block import active as active_block, record_429
from scripts.daily_collection import claim as claim_daily, finish as finish_daily
from scripts.trend_history import history_before_update
from services.trackify import Trackify, normalize, select_candidates, collection_date, forecast_reference, CACHE_SECONDS, KST
from urllib.error import HTTPError

SIMULATION_CUTOFF = datetime(2026, 10, 1, 0, 0, tzinfo=KST)
PRODUCTION_OUTPUT = Path('/var/www/singdboo-site/public/assets/data/ranking.json')
BLOCK_STATE = Path('/var/lib/soop-ranking/control/trackify-block.json')
DAILY_STATE = BLOCK_STATE.with_name('daily-collection.json')


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    os.chmod(temp, 0o644)
    temp.replace(path)


def log_event(event, **fields):
    print(json.dumps({'timestamp': datetime.now(timezone.utc).isoformat(), 'event': event, **fields}, ensure_ascii=False), flush=True)


def collection_status(output, old, attempted, status, error=None, blocked_until=None, retry_after=None):
    path=output.with_name('collection-status.json')
    previous=json.loads(path.read_text()) if path.exists() else {}
    successful=status in ('updated','metrics_unchanged','source_correction')
    record={'lastCollectionAttempt':attempted.isoformat(),
            'lastSuccessfulCollection':datetime.now(timezone.utc).isoformat() if successful else previous.get('lastSuccessfulCollection',old.get('completedAt',old.get('updatedAt'))),
            'lastDataChange':old.get('lastDataChangeAt',old.get('updatedAt')),
            'collectionStatus':status,'snapshotUpdatedAt':old.get('updatedAt'),
            'collectionMode':old.get('collectionMode','automatic'),'actualDataScope':old.get('actualDataScope','all_candidates')}
    if old.get('competitorDataAsOf'):record['competitorDataAsOf']=old['competitorDataAsOf']
    if previous.get('lastManualUpdate'):record['lastManualUpdate']=previous['lastManualUpdate']
    if not successful:
        for key in ('publicationStatus','publicationHoldReasons','viewerAdjustmentReview','automaticCollection'):
            if key in previous:record[key]=previous[key]
    if error:record['reason']=error
    if blocked_until:record['blockedUntil']=blocked_until
    if retry_after is not None:record['retryAfterSeconds']=retry_after
    atomic_json(path,record)


def simulation_baseline(stats, old, now):
    """Keep one immutable Sep 30 baseline once the Korean calendar day has ended."""
    previous = old.get('simulationBaseline')
    if previous and previous.get('status') == 'locked':
        return previous
    locked = now.astimezone(KST) >= SIMULATION_CUTOFF
    return {
        'status': 'locked' if locked else 'provisional',
        'asOf': '2026-09-30',
        'cutoffAt': SIMULATION_CUTOFF.isoformat(),
        'capturedAt': now.isoformat(),
        'source': 'Trackify 공개 통계 · 스트리머별 연간 누적 원시값',
        'note': ('2026-09-30 종료 후 최초 수집값으로 고정했습니다.' if locked else
                 '2026-09-30 종료 전 최신 관측값입니다. 종료 후 최초 수집에서 자동 고정됩니다.'),
        'rows': stats,
    }


def collect(output, force=False, history_dir=None, block_state=None, daily_state=None, adjustment_policy=None):
    started = time.monotonic()
    now = datetime.now(timezone.utc)
    old = json.loads(output.read_text()) if output.exists() else {}
    # Freeze the exact last snapshot after the evaluation period, without any API request.
    try:
        as_of = collection_date(now)
    except ValueError as exc:
        log_event('collection_stopped', reason=str(exc), lastSnapshotAt=old.get('updatedAt'))
        return True
    if block_state is None and output.resolve()==PRODUCTION_OUTPUT: block_state=BLOCK_STATE
    blocked=active_block(block_state,now)
    if blocked:
        collection_status(output,old,now,'api_blocked','Trackify Retry-After',blocked['blockedUntil'],blocked['retryAfterSeconds'])
        log_event('collection_skipped_blocked',blockedUntil=blocked['blockedUntil'],lastSnapshotAt=old.get('updatedAt'))
        return True
    if not force and old.get('status') == 'ok' and old.get('updatedAt'):
        if (now - datetime.fromisoformat(old['updatedAt'])).total_seconds() < CACHE_SECONDS:
            log_event('cache_hit', lastSnapshotAt=old['updatedAt']); return True
    production=output.resolve()==PRODUCTION_OUTPUT
    if production and daily_state is None:daily_state=DAILY_STATE
    if production and adjustment_policy is None:
        adjustment_policy=json.loads((ROOT/'data/viewer-adjustments.json').read_text())
    if adjustment_policy and adjustment_policy.get('sourceCorrectionReview',{}).get('status')=='pending':
        reason='띵귤 source correction 여부 미확정: viewer adjustment 검토 후 게시 가능'
        collection_status(output,old,now,'review_required',reason)
        log_event('collection_skipped_review_required',reason=reason,apiRequests=0)
        return False
    if daily_state and not claim_daily(daily_state,output.with_name('collection-status.json'),now,atomic_json):
        log_event('collection_skipped_daily_limit',asOf=as_of)
        return True
    exclusions = json.loads((ROOT / 'data/excluded-streamers.json').read_text())
    errors = []
    log_event('collection_started', output=str(output), asOf=as_of)
    api=None
    run_status='failed'
    try:
        api = Trackify()
        if production:
            api.audit_dir=history_dir.parent/'runs'/now.strftime('%Y%m%dT%H%M%S%fZ')
        if old.get('simulationBaseline', {}).get('status') == 'locked' and as_of >= '2026-10-01':
            manual=old.get('collectionMode')=='manual_partial'
            reference=old
            if manual:
                reference=json.loads(json.dumps(old))
                baseline_metrics=old.get('manualOverride',{}).get('automaticBase')
                if not baseline_metrics:raise ValueError('수동 모드의 자동 기준값 누락')
                target=next(r for r in reference['streamers'] if r['soopId']=='singgyul')
                if old.get('manualOverride',{}).get('rawViewer') is None:
                    for key in ('cumulativeUsers','donorCount','balloonCount'):target[key]=baseline_metrics[key]
            approval_path=ROOT/'data/source-correction-approvals.json'
            approvals=json.loads(approval_path.read_text()).get('approvals',[]) if production and approval_path.exists() else None
            source_policy_path=ROOT/'data/source-observation-policy.json'
            source_policy=json.loads(source_policy_path.read_text()) if production and source_policy_path.exists() else None
            result = dynamic_snapshot(api, reference, now, adjustment_policy, approvals, source_policy)
            if manual:
                if result is None:
                    result={**reference,'streamers':reference['streamers'],'sourceCorrections':[],'verifiedGrowth':[],
                            'updatedAt':now.isoformat(),'attemptedAt':now.isoformat(),'asOf':as_of,
                            'completedAt':datetime.now(timezone.utc).isoformat(),
                            'lastDataChangeAt':now.isoformat() if any(next(r for r in old['streamers'] if r['soopId']=='singgyul')[k]!=baseline_metrics[k] for k in baseline_metrics) else old.get('lastDataChangeAt',old['updatedAt'])}
                for key in ('manualOverride','automaticReference'):result.pop(key,None)
                result['collectionMode']='automatic';result['actualDataScope']='all_candidates';result['competitorDataAsOf']=now.isoformat()
                result['source']='Trackify 공개 통계';result['viewerSource']='annual-overview.totalViewCountDelta'
            if collection_date() != as_of:
                raise ValueError('수집 중 KST 날짜 변경: 다음 실행에서 다시 수집합니다.')
            # A KST day change alters rolling weights even when source counters are unchanged.
            refresh=result is not None or old.get('forecastAsOf')!=as_of or not old.get('rollingForecast') or as_of=='2026-10-31'
            if result is None and refresh:
                result={**old,'sourceCorrections':[],'verifiedGrowth':[]}
            working = result if result is not None else dict(old)
            working['supportHistory'] = daily_observations(history_dir, now)
            working['rollingForecast'] = build_rolling_inputs(api, working, now, log_event)
            working['actualObservedAt']=now.isoformat()
            working['forecastAsOf']=as_of
            month_state(working,old,now,working['supportHistory'])
            report = calculate_targets(ROOT, working, now)
            if collection_date() != as_of:
                raise ValueError('계산 중 KST 날짜 변경: 다음 실행에서 다시 수집합니다.')
            if history_dir:
                daily_path = history_dir / 'daily' / (as_of + '.json')
                # Refresh today's latest observation on changes, or create one even on quiet days.
                if result is not None or not daily_path.exists():
                    atomic_json(daily_path, daily_record(working, report, now))
            if result is None:
                run_status='metrics_unchanged'
                collection_status(output,old,now,'metrics_unchanged')
                log_event('metrics_unchanged', lastSnapshotAt=old.get('updatedAt'))
                return True
            result['targetResults'] = report
            result['trendHistory'] = history_before_update(old,result)
            if history_dir and old.get('updatedAt'):
                stamp = datetime.fromisoformat(old['updatedAt']).strftime('%Y%m%dT%H%M%SZ')
                archived = history_dir / (stamp + '.json')
                if not archived.exists():
                    atomic_json(archived, old)
            corrections=result.get('sourceCorrections',[])
            if corrections and history_dir:
                correction_path=history_dir/'corrections'/(now.strftime('%Y%m%dT%H%M%S%fZ')+'.json')
                atomic_json(correction_path,{'snapshotUpdatedAt':result['updatedAt'],'corrections':corrections})
            atomic_json(output, result)
            run_status='updated'
            collection_status(output,result,now,'source_correction' if corrections else 'updated')
            for growth in result.get('verifiedGrowth',[]):
                log_event('verified_growth',**growth)
            for correction in corrections:
                log_event('source_correction',**correction)
            log_event('dynamic_support_published', candidates=len(result['streamers']), updatedAt=result['updatedAt'], safeTarget=report['dynamic']['safe'])
            return True
        # Validate a single known account before collecting the remaining candidates.
        reference = api.overview('khm11903')
        rows = api.candidates()
        normalize(next(r for r in rows if r['broadUserId'] == 'khm11903'), reference)
        candidates = select_candidates(rows, exclusions)
        if len(candidates) != 100:
            raise ValueError('제외 후 후보 100명 미확보')
        stats = []
        for i, candidate in enumerate(candidates):
            try:
                raw = reference if candidate['broadUserId'] == 'khm11903' else api.overview(candidate['broadUserId'])
                stats.append(normalize(candidate, raw))
            except HTTPError as exc:
                if exc.code==429:raise
                errors.append({'soopId': candidate['broadUserId'], 'message': str(exc)})
                log_event('streamer_failed', soopId=candidate['broadUserId'], reason=str(exc))
            except Exception as exc:
                errors.append({'soopId': candidate['broadUserId'], 'message': str(exc)})
                log_event('streamer_failed', soopId=candidate['broadUserId'], reason=str(exc))
            if (i + 1) % 20 == 0:
                log_event('collection_progress', completed=i+1, candidates=100)
        if errors:
            raise ValueError(f'{len(errors)}명 통계 확인 실패. 불완전한 후보군으로 순위를 다시 계산하지 않습니다.')
        forecast = {**forecast_reference(now), 'updatedAt': now.isoformat(), 'status': 'unavailable', 'rows': [], 'errors': []}
        try:
            month_data = api.monthly_users([r['soopId'] for r in stats], forecast['referenceMonth'])
            forecast.update(month_data)
            forecast['fallbackCount'] = sum(row.get('fallback', False) for row in forecast['rows'])
            scored_ids = {r['soopId'] for r in stats if r['status'] == 'ok'}
            available_ids = {r['soopId'] for r in forecast['rows']}
            forecast['status'] = 'ok' if scored_ids <= available_ids else 'unavailable'
            for error in forecast['errors']:
                log_event('monthly_streamer_failed', **error)
        except HTTPError as exc:
            if exc.code==429:raise
            forecast['errors'] = [{'message': str(exc)}]
            log_event('monthly_collection_failed', reason=str(exc))
        except Exception as exc:
            forecast['errors'] = [{'message': str(exc)}]
            log_event('monthly_collection_failed', reason=str(exc))
        # All fetches must remain inside the same Korean calendar date / evaluation window.
        if collection_date() != as_of:
            raise ValueError('수집 중 KST 날짜 변경: 다음 실행에서 다시 수집합니다.')
        result = {
            'schemaVersion': 1, 'status': 'ok', 'asOf': as_of,
            'updatedAt': now.isoformat(), 'attemptedAt': now.isoformat(),
            'periodFrom': '2026-01-01', 'periodEnd': '2026-11-30',
            'source': 'Trackify 공개 통계', 'sourceCount': len(rows),
            'dateNote': '한국 시간 수집일 기준 연간 누적 통계입니다. 당일은 진행 중이며 원본 갱신 지연이 있을 수 있습니다.',
            'streamers': stats, 'exclusions': exclusions, 'errors': [],
            'unavailableCount': sum(row['status'] == 'unavailable' for row in stats),
            'completedAt': datetime.now(timezone.utc).isoformat(),
            'forecast': forecast,
            'simulationBaseline': simulation_baseline(stats, old, now),
        }
        if history_dir and old.get('streamers') and old.get('updatedAt'):
            stamp = datetime.fromisoformat(old['updatedAt']).strftime('%Y%m%dT%H%M%SZ')
            archived = history_dir / (stamp + '.json')
            if not archived.exists():
                atomic_json(archived, old)
        atomic_json(output, result)
        run_status='updated'
        log_event('snapshot_published', candidates=len(stats), scored=len(stats)-result['unavailableCount'],
                  unavailable=result['unavailableCount'], updatedAt=result['updatedAt'],
                  elapsedSeconds=round(time.monotonic()-started, 2))
        return True
    except Exception as exc:
        block=record_429(exc,block_state,datetime.now(timezone.utc),atomic_json)
        if block:
            run_status='api_blocked'
            collection_status(output,old,now,'api_blocked',block['message'],block['blockedUntil'],block['retryAfterSeconds'])
            log_event('collection_aborted_blocked',**block)
            return False
        if old.get('simulationBaseline', {}).get('status') == 'locked' and as_of >= '2026-10-01':
            api_error=isinstance(exc,HTTPError)
            collection_status(output,old,now,'api_error' if api_error else 'anomaly',str(exc),block['blockedUntil'] if block else None)
            # Anomalies never replace a known-good public snapshot, including metadata.
            log_event('api_error' if api_error else 'anomaly' if 'anomaly:' in str(exc) else 'collection_failed', reason=str(exc), blockedUntil=block['blockedUntil'] if block else None,lastSnapshotAt=old.get('updatedAt'))
            if history_dir:
                atomic_json(history_dir / 'last-error.json', {'attemptedAt':now.isoformat(),'reason':str(exc),'lastSnapshotAt':old.get('updatedAt')})
            return False
        result = {**old, 'schemaVersion': 1, 'status': 'stale' if old.get('streamers') else 'unavailable',
                  'attemptedAt': now.isoformat(), 'message': str(exc),
                  'errors': errors, 'exclusions': old.get('exclusions', exclusions),
                  'streamers': old.get('streamers', [])}
        atomic_json(output, result)
        log_event('collection_failed', reason=str(exc), lastSnapshotAt=old.get('updatedAt'),
                  elapsedSeconds=round(time.monotonic()-started, 2))
        return False
    finally:
        report=api.request_report() if api is not None and type(getattr(api,'requests',None)) is list else None
        if report is not None:
            log_event('api_request_summary',**{k:v for k,v in report.items() if k!='requests'})
            if production:atomic_json(Path(api.audit_dir)/'request-report.json',report)
            status_path=output.with_name('collection-status.json')
            if status_path.exists():
                status=json.loads(status_path.read_text())
                atomic_json(status_path,{**status,'lastRunApiRequests':{k:v for k,v in report.items() if k!='requests'}})
        finish_daily(daily_state,run_status,report,atomic_json)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/data/ranking.json')
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--history-dir', type=Path, help='이전 스냅샷 보관 경로 (public root 밖)')
    parser.add_argument('--block-state', type=Path, help='Trackify Retry-After 상태 파일')
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.with_suffix('.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            sys.exit('다른 수집 프로세스가 실행 중입니다.')
        sys.exit(0 if collect(args.output, args.force, args.history_dir, args.block_state) else 1)
