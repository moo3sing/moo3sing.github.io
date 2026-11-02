#!/usr/bin/env python3
"""Offline, single-account actual override followed by full simulation recalculation."""
import argparse
import copy
import fcntl
import hashlib
import json
import re
import shutil
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from scripts.collect import atomic_json
from scripts.dynamic_collect import calculate_targets, daily_record
from services.trackify import KST

PRODUCTION=Path('/var/www/singdboo-site/public/assets/data/ranking.json')
HISTORY=Path('/var/lib/soop-ranking/history')
BACKUPS=Path('/var/backups/soop-ranking/manual')
TARGET='singgyul'
KEYS={'viewer':'cumulativeUsers','donor':'donorCount','balloon':'balloonCount'}
MAX_SAFE=2**53-1
LIMITS={'viewer':1_000_000_000,'donor':10_000_000,'balloon':1_000_000_000_000}

def metric(value):
    if not re.fullmatch(r'[0-9]+',value):raise argparse.ArgumentTypeError('0 이상의 정수만 입력하세요')
    n=int(value)
    if n>MAX_SAFE:raise argparse.ArgumentTypeError('JavaScript 안전 정수 범위 초과')
    return n

def observation(value,now):
    if value:
        try:result=datetime.strptime(value,'%Y-%m-%d %H:%M').replace(tzinfo=KST)
        except ValueError as exc:raise ValueError('--observed-at 형식: YYYY-MM-DD HH:MM (KST)') from exc
    else:result=now.astimezone(KST)
    if result<datetime(2026,10,1,tzinfo=KST) or result>min(now.astimezone(KST)+timedelta(minutes=5),datetime(2026,12,1,tzinfo=KST)):
        raise ValueError('관측 시각은 10/1~11/30 KST이며 미래 5분을 넘길 수 없습니다')
    return result

def prepare(old,values,observed,applied,allow_correction,root=ROOT):
    if old.get('simulationBaseline',{}).get('status')!='locked' or old.get('rollingForecast',{}).get('method')!='recent_trend_actual_rolling':
        raise ValueError('마지막 정상 baseline/rolling snapshot 누락')
    if old.get('status')!='ok':raise ValueError('마지막 정상 snapshot 상태가 아닙니다')
    previous=next((r for r in old['streamers'] if r['soopId']==TARGET),None)
    if not previous or previous['status']!='ok':raise ValueError('띵귤 actual을 확인할 수 없습니다')
    minimum=datetime.fromisoformat(old.get('manualOverride',{}).get('observedAt') or old.get('actualObservedAt') or old['updatedAt'])
    if observed<minimum:raise ValueError('수동 관측 시각이 마지막 확인 시각보다 이전입니다')
    corrections=[]
    for label,key in KEYS.items():
        value=values[label]
        if type(value) is not int or not 0<value<=min(MAX_SAFE,LIMITS[label]):raise ValueError(label+' 값은 안전 범위의 양의 정수여야 합니다')
        if value<previous[key]:corrections.append({'streamerId':TARGET,'streamerName':previous['name'],'metric':key,'previous':previous[key],
            'current':value,'delta':value-previous[key],'observedAt':observed.isoformat(),'reason':'manual_correction','source':'operator_verified_manual_input'})
    if corrections and not allow_correction:
        raise ValueError('감소값 확인 필요: '+', '.join(f"{x['metric']} {x['previous']} → {x['current']}" for x in corrections)+'; --allow-correction 필요')
    working=copy.deepcopy(old);target=next(r for r in working['streamers'] if r['soopId']==TARGET)
    for label,key in KEYS.items():target[key]=values[label]
    target['donorEstimated']=False;target['donorSource']='operator-verified manual annual unique input';target['actualSource']='manual'
    baseline=next(r for r in working['simulationBaseline']['rows'] if r['soopId']==TARGET)
    target['actualGain']={k:target[k]-baseline[k] for k in KEYS.values()}
    initial=old.get('manualOverride',{}).get('automaticBase') or {k:previous[k] for k in KEYS.values()}
    competitor_as_of=old.get('competitorDataAsOf') or old.get('actualObservedAt') or old['updatedAt']
    changed=any(previous[key]!=values[label] for label,key in KEYS.items())
    working.update({'collectionMode':'manual_partial','actualDataScope':'singgyul_only',
        'competitorDataAsOf':competitor_as_of,'source':'띵귤 수동 확인값 + 경쟁자 마지막 자동 수집값',
        'viewerSource':'manual-singgyul / last-automatic-competitors',
        'manualOverride':{'streamerId':TARGET,'observedAt':observed.isoformat(),'appliedAt':applied.isoformat(),
                          'metrics':values,'automaticBase':initial},
        'forecastAsOf':applied.astimezone(KST).date().isoformat(),
        'lastDataChangeAt':observed.isoformat() if changed else old.get('lastDataChangeAt',old['updatedAt']),
        'sourceCorrections':[],'verifiedGrowth':[]})
    if changed:working['updatedAt']=observed.isoformat()
    if applied.astimezone(KST).date().isoformat()<'2026-11-01':
        october=working.get('octoberObservation')
        if october:
            row=next((r for r in october['rows'] if r['soopId']==TARGET),None)
            if row:
                row.update({k:target[k] for k in KEYS.values()});row['observedAt']=observed.isoformat()
    report=calculate_targets(root,working,applied)
    expected_scored=len(working['streamers'])-report['dynamic']['pendingCount']-report['dynamic'].get('reservedCount',0)
    if len(report['dynamic']['projectedRows'])!=expected_scored or len(report['dynamic']['models'])!=3:
        raise ValueError('전체 후보/세 모델 계산이 완료되지 않았습니다')
    if old['simulationBaseline']!=working['simulationBaseline'] or old['supportBaseline']!=working['supportBaseline']:
        raise ValueError('고정 baseline 변경 감지')
    if any(a!=b for a,b in zip(old['streamers'],working['streamers']) if a['soopId']!=TARGET):
        raise ValueError('경쟁자 actual 변경 감지')
    if [r['soopId'] for r in old['streamers']]!=[r['soopId'] for r in working['streamers']]:
        raise ValueError('후보 집합 변경 감지')
    working['targetResults']=report
    json.dumps(working,ensure_ascii=False,allow_nan=False)
    summary={'mode':'manual_partial','observedAt':observed.isoformat(),'competitorDataAsOf':competitor_as_of,
             'previous':{label:previous[key] for label,key in KEYS.items()},
             'actual':{k:target[k] for k in KEYS.values()},
             'projected':{k:report['dynamic']['target']['projected'][k] for k in KEYS.values()},
             'models':{r['model']:r['remaining'] for r in report['dynamic']['models']},'safeTarget':report['dynamic']['safe'],
             'predictedRank':report['dynamic']['predictedRank'],
             'corrections':corrections}
    return working,report,summary

