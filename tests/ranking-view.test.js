import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {rankingView,metricObservation,latestObservation} from '../assets/ranking-view.js';
import {calculateRanking} from '../assets/ranking.js';
import {rollingTargets} from '../assets/rolling-target.js';

const data=JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-ranking.json',import.meta.url)));
const now='2026-10-18T14:00:00+09:00';

test('all four full ranking models use the main simulation projected values',()=>{
  const before=JSON.stringify(data),main=rollingTargets(data,now);
  for(const model of ['rank','percentile','ratio','minmax']){
    const view=rankingView(data,model,'forecast',now);
    assert.deepEqual(view.ranked,calculateRanking(main.projectedRows,model));
    assert.equal(view.pending.length,2);
    assert.equal(view.forecast,true);
    if(model!=='percentile')assert.equal(view.ranked.find(r=>r.soopId==='singgyul').predictedRank,main.models.find(m=>m.model===model).predictedRank);
  }
  assert.equal(JSON.stringify(data),before);
});

test('current basis uses observed values and keeps private statistics pending',()=>{
  const view=rankingView(data,'rank','actual',now);
  assert.deepEqual(view.ranked,calculateRanking(data.streamers.filter(r=>r.status!=='unavailable')));
  assert.equal(view.forecast,false);
  assert.equal(view.ranked.length+view.pending.length,100);
  assert.ok(view.pending.every(r=>r.donorCount===null));
});

test('manual updates keep separate metric dates and do not age old donor observations',()=>{
  const s=structuredClone(data),row=s.streamers.find(r=>r.soopId==='singgyul');
  s.collectionMode='manual_partial';s.competitorDataAsOf='2026-10-04T09:00:00+09:00';
  s.manualOverride={streamerId:'singgyul',observedAt:now};
  row.metricObservedAt={cumulativeUsers:now,balloonCount:now,donorCount:'2026-10-17T09:00:00+09:00'};
  const donor=row.donorCount;
  const result=rankingView(s,'rank','forecast',now).ranked.find(r=>r.soopId==='singgyul');
  assert.equal(result.forecast.metrics.cumulativeUsers.elapsedActualDays,17+14/24);
  assert.equal(result.forecast.metrics.donorCount.elapsedActualDays,16+9/24);
  assert.equal(metricObservation(s,row,'donorCount'),row.metricObservedAt.donorCount);
  assert.equal(row.donorCount,donor);
  const other=s.streamers.find(r=>r.soopId==='khm11903');
  assert.equal(metricObservation(s,other,'donorCount'),s.competitorDataAsOf);
});

test('latest manual date supersedes the old automatic asOf without rewriting it',()=>{
  const s=structuredClone(data),old=s.asOf;
  s.manualBatchOverride={observedAt:now};
  assert.equal(latestObservation(s),now);
  assert.equal(s.asOf,old);
});

test('a fresh manual viewer value changes the ranking while preserving donor actuals',()=>{
  const s=structuredClone(data),row=s.streamers.find(r=>r.soopId==='singgyul');
  const old=rankingView(s,'rank','forecast',now).ranked.find(r=>r.soopId==='singgyul');
  const donor=row.donorCount;
  row.cumulativeUsers+=1000000;
  const current=rankingView(s,'rank','forecast',now).ranked.find(r=>r.soopId==='singgyul');
  assert.ok(current.cumulativeUsers>old.cumulativeUsers);
  assert.ok(current.predictedRank<old.predictedRank);
  assert.equal(row.donorCount,donor);
});

test('after the evaluation period the forecast uses the final observation',()=>{
  const view=rankingView(data,'rank','forecast','2026-12-01T00:00:00+09:00');
  assert.equal(view.forecast,false);
  assert.equal(view.horizon.ended,true);
  assert.deepEqual(view.ranked.map(r=>r.cumulativeUsers),rankingView(data,'rank','actual',now).ranked.map(r=>r.cumulativeUsers));
});
