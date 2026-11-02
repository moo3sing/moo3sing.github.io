"""Bounded, repeated source correction confirmation. No baseline mutation."""
import time
from datetime import datetime, timezone
from urllib.parse import quote
from services.trackify import collection_date, fresh_overview

MAX_RELATIVE_DECREASE = .05
MAX_ABSOLUTE_DECREASE = {'cumulativeUsers':1_000_000,'donorCount':1_000,'balloonCount':1_000_000}
RECHECK_SECONDS = 2
SUMMARY_FIELDS = {'cumulativeUsers':'uniqueViewers','balloonCount':'balloon'}


def current_source_observation(base,previous,current,policy):
    """User-approved competitor actuals, with signed source-change audit records."""
    scope=(policy or {}).get('competitors',{})
    if scope.get('mode')!='use_current_trackify_actuals' or scope.get('approvedBy')!='user' or base['soopId']=='singgyul':
        return None
    observed=datetime.now(timezone.utc).isoformat()
    return [{'streamerId':base['soopId'],'streamerName':base['name'],'metric':key,
             'previous':previous[key],'current':current[key],'delta':current[key]-previous[key],
             'firstDetectedTime':observed,'confirmedTime':observed,'reason':'source_correction',
             'source':'https://www.trackify.kr/api/v1/p/soop/streamer/'+quote(base['soopId'],safe='')+'?granularity=month&period=2026',
             'observations':[{'values':{key:current[key]}}],
             'policy':{'mode':'user_approved_current_competitor_source','detailObservations':1},
             'userApproval':scope}
            for key in MAX_ABSOLUTE_DECREASE if current[key] is not None and previous[key] is not None and current[key]<previous[key]]


def confirm_correction(api, base, previous, first, normalize, approvals=None):
    metrics=[k for k in MAX_ABSOLUTE_DECREASE if first[k] is not None and previous[k] is not None and first[k]<previous[k]]
    if not metrics:return first,[]
    detected=datetime.now(timezone.utc).isoformat()
    approved=[]
    for key in metrics:
        matches=[a for a in (approvals or []) if a.get('streamerId')==base['soopId'] and a.get('metric')==key
                 and a.get('previous')==previous[key] and a.get('current')==first[key]
                 and a.get('observedKstDate')==collection_date() and a.get('approvedBy')=='user']
        if len(matches)!=1:break
        approved.append({'streamerId':base['soopId'],'streamerName':base['name'],'metric':key,
                         'previous':previous[key],'current':first[key],'delta':first[key]-previous[key],
                         'firstDetectedTime':detected,'confirmedTime':detected,'reason':'source_correction',
                         'source':'https://www.trackify.kr/api/v1/p/soop/streamer/'+quote(base['soopId'],safe='')+'?granularity=month&period=2026',
                         'observations':[{'values':{key:first[key]}}],
                         'policy':{'mode':'user_approved_exact_observation','detailObservations':1},
                         'userApproval':matches[0]})
    if len(approved)==len(metrics):return first,approved
    for key in metrics:
        delta=previous[key]-first[key]
        if first[key]==0 or delta>previous[key]*MAX_RELATIVE_DECREASE or delta>MAX_ABSOLUTE_DECREASE[key]:
            raise ValueError(f'anomaly: {base["soopId"]} {key} decrease exceeds correction limits: {previous[key]} -> {first[key]}')
    observations=[{'at':detected,'values':{k:first[k] for k in metrics}}]
    latest=first
    for _ in range(2):
        time.sleep(RECHECK_SECONDS)
        collection_date()
        latest=normalize(fresh_overview(api,base['soopId']),base)
        for key in MAX_ABSOLUTE_DECREASE:
            if key in metrics:
                if latest[key]!=first[key]:raise ValueError(f'anomaly: unstable correction {base["soopId"]} {key}')
            elif latest[key] is not None and previous[key] is not None and latest[key]<previous[key]:
                raise ValueError(f'anomaly: new decrease during confirmation {base["soopId"]} {key}')
        observations.append({'at':datetime.now(timezone.utc).isoformat(),'values':{k:latest[k] for k in metrics}})
    summary=None
    if any(k in SUMMARY_FIELDS for k in metrics):
        collection_date()
        summary=api.get('/ranking/summary',{'range':'yearly','date':'2026','sortKey':'uviewer','order':'desc','page':1,'size':200,'ids':base['soopId']})
        if not isinstance(summary,dict) or summary.get('periodType')!='yearly' or summary.get('periodKey')!='2026' or not isinstance(summary.get('items'),list):
            raise ValueError('anomaly: correction summary schema/period mismatch')
        matches=[r for r in summary['items'] if r.get('broadUserId')==base['soopId']]
        if len(matches)!=1:raise ValueError('anomaly: correction summary missing/duplicate account')
        summary=matches[0]
        for key in metrics:
            if key in SUMMARY_FIELDS:
                value=summary.get(SUMMARY_FIELDS[key])
                if type(value) not in (int,float) or value!=first[key]:raise ValueError(f'anomaly: correction summary disagrees {base["soopId"]} {key}')
    confirmed=datetime.now(timezone.utc).isoformat()
    records=[]
    for key in metrics:
        records.append({'streamerId':base['soopId'],'streamerName':base['name'],'metric':key,
                        'previous':previous[key],'current':latest[key],'delta':latest[key]-previous[key],
                        'firstDetectedTime':detected,'confirmedTime':confirmed,
                        'source':'https://www.trackify.kr/api/v1/p/soop/streamer/'+quote(base['soopId'],safe='')+'?granularity=month&period=2026',
                        'reason':'source_correction','observations':observations,
                        'crossCheck':{'source':'yearly-summary.'+SUMMARY_FIELDS[key],'value':summary[SUMMARY_FIELDS[key]]} if key in SUMMARY_FIELDS else {'source':None,'note':'Annual unique donors not exposed by summary; three detail observations required'},
                        'policy':{'maxRelativeDecrease':MAX_RELATIVE_DECREASE,'maxAbsoluteDecrease':MAX_ABSOLUTE_DECREASE[key],'detailObservations':3}})
    return latest,records