def run(values,observed_at=None,allow_correction=False,dry_run=False,output=PRODUCTION,history=HISTORY,backups=BACKUPS,now=None,root=ROOT,expected_snapshot_hash=None):
    now=now or datetime.now(timezone.utc);observed=observation(observed_at,now)
    lock_path=output.with_suffix('.lock')
    with lock_path.open('r' if dry_run and lock_path.exists() else 'a') as lock:
        fcntl.flock(lock,fcntl.LOCK_SH if dry_run else fcntl.LOCK_EX)
        original=output.read_bytes()
        snapshot_hash=hashlib.sha256(original).hexdigest()
        if expected_snapshot_hash is not None and snapshot_hash!=expected_snapshot_hash:
            raise ValueError('미리보기 이후 snapshot이 변경되었습니다. 다시 미리보기를 실행하세요')
        old=json.loads(original)
        working,report,summary=prepare(old,values,observed,now,allow_correction,root)
        if dry_run:return {**summary,'snapshotHash':snapshot_hash,'dryRun':True,'published':False}
        stamp=now.strftime('%Y%m%d-%H%M%S-%f')
        backup=backups/('manual-'+stamp);backup.mkdir(mode=0o700,parents=True,exist_ok=False)
        shutil.copy2(output,backup/'ranking-before.json')
        status_file=output.with_name('collection-status.json')
        if status_file.exists():shutil.copy2(status_file,backup/'collection-status-before.json')
        history_entry={**summary,'source':'manual','streamerId':TARGET,'appliedAt':now.isoformat(),
                       'previous':{k:next(r for r in old['streamers'] if r['soopId']==TARGET)[k] for k in KEYS.values()},
                       'current':summary['actual']}
        atomic_json(history/'manual'/(stamp+'.json'),history_entry)
        daily={**daily_record(working,report,now),'source':'manual','collectionMode':'manual_partial',
               'competitorDataAsOf':summary['competitorDataAsOf']}
        atomic_json(history/'daily'/(now.astimezone(KST).date().isoformat()+'.json'),daily)
        if summary['corrections']:
            atomic_json(history/'manual-corrections'/(stamp+'.json'),{'source':'manual','corrections':summary['corrections']})
        atomic_json(output,working)
        prior_status=json.loads(status_file.read_text()) if status_file.exists() else {}
        prior_status.update({'lastManualUpdate':now.isoformat(),'lastDataChange':working['lastDataChangeAt'],
                             'collectionStatus':'manual_partial','collectionMode':'manual_partial',
                             'actualDataScope':'singgyul_only','competitorDataAsOf':summary['competitorDataAsOf'],
                             'snapshotUpdatedAt':working['updatedAt']})
        prior_status.pop('reason',None)
        atomic_json(status_file,prior_status)
        return {**summary,'snapshotHash':snapshot_hash,'dryRun':False,'published':True,'backup':str(backup)}

def main():
    parser=argparse.ArgumentParser(description='Trackify 요청 없이 띵귤 실제값만 갱신하고 TOP70 전체를 재계산')
    for name in KEYS:parser.add_argument('--'+name,required=True,type=metric)
    parser.add_argument('--observed-at',help='YYYY-MM-DD HH:MM, KST. 생략하면 현재 KST')
    parser.add_argument('--allow-correction',action='store_true')
    parser.add_argument('--dry-run',action='store_true')
    args=parser.parse_args()
    try:
        result=run({k:getattr(args,k) for k in KEYS},args.observed_at,args.allow_correction,args.dry_run)
    except Exception as exc:parser.exit(1,str(exc)+'\n')
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
