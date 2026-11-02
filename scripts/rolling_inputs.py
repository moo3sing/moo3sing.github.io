"""Read-only July–September trend inputs, separate from immutable Sep30 baseline."""
import math
from urllib.error import HTTPError
from services.trackify import collection_date, KST
MONTHS=['2026-07','2026-08','2026-09']
DAYS={'2026-07':31,'2026-08':31,'2026-09':30}

def valid(n):return type(n) in (int,float) and math.isfinite(n) and n>=0 and n==int(n)

def trend_selection(values,fallback):
    if all(m in values for m in MONTHS):months=MONTHS;weights=[.2,.3,.5];reason=None
    elif all(m in values for m in MONTHS[1:]):months=MONTHS[1:];weights=[.4,.6];reason='July missing; August/September fallback'
    elif MONTHS[2] in values:months=MONTHS[2:];weights=[1];reason='July/August incomplete; September fallback'
    else:return {'daily':fallback,'months':[],'weights':[],'monthlyGains':values,'fallbackReason':'Recent coverage incomplete; preserved legacy fallback'}
    return {'daily':sum(values[m]/DAYS[m]*w for m,w in zip(months,weights)),'months':months,'weights':weights,'monthlyGains':values,'fallbackReason':reason}

def build_rolling_inputs(api,old,now,log):
    if old.get('rollingForecast',{}).get('method')=='recent_trend_actual_rolling':return old['rollingForecast']
    candidates=[r for r in old['simulationBaseline']['rows'] if r['status']!='unavailable']
    ids=','.join(r['soopId'] for r in candidates);monthly={};errors=[]
    for month in MONTHS:
        collection_date()
        try:
            raw=api.get('/ranking/summary',{'range':'monthly','date':month,'sortKey':'uviewer','order':'desc','page':1,'size':200,'ids':ids})
            if raw.get('periodType')!='monthly' or raw.get('periodKey')!=month or not isinstance(raw.get('items'),list):raise ValueError('month summary schema/period mismatch')
            rows=raw['items'];index={r['broadUserId']:r for r in rows}
            if len(index)!=len(rows):raise ValueError('duplicate monthly account')
            monthly[month]=index
        except HTTPError as exc:
            if exc.code == 429: raise
            monthly[month]={};errors.append({'month':month,'reason':str(exc)});log('rolling_month_unavailable',month=month,reason=str(exc))
        except Exception as exc:
            monthly[month]={};errors.append({'month':month,'reason':str(exc)});log('rolling_month_unavailable',month=month,reason=str(exc))
    legacy_view={r['soopId']:r['recentMonthlyUsers']/30 for r in old['forecast']['rows']}
    legacy_support={r['soopId']:r for r in old['supportBaseline']['rows']}
    result=[]
    for base in candidates:
        account=base['soopId'];support=legacy_support[account];row={'soopId':account}
        for key,field,fallback in [('cumulativeUsers','uniqueViewers',legacy_view[account]),('balloonCount','balloon',support['balloonCount']/30)]:
            values={m:monthly[m][account][field] for m in MONTHS if account in monthly[m] and valid(monthly[m][account].get(field))}
            row[key]=trend_selection(values,fallback)
            if row[key]['fallbackReason']:log('rolling_fallback',streamerId=account,metric=key,reason=row[key]['fallbackReason'])
        row['donorCount']={'daily':min(support['donorCount']/30,base['donorCount']/273),'months':[], 'weights':[],
            'fallbackReason':'Monthly unique donors cannot identify new-to-year donor gains; preserved conservative base'}
        result.append(row)
    log('rolling_donor_semantics',reason='Annual unique actuals only; monthly unique donors never added',candidates=len(result))
    return {'method':'recent_trend_actual_rolling','version':1,'capturedAt':now.isoformat(),'baseMonths':MONTHS,'baseWeights':[.2,.3,.5],'rows':result,'errors':errors}

def month_state(working,old,now,history):
    """Retain the latest verified October observation; freeze its use in November."""
    date=now.astimezone(KST).date().isoformat()
    if date<'2026-11-01':
        working['octoberObservation']={'date':date,'observedAt':now.isoformat(),'rows':[{k:r.get(k) for k in ['soopId','cumulativeUsers','donorCount','balloonCount']} for r in working['streamers']]}
    else:
        from datetime import datetime
        candidates=[h for h in [old.get('octoberObservation'),*history] if h and '2026-10-01'<=datetime.fromisoformat(h['observedAt']).astimezone(KST).date().isoformat()<='2026-10-31']
        previous=max(candidates,key=lambda h:h['observedAt']) if candidates else None
        if previous:
            working['octoberObservation']=previous
            day=datetime.fromisoformat(previous['observedAt']).astimezone(KST).date().isoformat()
            if day=='2026-10-31':working['oct31Observation']={**previous,'status':'last_observation_not_exact_midnight'}
