#!/usr/bin/env python3
"""One morning source check, with no full collection and no snapshot publication."""
import argparse
import fcntl
import json
from pathlib import Path
import sys
from datetime import datetime,timezone
from urllib.error import HTTPError

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from services.trackify import Trackify,KST,number
from scripts.collect import atomic_json
from scripts.trackify_block import active,record_429
from scripts.viewer_adjustments import adjust,raw_previous


def check(output,ranking,block,policy_path,expected_date,now=None,api_factory=None):
    now=now or datetime.now(timezone.utc)
    local=now.astimezone(KST)
    if local.date().isoformat()!=expected_date or not 8<=local.hour<12:
        return {'status':'outside_requested_morning','apiRequests':0,'published':False}
    output.parent.mkdir(parents=True,exist_ok=True)
    marker=output.with_name(output.stem+'-started.json')
    with marker.open('x') as handle:json.dump({'startedAt':now.isoformat(),'policy':'exactly one viewer-only source check'},handle)
    result={'checkedAt':now.isoformat(),'checkType':'singgyul_viewer_only','published':False,'fullCollection':False,'donorBalloonUpdated':False}
    with ranking.with_suffix('.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            result.update(status='skipped_collection_busy',apiRequests=0);atomic_json(output,result);return result
        snapshot=json.loads(ranking.read_text());before=ranking.read_bytes()
        status_path=ranking.with_name('collection-status.json')
        status=json.loads(status_path.read_text()) if status_path.exists() else {}
        blocked=active(block,now)
        api=None
        if blocked:
            result.update(status='skipped_blocked',apiRequests=0,blockedUntil=blocked['blockedUntil'])
        else:
            api=(api_factory or Trackify)()
            api.audit_dir=output.parent/'morning-viewer-responses'
            try:
                raw=api.overview('singgyul')
                if raw.get('userId')!='singgyul':raise ValueError('Streamer ID mismatch')
                viewer=number(raw,'totalViewCountDelta')
                if not float(viewer).is_integer():raise ValueError('Non-integer viewer')
                current=next(r for r in snapshot['streamers'] if r['soopId']=='singgyul')
                prior=raw_previous(snapshot,current)
                result.update(rawViewer=int(viewer),previousRawViewer=prior['cumulativeUsers'],rawDelta=int(viewer)-prior['cumulativeUsers'])
                policy=json.loads(policy_path.read_text())
                adjusted=adjust({**current,'cumulativeUsers':int(viewer)},prior,policy,expected_date)
                result.update(status='checked',viewerAdjustmentTotal=adjusted['viewerAdjustmentTotal'],
                              adjustedViewer=adjusted['cumulativeUsers'],dailyViewerReference=policy.get('sourceCorrectionReview',{}).get('dailyViewerReference'))
            except Exception as exc:
                gate=record_429(exc,block,datetime.now(timezone.utc),atomic_json)
                result.update(status='api_blocked' if gate else 'review_required' if 'review_required' in str(exc) else 'error',reason=str(exc))
                if gate:
                    result.update(blockedUntil=gate['blockedUntil'],retryAfterSeconds=gate['retryAfterSeconds'])
                    status.update(collectionStatus='api_blocked',blockedUntil=gate['blockedUntil'],retryAfterSeconds=gate['retryAfterSeconds'])
            result['apiRequests']=len(api.requests) if type(getattr(api,'requests',None)) is list else 1
        atomic_json(output,result)
        status['singgyulMorningViewerCheck']=result
        atomic_json(status_path,status)
        assert ranking.read_bytes()==before
        return result


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--date',required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    result=check(args.output,Path('/var/www/singdboo-site/public/assets/data/ranking.json'),
                 Path('/var/lib/soop-ranking/control/trackify-block.json'),ROOT/'data/viewer-adjustments.json',args.date)
    print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':main()
