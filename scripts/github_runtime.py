#!/usr/bin/env python3
"""GitHub hosting adapters. All rankings/forecasts use the existing calculation modules."""
import argparse
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import subprocess
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from services.trackify import KST
from scripts.collect import atomic_json
from scripts import collect as collector
from scripts.dynamic_collect import calculate_targets, daily_record
from scripts.manual_update_singgyul import prepare as prepare_single, observation, metric
from scripts.manual_batch_update import prepare as prepare_batch, parse_table, match_table
from scripts.trend_history import history_before_update
from scripts.viewer_adjustments import adjust, raw_previous

METRICS={'viewer':'cumulativeUsers','donor':'donorCount','balloon':'balloonCount'}
PROTECTED=('simulationBaseline','supportBaseline','rollingForecast','forecast','exclusions','rankingExceptions')


def read(path,default=None):
    return json.loads(path.read_text()) if path.exists() else copy.deepcopy(default)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def adjusted_policy(policy,desired,reason,observed,now):
    result=copy.deepcopy(policy)
    if desired in (None,''):
        return result
    total=sum(e['delta'] for e in result['viewerAdjustments'] if e['date']<=observed.date().isoformat())
    try:wanted=int(desired)
    except (TypeError,ValueError):raise ValueError('viewer_adjustment must be the cumulative negative integer, for example -70000')
    if wanted>total:
        raise ValueError('Existing corrections cannot be reset/reduced here; review the source-correction policy separately')
    if wanted==total:
        return result
    if not reason.strip():
        raise ValueError('A reason is required when adding a suspected-viewbot adjustment')
    result['viewerAdjustments'].append({'eventId':'github-'+now.strftime('%Y%m%dT%H%M%S%fZ'),
        'date':observed.date().isoformat(),'delta':wanted-total,'reason':'suspected_viewbot_traffic',
        'source':'operator_github_workflow','userReason':reason.strip(),'amountIsApproximate':True})
    result['assumptionReview']={'confirmedBy':'operator_github_workflow','reviewedOn':observed.date().isoformat(),
        'adjustmentEntries':len(result['viewerAdjustments']),'total':wanted,'notLogMeasured':True}
    return result


def check_protected(old,new):
    for key in PROTECTED:
        if old.get(key)!=new.get(key):raise ValueError('Protected forecast input changed: '+key)
    if [r['soopId'] for r in old['streamers']]!=[r['soopId'] for r in new['streamers']]:
        raise ValueError('Candidate rules/cohort changed')


def month_reference(snapshot,observed):
    if observed.date().isoformat()=='2026-10-31':
        month={'date':'2026-10-31','observedAt':observed.isoformat(),'source':'operator_github_workflow',
            'rows':[{k:copy.deepcopy(row.get(k)) for k in ['soopId',*METRICS.values(),'metricObservedAt']} for row in snapshot['streamers']]}
        snapshot['octoberObservation']=month
        snapshot['oct31Observation']={**copy.deepcopy(month),'status':'last_observation_not_exact_midnight','isFinal':False}


