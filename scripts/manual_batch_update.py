#!/usr/bin/env python3
"""Offline partial-cohort update from a user-pasted viewer/balloon table."""
import copy
import hashlib
import json
from pathlib import Path
import re
import sys
from datetime import datetime,timezone

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from scripts.dynamic_collect import calculate_targets,KEYS
from scripts.viewer_adjustments import adjust,raw_previous
from scripts.trend_history import history_before_update

ALIASES={'[BJ]김인호':'pookygamja','미오탱':'juju0228','타요*':'b13246','가습기':'hwt1014',
         '“클로이”':'vf3366','사내.박재박':'jaeparkk','이주하♥':'nyouuu30810','고라니율_':'golaniyule0',
         'BJ.정윤종':'ioioiobb','마이곰이_':'mygomiee','[ω]아란♥':'dkfksl00','타요b':'b13246'}


def parse_table(text,source_sort='balloon_desc'):
    if source_sort not in ('balloon_desc','viewer_desc'):raise ValueError('Unsupported source sort')
    lines=[line.strip() for line in text.splitlines() if line.strip()]
    starts=[i for i,line in enumerate(lines) if re.fullmatch(r'\d+',line)]
    rows=[]
    for n,start in enumerate(starts):
        chunk=lines[start+1:starts[n+1] if n+1<len(starts) else len(lines)]
        balloons=[int(s[:-1].replace(',','')) for s in chunk if re.fullmatch(r'[\d,]+개',s)]
        hidden=chunk.count('비공개')
        viewers=[int(s[:-1].replace(',','')) for s in chunk if re.fullmatch(r'[\d,]+명',s)]
        if not chunk or len(balloons)+hidden!=1 or len(viewers)!=1:raise ValueError('Malformed table entry')
        rows.append({'sourceRank':int(lines[start]),'sourceRankByViewer' if source_sort=='viewer_desc' else 'sourceRankByBalloon':int(lines[start]),
                     'name':chunk[0],'viewer':viewers[0],'balloon':None if hidden else balloons[0]})
    if not rows or [r['sourceRank'] for r in rows]!=list(range(1,len(rows)+1)):raise ValueError('Noncontiguous source ranks')
    if len({r['name'] for r in rows})!=len(rows):raise ValueError('Duplicate source names')
    if any(type(r['viewer']) is not int or not 0<r['viewer']<=2**53-1 or
           (r['balloon'] is not None and (type(r['balloon']) is not int or not 0<=r['balloon']<=2**53-1)) for r in rows):raise ValueError('Invalid metrics')
    if source_sort=='viewer_desc' and any(a['viewer']<b['viewer'] for a,b in zip(rows,rows[1:])):raise ValueError('Source is not in descending viewer order')
    return rows


def match_table(rows,snapshot):
    names={}
    ids={r['soopId'] for r in snapshot['streamers']}
    for row in snapshot['streamers']:
        if row['name'] in names:raise ValueError('Ambiguous existing name')
        names[row['name']]=row['soopId']
    names.update({name:account for name,account in ALIASES.items() if account in ids})
    matched=[];outside=[]
    for row in rows:
        account=names.get(row['name'])
        (matched if account else outside).append({**row,**({'soopId':account} if account else {})})
    if len({r['soopId'] for r in matched})!=len(matched):raise ValueError('Two names mapped to one existing account')
    if not any(r['soopId']=='singgyul' for r in matched):raise ValueError('Singgyul source row required')
    return matched,outside


def previous_observation(snapshot,row):
    if snapshot.get('collectionMode')=='manual_partial':
        return snapshot['manualOverride']['observedAt'] if row['soopId']=='singgyul' else snapshot['competitorDataAsOf']
    return snapshot.get('actualObservedAt') or snapshot['updatedAt']


