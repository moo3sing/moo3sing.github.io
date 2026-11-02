#!/usr/bin/env python3
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from services.trackify import Trackify, normalize, select_candidates

api=Trackify()
rows=api.candidates()
exclusions=json.loads((ROOT/'data/excluded-streamers.json').read_text())
selected=select_candidates(rows,exclusions)
assert len(selected)==100
assert not ({r['broadUserId'].casefold() for r in selected}&{r['soopId'].casefold() for r in exclusions})
ids=['khm11903','juju0228','he0901','singgyul','danchu17','honeys2']
results=[]
for account in ids:
    candidate=next(r for r in rows if r['broadUserId']==account)
    results.append(normalize(candidate,api.overview(account)))
report={'candidateCount':len(selected),'excludedIds':[e['soopId'] for e in exclusions], 'checks':results}
(ROOT/'docs/deployment-data-smoke.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