def prepare_manual(old,policy,*,mode='single',viewer='',donor='',balloon='',observed_at='',viewer_adjustment='',
                   reason='',allow_correction=False,annual_text='',now=None):
    now=now or datetime.now(timezone.utc)
    observed=observation(observed_at or None,now)
    policy=adjusted_policy(policy,viewer_adjustment,reason,observed,now)
    previous=next(row for row in old['streamers'] if row['soopId']=='singgyul')
    if mode=='annual_batch':
        rows=parse_table(annual_text,source_sort='viewer_desc')
        matched,_=match_table(rows,old)
        prior={row['soopId']:raw_previous(old,row) for row in old['streamers']}
        decreases=sum(row['viewer']<prior[row['soopId']]['cumulativeUsers'] for row in matched)
        if decreases>len(matched)//2:
            raise ValueError('Most annual totals decreased: check that this is an annual table, not a monthly/30-day table')
        if decreases and not allow_correction:
            raise ValueError('Annual source decrease requires allow_correction and existing source-review rules')
        working,report,summary=prepare_batch(old,annual_text,observed,policy,ROOT,source_sort='viewer_desc')
        source_meta={'date':observed.date().isoformat(),'precision':'minute','observedAt':observed.isoformat(),
                     'exactSourceTimestampProvided':bool(observed_at),'observationTimestampRole':'operator_github_workflow'}
        working['manualBatchOverride'].update(sourcePeriod={'from':'2026-01-01','through':observed.date().isoformat()},
                                             sourceObservation=source_meta,sourceFileSha256=digest(annual_text.encode()))
        working['manualOverride']['sourceObservation']=source_meta
    elif mode=='single':
        if viewer=='':raise ValueError('viewer is required and must be the raw annual total')
        values={label:metric(str(value)) if value not in ('',None) else previous[key]
                for label,key in METRICS.items() for value in [{'viewer':viewer,'donor':donor,'balloon':balloon}[label]]}
        raw={**copy.deepcopy(previous),**{METRICS[label]:value for label,value in values.items()}}
        adjusted=adjust(raw,raw_previous(old,previous),policy,observed.date().isoformat())
        values['viewer']=adjusted['cumulativeUsers']
        prior=copy.deepcopy(old)
        target=next(row for row in prior['streamers'] if row['soopId']=='singgyul')
        dates=target.setdefault('metricObservedAt',{})
        for label,key in METRICS.items():
            if label=='viewer' or {'donor':donor,'balloon':balloon}.get(label) not in ('',None):
                dates[key]=observed.isoformat()
        competitor_dates=[row.get('metricObservedAt',{}).get('cumulativeUsers') for row in old['streamers'] if row['soopId']!='singgyul']
        prior['competitorDataAsOf']=max((d for d in competitor_dates if d),default=old.get('competitorDataAsOf',old['updatedAt']))
        prior['updatedAt']=observed.isoformat()
        working,report,summary=prepare_single(prior,values,observed,now,allow_correction,ROOT)
        working.pop('manualBatchOverride',None)
        target=next(row for row in working['streamers'] if row['soopId']=='singgyul')
        for key in ['rawMetrics','viewerAdjustments','viewerAdjustmentTotal','adjustedMetrics','viewerAdjustmentSourceCheck']:
            target[key]=copy.deepcopy(adjusted[key])
        if donor in ('',None):target['donorSource']=previous.get('donorSource','previous_snapshot')
        working['manualOverride'].update(rawViewer=adjusted['rawMetrics']['viewer'],adjustedViewer=adjusted['cumulativeUsers'],
            adjustment=adjusted['viewerAdjustmentTotal'],viewerAdjustments=adjusted['viewerAdjustments'],
            rawMetrics=adjusted['rawMetrics'],adjustedMetrics=adjusted['adjustedMetrics'],
            source='operator_github_workflow',reason='suspected_viewbot_traffic' if adjusted['viewerAdjustmentTotal']<0 else 'operator_verified_manual_input',
            sourceObservation={'date':observed.date().isoformat(),'precision':'minute','observedAt':observed.isoformat(),'exactSourceTimestampProvided':bool(observed_at)})
        working['trendHistory']=history_before_update(old,working)
    else:
        raise ValueError('Unknown update mode')
    month_reference(working,observed)
    report=calculate_targets(ROOT,working,now)
    working['targetResults']=report
    check_protected(old,working)
    summary={**summary,'observedAt':observed.isoformat(),'sourceMode':mode,'rawViewer':working['manualOverride']['rawViewer'],
        'adjustedViewer':working['manualOverride']['adjustedViewer'],'viewerAdjustment':working['manualOverride']['adjustment'],
        'safeTarget':report['dynamic']['safe'],'predictedRank':report['dynamic']['predictedRank'],
        'models':{m['model']:m['remaining'] for m in report['dynamic']['models']}}
    return working,policy,summary


