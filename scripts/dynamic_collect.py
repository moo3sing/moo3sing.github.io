"""Annual support actuals and immutable September forecast inputs."""
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
from datetime import datetime, timezone
from services.trackify import number, KST, collection_date
from scripts.source_corrections import confirm_correction, current_source_observation
from scripts.growth_guard import confirm_growth
from scripts.viewer_adjustments import raw_previous, adjust

KEYS=('cumulativeUsers','donorCount','balloonCount')


def integer(data,key):
    n=number(data,key)
    if not float(n).is_integer():raise ValueError('Non-integer '+key)
    return int(n)


def annual_actual(raw,base):
    if not isinstance(raw,dict) or type(raw.get('isBalloonHidden')) is not bool:raise ValueError('Annual response schema changed')
    if raw.get('userId') != base['soopId']:raise ValueError('Annual account mismatch')
    viewer=integer(raw,'totalViewCountDelta')
    if base['status']=='unavailable':
        return {**base,'cumulativeUsers':viewer,'donorEstimated':False}
    if raw.get('isBalloonHidden'):raise ValueError('Support became unavailable: '+base['soopId'])
    return {**base,'cumulativeUsers':viewer,'donorCount':integer(raw,'monthDonors'),
            'balloonCount':integer(raw,'monthBalloon'),'donorEstimated':False,
            'donorSource':'annual-overview.monthDonors; granularity=month&period=2026'}


def dynamic_snapshot(api,old,now,adjustment_policy=None,source_approvals=None,source_policy=None):
    collection_date(now)  # Also protects callers outside the CLI collector.
    baseline=old['simulationBaseline']
    if baseline['status']!='locked':raise ValueError('September baseline not locked')
    prior={r['soopId']:r for r in old['streamers']}
    stats=[]
    corrections=[]
    growth=[]
    trends={r["soopId"]:r for r in old.get("rollingForecast",{}).get("rows",[])}
    prefetched={}
    if adjustment_policy:
        # Preserve today's raw comparison even if an earlier competitor later fails validation.
        prefetched['singgyul']=api.overview('singgyul')
        target_base=next(r for r in baseline['rows'] if r['soopId']=='singgyul')
        target_raw=annual_actual(prefetched['singgyul'],target_base)
        previous_raw=raw_previous(old,prior['singgyul'])
        adjusted=adjust(target_raw,previous_raw,adjustment_policy,now.astimezone(KST).date().isoformat())
    for base in baseline['rows']:
        collection_date()
        raw=prefetched[base['soopId']] if base['soopId'] in prefetched else api.overview(base['soopId'])
        row=annual_actual(raw,base)
        previous=raw_previous(old,prior[base['soopId']])
        approved_source=current_source_observation(base,previous,row,source_policy)
        if approved_source is not None:
            corrections.extend(approved_source)
        else:
            row, confirmed = confirm_correction(api,base,previous,row,annual_actual,source_approvals)
            corrections.extend(confirmed)
            row, verified = confirm_growth(api,base,previous,row,annual_actual,trends.get(base["soopId"]),old.get("actualObservedAt",old["updatedAt"]),now)
            growth.extend(verified)
        if adjustment_policy and base['soopId']=='singgyul':
            row=adjust(row,previous,adjustment_policy,now.astimezone(KST).date().isoformat())
        row.pop('actualSource',None)
        row['actualGain']={k:None if row[k] is None or base[k] is None else row[k]-base[k] for k in KEYS}
        stats.append(row)
    support=old.get('supportBaseline')
    if not support:
        rows=[]
        monthly={r['soopId']:r for r in old['forecast']['rows']}
        for base in baseline['rows']:
            if base['status']=='unavailable':continue
            # Preserve existing explicit inactive-account fallback month.
            month=monthly[base['soopId']].get('referenceMonth','2026-09')
            raw=api.get('/streamer/'+base['soopId'],{'granularity':'day','period':month})
            if raw.get('userId')!=base['soopId'] or raw.get('isBalloonHidden'):raise ValueError('September support missing')
            rows.append({'soopId':base['soopId'],'donorCount':integer(raw,'monthDonors'),
                         'balloonCount':integer(raw,'monthBalloon'),'referenceMonth':month,'fallback':month!='2026-09'})
        support={'status':'locked','capturedAt':now.isoformat(),'referenceMonth':'2026-09','rows':rows}
    changed=old.get('liveTargetVersion')!=2 or any(any(r[k]!=prior[r['soopId']][k] for k in KEYS) for r in stats)
    final=now.astimezone(KST).strftime('%m-%d %H:%M')>='11-30 23:58'
    if not changed and not final:return None
    result={**old,'verifiedGrowth':growth,'sourceCorrections':corrections,'status':'ok','errors':[],'streamers':stats,'supportBaseline':support,'liveTargetVersion':2,
            'updatedAt':now.isoformat(),'attemptedAt':now.isoformat(),'asOf':now.astimezone(KST).date().isoformat(),
            'completedAt':datetime.now(timezone.utc).isoformat(),'lastDataChangeAt':now.isoformat() if changed else old.get('lastDataChangeAt',old['updatedAt']),
            'dataReliability':{'viewer':{'class':'B','source':'annual-overview.totalViewCountDelta','uniquePeople':False},
                               'donors':{'class':'B','source':'annual-overview.monthDonors','annualUnique':True,'estimated':False,'validation':'official period mapping + full distinct-ID cross-check on two accounts'},
                               'balloons':{'class':'A/B','source':'annual-overview.monthBalloon','additive':True}}}
    result.pop('message',None)
    if final:result['finalObservationAt']=now.isoformat()
    return result


def daily_observations(history_dir,now):
    if not history_dir:return []
    today=now.astimezone(KST).date().isoformat();rows=[]
    for path in sorted((history_dir/'daily').glob('2026-*.json'))[-16:]:
        data=json.loads(path.read_text())
        if data['date']<today:rows.append({'observedAt':data['observedAt'],'rows':data['rows']})
    return rows[-15:]


def calculate_targets(root,snapshot,now):
    node=os.environ.get('NODE_BINARY') or str(root/'runtime/node')
    if not Path(node).exists():node=shutil.which('node') or node
    run=subprocess.run([node,str(root/'scripts/dynamic-report.js')],input=json.dumps({'snapshot':snapshot,'now':now.isoformat()}),text=True,capture_output=True,timeout=60)
    if run.returncode:raise ValueError('Target calculation failed: '+run.stderr[-1000:])
    return json.loads(run.stdout)


def daily_record(snapshot,report,now):
    return {'date':now.astimezone(KST).date().isoformat(),'observedAt':now.isoformat(),'dataUpdatedAt':snapshot['updatedAt'],
            'rows':[{k:r.get(k) for k in ('soopId',*KEYS)} for r in snapshot['streamers']],
            'targets':{m['model']:m['remaining'] for m in report['dynamic']['models']},
            'safeTarget':report['dynamic']['safe'],'fixedSafeTarget':report['fixed']['safe'],'difference':report['difference'],
            'forecastMethod':report['dynamic']['mode'],
            'projectedRows':report['dynamic']['projectedRows'],
            'viewerAdjustmentMetadata':[{k:r[k] for k in ('soopId','rawMetrics','viewerAdjustments','viewerAdjustmentTotal','adjustedMetrics','viewerAdjustmentSourceCheck') if k in r} for r in snapshot['streamers'] if 'rawMetrics' in r]}
