import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {top70Reservations,rankBounds,reservationBoundary as getBoundary,fixedSupportCandidates} from '../assets/ranking-exceptions.js';
import {rankingView} from '../assets/ranking-view.js';
import {rollingTargets} from '../assets/rolling-target.js';

const data=JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-ranking.json',import.meta.url)));
const now='2026-10-19T09:46:56+09:00';
const policy={reservedTop70:[{soopId:'danchu17',basis:'user_assumption'}]};

test('one reserved slot yields honest ranges inside TOP70 and exact shifted ranks outside',()=>{
 assert.deepEqual(rankBounds(1,1),{min:1,max:2});
 assert.deepEqual(rankBounds(69,1),{min:69,max:70});
 assert.deepEqual(rankBounds(70,1),{min:71,max:71});
 assert.deepEqual(rankBounds(76,1),{min:77,max:77});
 assert.deepEqual(rankBounds(70,0),{min:70,max:70});
});

test('reserved private candidate remains null and separate from both scores and pending rows',()=>{
 const s=structuredClone(data);s.rankingExceptions=policy;
 const before=JSON.stringify(s);
 for(const basis of ['actual','forecast']){
  const view=rankingView(s,'rank',basis,now);
  assert.equal(view.ranked.length,98);assert.equal(view.reserved.length,1);assert.equal(view.pending.length,1);
  assert.equal(view.reserved[0].soopId,'danchu17');assert.equal(view.reserved[0].donorCount,null);assert.equal(view.reserved[0].balloonCount,null);
  assert.equal(view.pending[0].soopId,'honeys2');assert.equal(view.scoreCutoffRank,69);
  assert.equal(view.ranked.filter(r=>r.predictedRank<=70).length+view.reserved.length,70);
  const boundary=getBoundary(view.ranked,view.scoreCutoffRank);
  assert.equal(boundary.cutoff.predictedRank,70);assert.equal(boundary.next.predictedRank,71);
 }
 assert.equal(JSON.stringify(s),before);
});

test('main solver, current ranking and projected ranking use the same reservation exactly once',()=>{
 const s=structuredClone(data);s.rankingExceptions=policy;
 const original=JSON.stringify(s),expected=rollingTargets(data,now,{cutoffRank:69}),actual=rollingTargets(s,now);
 assert.equal(actual.reservedCount,1);assert.equal(actual.pendingCount,1);
 assert.equal(actual.safe,expected.safe);assert.deepEqual(actual.projectedRows,expected.projectedRows);
 for(const m of actual.models){
  const base=expected.models.find(row=>row.model===m.model);
  assert.equal(m.remaining,base.remaining);
  assert.equal(m.predictedRank,base.predictedRank+1);assert.equal(m.currentRank,base.currentRank+1);
  assert.equal(m.boundary.at,70);assert.equal(m.boundary.before,71);
  for(const basis of ['actual','forecast']){
   const target=rankingView(s,m.model,basis,now).ranked.find(row=>row.soopId==='singgyul');
   assert.equal(target.predictedRank,basis==='actual'?m.currentRank:m.predictedRank);
   assert.deepEqual(target.rankRange,basis==='actual'?m.currentRankRange:m.predictedRankRange);
  }
 }
 assert.equal(JSON.stringify(s),original);
});

test('exceptions cannot silently introduce duplicate or nonexistent candidates',()=>{
 const s=structuredClone(data);
 for(const reservedTop70 of [[...policy.reservedTop70,...policy.reservedTop70],[{soopId:'missing',basis:'user_assumption'}],[{soopId:'danchu17',basis:'guessed'}]]){
  s.rankingExceptions={reservedTop70};assert.throws(()=>top70Reservations(s));
 }
 s.rankingExceptions=policy;
 const row=s.streamers.find(r=>r.soopId==='danchu17');row.status='ok';row.donorCount=123;row.balloonCount=456;
 assert.deepEqual(top70Reservations(s),[],'public candidate must not also consume a reserved slot');
});

const monthly=[245538,192259,213278,187618,98793,381242,114725,1128473,400737,127202];
const fixed={soopId:'danchu17',basis:'user_assumption',donorCount:6405,balloonCount:3089865,monthlyBalloonCounts:monthly};

test('fixed support is a calculation overlay and never changes private observations or baseline',()=>{
 const s=structuredClone(data);s.rankingExceptions={fixedSupport:[fixed],reservedTop70:policy.reservedTop70};
 const original=JSON.stringify(s),r=rollingTargets(s,now);
 assert.equal(r.projectedRows.length,99);assert.equal(r.fixedSupportCount,1);assert.equal(r.reservedCount,0);assert.equal(r.pendingCount,1);
 const raw=s.streamers.find(row=>row.soopId==='danchu17');assert.equal(raw.donorCount,null);assert.equal(raw.balloonCount,null);
 const dan=r.projectedRows.find(row=>row.soopId==='danchu17');
 assert.equal(dan.donorCount,6405);assert.equal(dan.balloonCount,3089865);assert.ok(dan.cumulativeUsers>raw.cumulativeUsers);
 assert.equal(dan.supportFixed,true);assert.equal(dan.donorEstimated,true);
 for(const model of ['rank','ratio','minmax']){
  for(const basis of ['actual','forecast']){
   const view=rankingView(s,model,basis,now),row=view.ranked.find(x=>x.soopId==='danchu17');
   assert.equal(view.ranked.length,99);assert.equal(view.reserved.length,0);assert.equal(view.pending.length,1);
   assert.equal(row.donorCount,6405);assert.equal(row.balloonCount,3089865);assert.ok(row.predictedRank<=70);
   const target=view.ranked.find(x=>x.soopId==='singgyul'),m=r.models.find(x=>x.model===model);
   assert.equal(target.predictedRank,basis==='actual'?m.currentRank:m.predictedRank);
  }
 }
 assert.equal(JSON.stringify(s),original);
});

test('support stays fixed across future horizons and fresh user totals still change the forecast',()=>{
 const s=structuredClone(data);s.rankingExceptions={fixedSupport:[fixed]};
 for(const days of [42,10,0]){
  const [row]=fixedSupportCandidates(s,{remainingDays:days,ended:days===0},now);
  assert.equal(row.projected.donorCount,6405);assert.equal(row.projected.balloonCount,3089865);
  if(!days)assert.equal(row.projected.cumulativeUsers,row.actual.cumulativeUsers);
 }
 const before=rankingView(s,'rank','actual',now).ranked.find(row=>row.soopId==='danchu17');
 s.streamers.find(row=>row.soopId==='danchu17').cumulativeUsers+=1000000;
 const after=rankingView(s,'rank','actual',now).ranked.find(row=>row.soopId==='danchu17');
 assert.equal(after.cumulativeUsers,before.cumulativeUsers+1000000);assert.ok(after.predictedRank<=before.predictedRank);
 s.rankingExceptions.fixedSupport[0]={...fixed,balloonCount:3089864};
 assert.throws(()=>fixedSupportCandidates(s,{remainingDays:42},now));
});