def run_manual(root=ROOT,*,dry_run=True,annual_table_path='data/incoming/annual.txt',**inputs):
    root=Path(root);output=root/'assets/data/ranking.json'
    original=output.read_bytes();old=json.loads(original);policy=read(root/'data/viewer-adjustments.json')
    if inputs.get('mode')=='annual_batch':
        path=(root/annual_table_path).resolve()
        if not path.is_relative_to((root/'data/incoming').resolve()) or path.suffix!='.txt':
            raise ValueError('annual_table_path must be a .txt file inside data/incoming')
        inputs['annual_text']=path.read_text()
    working,new_policy,summary=prepare_manual(old,policy,**inputs)
    summary.update(dryRun=dry_run,published=False,snapshotHash=digest(original))
    if dry_run:return summary
    with output.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if digest(output.read_bytes())!=summary['snapshotHash']:
            raise ValueError('Snapshot changed after preview; run again against current main')
        applied=inputs.get('now') or datetime.now(timezone.utc);stamp=applied.strftime('%Y%m%dT%H%M%S%fZ')
        history=root/'history';atomic_json(history/'manual'/('before-'+stamp+'.json'),old)
        atomic_json(history/'manual'/(stamp+'.json'),{**summary,'source':'operator_github_workflow','rawAndAdjustedPreserved':True})
        daily=daily_record(working,working['targetResults'],datetime.fromisoformat(summary['observedAt']))
        dates={row['soopId']:row.get('metricObservedAt',{}) for row in working['streamers']}
        for row in daily['rows']:row['metricObservedAt']=dates[row['soopId']]
        daily.update(source='manual',collectionMode='manual_partial',manualOverride=working['manualOverride'],
                     actualDataScope=working['actualDataScope'],rankingExceptions=working.get('rankingExceptions'))
        atomic_json(history/'daily'/(summary['observedAt'][:10]+'.json'),daily)
        status=read(output.with_name('collection-status.json'),{})
        status.update(lastManualUpdate=applied.isoformat(),lastDataChange=working['lastDataChangeAt'],
            snapshotUpdatedAt=working['updatedAt'],collectionStatus='manual_partial',collectionMode='manual_partial',
            actualDataScope=working['actualDataScope'],publicationStatus='published_manual_partial')
        status['viewerAdjustmentReview']={'applied':True,'assumptionBased':True,'rawViewer':summary['rawViewer'],
            'viewerAdjustmentTotal':summary['viewerAdjustment'],'adjustedViewer':summary['adjustedViewer']}
        atomic_json(root/'data/viewer-adjustments.json',new_policy)
        atomic_json(output.with_name('collection-status.json'),status)
        atomic_json(output,working)
    return {**summary,'published':True}