def prepare(snapshot,source_text,observed,policy,root=ROOT,source_sort='balloon_desc'):
    if snapshot.get('status')!='ok' or snapshot.get('simulationBaseline',{}).get('status')!='locked':raise ValueError('Locked healthy snapshot required')
    parsed=parse_table(source_text,source_sort);matched,outside=match_table(parsed,snapshot)
    source={r['soopId']:r for r in matched};working=copy.deepcopy(snapshot)
    baseline={r['soopId']:r for r in snapshot['simulationBaseline']['rows']};old={r['soopId']:r for r in snapshot['streamers']}
    corrections=[];changes=[]
    for row in working['streamers']:
        account=row['soopId']
        if account not in source:continue
        item=source[account];before=copy.deepcopy(row)
        if (row['status']=='unavailable')!=(item['balloon'] is None):raise ValueError('Hidden support status changed; keep nulls until reviewed')
        row['metricObservedAt']={k:row.get('metricObservedAt',{}).get(k,previous_observation(snapshot,row)) for k in KEYS}
        row['cumulativeUsers']=item['viewer'];row['metricObservedAt']['cumulativeUsers']=observed.isoformat()
        if source_sort=='viewer_desc':row['rankByViewer']=item['sourceRankByViewer']
        if item['balloon'] is not None:
            row['balloonCount']=item['balloon'];row['metricObservedAt']['balloonCount']=observed.isoformat()
        if account=='singgyul':
            adjusted=adjust(row,raw_previous(snapshot,before),policy,observed.date().isoformat())
            # Keep the pasted raw/adjusted split in the manual override audit. Row metrics are simulation inputs.
            row['cumulativeUsers']=adjusted['cumulativeUsers']
            working['manualOverride']={
                'streamerId':'singgyul','observedAt':observed.isoformat(),'appliedAt':datetime.now(timezone.utc).isoformat(),
                'automaticBase':copy.deepcopy(snapshot.get('manualOverride',{}).get('automaticBase') or {k:before[k] for k in KEYS}),
                'metrics':{'viewer':row['cumulativeUsers'],'donor':row['donorCount'],'balloon':row['balloonCount']},
                'source':'user_pasted_trackify_table','reason':'suspected_viewbot_traffic',
                'rawViewer':item['viewer'],'adjustedViewer':row['cumulativeUsers'],'adjustment':adjusted['viewerAdjustmentTotal'],
                'viewerAdjustments':adjusted['viewerAdjustments'],'rawMetrics':adjusted['rawMetrics'],
                'adjustedMetrics':adjusted['adjustedMetrics'],'sourceCorrectionReview':copy.deepcopy(policy.get('sourceCorrectionReview',{}))}
        row['metricSources']={**row.get('metricSources',{}),'cumulativeUsers':'user_pasted_trackify_table','donorCount':before.get('donorSource','previous_snapshot')}
        if item['balloon'] is not None:row['metricSources']['balloonCount']='user_pasted_trackify_table'
        row['actualSource']='mixed_manual'
        row['actualGain']={k:None if row[k] is None or baseline[account][k] is None else row[k]-baseline[account][k] for k in KEYS}
        for key in ('cumulativeUsers','balloonCount'):
            if before[key]!=row[key]:changes.append({'soopId':account,'metric':key,'previous':before[key],'current':row[key]})
            raw_previous_value=raw_previous(snapshot,before)[key]
            raw_current=item['viewer'] if key=='cumulativeUsers' else item['balloon']
            if raw_current is not None and raw_previous_value is not None and raw_current<raw_previous_value:
                corrections.append({'streamerId':account,'streamerName':row['name'],'metric':key,'previous':raw_previous_value,
                    'current':raw_current,'delta':raw_current-raw_previous_value,'reason':'source_correction',
                    'source':'user_pasted_trackify_table','observedAt':observed.isoformat()})
    working.update(collectionMode='manual_partial',actualDataScope='listed_candidates_viewer_balloon',
        source='사용자 제공 Trackify 표 일부 수동 반영 + 나머지 기존 관측값',
        viewerSource='user-pasted partial cohort; singgyul viewer adjusted separately',
        updatedAt=observed.isoformat(),lastDataChangeAt=observed.isoformat(),forecastAsOf=observed.date().isoformat(),
        sourceCorrections=corrections,verifiedGrowth=[])
    working['manualBatchOverride']={'observedAt':observed.isoformat(),'source':'user_pasted_trackify_table',
        'sourceSha256':hashlib.sha256(source_text.encode()).hexdigest(),'inputRows':len(parsed),
        'updatedCandidates':len(matched),'updatedCompetitors':len(matched)-1,'retainedCandidates':len(old)-len(matched),
        'fields':['cumulativeUsers','balloonCount'],'donorsUnchanged':True,'matchedRows':matched,
        'outsideCandidateCount':len(outside),'outsideCandidateRows':outside,'changes':changes,'sourceSort':source_sort,
        'updatedViewerCandidates':len(matched),'updatedBalloonCandidates':sum(r['balloon'] is not None for r in matched),
        'retainedCandidateNames':[r['name'] for r in snapshot['streamers'] if r['soopId'] not in source]}
    if source_sort=='viewer_desc':
        excluded={r['name'] for r in snapshot['exclusions']}
        target_source=next(r for r in matched if r['soopId']=='singgyul')
        target_final=next(r['cumulativeUsers'] for r in working['streamers'] if r['soopId']=='singgyul')
        working['manualBatchOverride']['viewerRankingAudit']={
            'sourceRawRank':target_source['sourceRankByViewer'],
            'configuredExclusions':len(excluded),'excludedRowsPresent':[r['name'] for r in parsed if r['name'] in excluded],
            'excludedRowsAboveTarget':[r['name'] for r in parsed if r['name'] in excluded and r['viewer']>target_source['viewer']],
            'rankAfterConfiguredExclusions':1+sum(r['viewer']>target_source['viewer'] and r['name'] not in excluded for r in parsed),
            'adjustedViewerRankWithinExistingCandidates':1+sum(r['cumulativeUsers']>target_final for r in working['streamers'])}
    october=working.get('octoberObservation')
    if october and observed.month==10:
        for row in october['rows']:
            if row['soopId'] not in source:continue
            updated=next(r for r in working['streamers'] if r['soopId']==row['soopId'])
            row.update(cumulativeUsers=updated['cumulativeUsers'],balloonCount=updated['balloonCount'],metricObservedAt=copy.deepcopy(updated['metricObservedAt']))
    report=calculate_targets(root,working,observed)
    expected_scored=len(working['streamers'])-report['dynamic']['pendingCount']-report['dynamic'].get('reservedCount',0)
    if len(report['dynamic']['projectedRows'])!=expected_scored or len(report['dynamic']['models'])!=3:raise ValueError('Complete existing cohort calculation required')
    for key in ('simulationBaseline','supportBaseline','rollingForecast','forecast','exclusions'):
        if working[key]!=snapshot[key]:raise ValueError('Protected input changed: '+key)
    if [r['soopId'] for r in working['streamers']]!=[r['soopId'] for r in snapshot['streamers']]:raise ValueError('Candidate cohort changed')
    for row in working['streamers']:
        if row['donorCount']!=old[row['soopId']]['donorCount']:raise ValueError('Donor changed')
        if row['soopId'] not in source and row!=old[row['soopId']]:raise ValueError('Unlisted candidate changed')
    working['targetResults']=report
    working['trendHistory']=history_before_update(snapshot,working)
    json.dumps(working,ensure_ascii=False,allow_nan=False)
    return working,report,{'matched':len(matched),'competitors':len(matched)-1,'retained':len(old)-len(matched),'outside':len(outside),
        'sourceCorrections':corrections,'changes':changes,'target':working['manualOverride'],
        'projected':report['dynamic']['target']['projected']['cumulativeUsers'],'projectedRank':report['dynamic']['predictedRank'],
        'models':{m['model']:m['remaining'] for m in report['dynamic']['models']},'safeTarget':report['dynamic']['safe']}
