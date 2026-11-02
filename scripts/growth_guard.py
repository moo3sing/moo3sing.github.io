"""Recheck extreme positive jumps; keep verified growth as actual, never cap it."""
import time
from datetime import datetime,timezone
from services.trackify import collection_date, fresh_overview
from scripts.source_corrections import SUMMARY_FIELDS
FLOORS={'cumulativeUsers':250000,'donorCount':250,'balloonCount':250000}
def confirm_growth(api,base,previous,current,normalize,trend,previous_at,now):
    days=max(1,(now-datetime.fromisoformat(previous_at)).total_seconds()/86400)
    metrics=[k for k,floor in FLOORS.items() if current[k] is not None and previous[k] is not None and
             current[k]-previous[k]>max(floor,previous[k]*.25,(trend or {}).get(k,{}).get('daily',0)*days*10)]
    if not metrics:return current,[]
    latest=current;observations=[{k:current[k] for k in metrics}]
    for _ in range(2):
        time.sleep(2);collection_date();latest=normalize(fresh_overview(api,base['soopId']),base)
        if any(latest[k]!=current[k] for k in FLOORS):raise ValueError('anomaly: unstable daily spike '+base['soopId'])
        observations.append({k:latest[k] for k in metrics})
    if any(k in SUMMARY_FIELDS for k in metrics):
        collection_date();response=api.get('/ranking/summary',{'range':'yearly','date':'2026','sortKey':'uviewer','order':'desc','page':1,'size':200,'ids':base['soopId']})
        if response.get('periodType')!='yearly' or response.get('periodKey')!='2026':raise ValueError('anomaly: spike summary period mismatch')
        matches=[r for r in response.get('items',[]) if r.get('broadUserId')==base['soopId']]
        if len(matches)!=1:raise ValueError('anomaly: spike summary account mismatch')
        for k in metrics:
            if k in SUMMARY_FIELDS and matches[0].get(SUMMARY_FIELDS[k])!=current[k]:raise ValueError('anomaly: spike summary disagreement')
    return latest,[{'streamerId':base['soopId'],'reason':'verified_growth','metrics':metrics,'observations':observations,'confirmedAt':datetime.now(timezone.utc).isoformat()}]