def run_collection(root=ROOT,*,dry_run=True,enabled=False):
    root=Path(root);output=root/'assets/data/ranking.json';old_bytes=output.read_bytes();old=json.loads(old_bytes)
    if dry_run or not enabled:
        report=calculate_targets(ROOT,old,datetime.now(timezone.utc))
        return {'dryRun':True,'published':False,'apiRequests':0,'collectorEnabled':enabled,
                'safeTarget':report['dynamic']['safe'],'predictedRank':report['dynamic']['predictedRank'],
                'blockedUntil':read(root/'state/trackify-block.json',{}).get('blockedUntil')}
    state=root/'state';state.mkdir(exist_ok=True);history=root/'history';history.mkdir(exist_ok=True)
    collector.PRODUCTION_OUTPUT=output.resolve()
    collector.BLOCK_STATE=state/'trackify-block.json';collector.DAILY_STATE=state/'daily-collection.json'
    with output.with_suffix('.lock').open('a') as lock, tempfile.TemporaryDirectory() as temp:
        fcntl.flock(lock,fcntl.LOCK_EX)
        saved=Path(temp)/'history';shutil.copytree(history,saved)
        prior_status=read(output.with_name('collection-status.json'),{})
        prior_daily=read(collector.DAILY_STATE,{})
        successful=False
        original_claim=collector.claim_daily
        if os.environ.get('PERSIST_DAILY_CLAIM')=='true':
            def persistent_claim(path,status_path,now,writer):
                claimed=original_claim(path,status_path,now,writer)
                if claimed:persist_daily_claim(root,path)
                return claimed
            collector.claim_daily=persistent_claim
        try:
            ok=collector.collect(output,force=True,history_dir=history,block_state=collector.BLOCK_STATE,
                daily_state=collector.DAILY_STATE,adjustment_policy=read(root/'data/viewer-adjustments.json'))
            status=read(output.with_name('collection-status.json'),{})
            successful=ok and status.get('collectionStatus') in ('updated','metrics_unchanged','source_correction')
            if successful and output.read_bytes()!=old_bytes:
                current=read(output)
                check_protected(old,current)
                if current.get('collectionMode')=='automatic':
                    current.pop('manualBatchOverride',None)
                    atomic_json(output,current)
        except Exception as exc:
            successful=False
            status={**prior_status,'collectionStatus':'validation_failed','reason':type(exc).__name__,
                    'snapshotUpdatedAt':old['updatedAt'],'lastCollectionAttempt':datetime.now(timezone.utc).isoformat()}
            atomic_json(output.with_name('collection-status.json'),status)
            daily=read(collector.DAILY_STATE,{})
            if daily:atomic_json(collector.DAILY_STATE,{**daily,'status':'validation_failed'})
        finally:
            collector.claim_daily=original_claim
        if not successful:
            output.write_bytes(old_bytes)
            shutil.rmtree(history);shutil.copytree(saved,history)
        daily=read(collector.DAILY_STATE,{})
        if isinstance(daily.get('apiRequests'),dict):daily['apiRequests'].pop('requests',None)
        if daily:atomic_json(collector.DAILY_STATE,daily)
    attempted=bool(daily.get('startedAt') and daily.get('startedAt')!=prior_daily.get('startedAt'))
    return {'dryRun':False,'published':successful and output.read_bytes()!=old_bytes,'collectionOk':successful,
            'collectionStatus':status.get('collectionStatus'),'newAttempt':attempted,
            'apiRequests':(daily.get('apiRequests') or {}).get('totalRequests',0) if attempted else 0,
            'rankingPreservedOnFailure':successful or output.read_bytes()==old_bytes}


def persist_daily_claim(root,path):
    """Persist the existing gate before any API call, including runner failure/cancellation."""
    branch=os.environ['DEFAULT_BRANCH']
    commands=[['git','config','user.name','github-actions[bot]'],
              ['git','config','user.email','41898282+github-actions[bot]@users.noreply.github.com'],
              ['git','add','--',str(Path(path).relative_to(root))],
              ['git','commit','-m','chore(state): claim daily collection '+read(Path(path))['kstDate']],
              ['git','push','origin','HEAD:'+branch]]
    for command in commands:subprocess.run(command,cwd=root,check=True)


def emit(summary):
    print(json.dumps(summary,ensure_ascii=False,indent=2))
    path=os.environ.get('GITHUB_STEP_SUMMARY')
    if path:
        with open(path,'a') as out:out.write('## Ranking update result\n\n```json\n'+json.dumps(summary,ensure_ascii=False,indent=2)+'\n```\n')


def main():
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['manual','collect'])
    parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    dry=not args.apply and os.environ.get('INPUT_DRY_RUN','true').lower()!='false'
    if args.command=='manual':
        fields={key:os.environ.get('INPUT_'+key.upper(),'') for key in ['viewer','donor','balloon','observed_at','viewer_adjustment','reason']}
        summary=run_manual(dry_run=dry,mode=os.environ.get('INPUT_MODE','single'),
            allow_correction=os.environ.get('INPUT_ALLOW_CORRECTION','false').lower()=='true',
            annual_table_path=os.environ.get('INPUT_ANNUAL_TABLE_PATH','data/incoming/annual.txt'),**fields)
    else:
        summary=run_collection(dry_run=dry,enabled=os.environ.get('COLLECTOR_ENABLED','false').lower()=='true')
    emit(summary)


if __name__=='__main__':main()
