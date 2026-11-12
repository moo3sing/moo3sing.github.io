import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {goalScenarios,conservativeModelGoals} from '../assets/goal-scenarios.js';
import {rollingTargets,projectRollingCandidates} from '../assets/rolling-target.js';
import {viewerOnlyReference} from '../assets/viewer-reference.js';
import {calculateRanking} from '../assets/ranking.js';

const snapshot=JSON.parse(readFileSync(new URL('../assets/data/ranking.json',import.meta.url),'utf8'));
const now=new Date(snapshot.updatedAt),before=JSON.stringify(snapshot),result=goalScenarios(snapshot,now);
const old={...snapshot,recentTrend:undefined};

test('midnight recheck of unchanged actuals has no whole-day goal or rolling-pace jump',()=>{
 const recheck=at=>{
  const s=structuredClone(snapshot),previous=s.updatedAt;
  s.updatedAt=at;s.manualOverride.observedAt=at;s.recentTrend.asOf=at;
  for(const row of s.streamers)for(const key of ['cumulativeUsers','balloonCount']){
   if(row.metricObservedAt?.[key]===previous)row.metricObservedAt[key]=at;
  }
  return goalScenarios(s,new Date(at));
 };
 const a=recheck('2026-11-12T23:59:59+09:00'),b=recheck('2026-11-13T00:00:00+09:00');
 for(const key of ['recent','original','conservative']){
  assert(Math.abs(a[key].safe-b[key].safe)<=10,`${key} changed by ${a[key].safe-b[key].safe}`);
  assert(Math.abs(a[key].horizon.remainingDays-b[key].horizon.remainingDays-1/86400)<1e-12);
  const p=a[key].target.forecast.metrics.cumulativeUsers.forecastDailyPace;
  const q=b[key].target.forecast.metrics.cumulativeUsers.forecastDailyPace;
  assert(Math.abs(p-q)<1,`${key} pace jumps at midnight`);
 }
});

test('left uses current seven-day model and center restores the original rolling calculation',()=>{
 assert.deepEqual(result.recent,rollingTargets(snapshot,now));
 assert.deepEqual(result.original,rollingTargets(old,now));
 assert.equal(result.original.safe,Math.max(...result.original.models.map(row=>row.remaining)));
 assert.equal(result.recent.safe,Math.max(...result.recent.models.map(row=>row.remaining)));
});

test('conservative projection takes target lower and each rival higher for all three metrics',()=>{
 const recent=projectRollingCandidates(snapshot,now),original=projectRollingCandidates(old,now);
 for(const row of result.conservative.projectedRows){
  const a=recent.rows.find(item=>item.actual.soopId===row.soopId).projected;
  const b=original.rows.find(item=>item.actual.soopId===row.soopId).projected;
  for(const key of ['cumulativeUsers','donorCount','balloonCount']){
   assert.equal(row[key],row.soopId==='singgyul'?Math.min(a[key],b[key]):Math.max(a[key],b[key]));
  }
 }
 assert(result.conservative.safe>=result.recent.safe);
 assert(result.conservative.safe>=result.original.safe);
 assert(result.conservative.safe>=result.conservative.scenarioSafe);
});

test('all scenarios keep weights, cohort, current support, private assumptions and original data intact',()=>{
 const ids=result.recent.projectedRows.map(row=>row.soopId);
 assert.deepEqual(result.original.projectedRows.map(row=>row.soopId),ids);
 assert.deepEqual(result.conservative.projectedRows.map(row=>row.soopId),ids);
 assert.deepEqual(result.conservative.target.actual,result.recent.target.actual);
 assert.deepEqual(result.conservative.fixedSupport,result.recent.fixedSupport);
 assert.equal(JSON.stringify(snapshot),before);
 const ranked=calculateRanking(result.conservative.projectedRows,'minmax');
 assert.deepEqual(ranked[0].breakdown.map(metric=>metric.weight),[.8,.1,.1]);
});

test('viewer 100% reference stays on the unchanged seven-day projection',()=>{
 assert.deepEqual(viewerOnlyReference(snapshot,result.recent),viewerOnlyReference(snapshot,rollingTargets(snapshot,now)));
});

test('period end stops all three goals and leaves the final observations unchanged',()=>{
 const ended=goalScenarios(snapshot,'2026-12-01T00:00:00+09:00');
 for(const name of ['recent','original','conservative']){
  assert.equal(ended[name].safe,null);assert.equal(ended[name].daily,null);
  for(const row of ended[name].projectedRows){
   const actual=snapshot.streamers.find(item=>item.soopId===row.soopId);
   assert.equal(row.cumulativeUsers,actual.cumulativeUsers);
  }
 }
});

test('an unreachable conservative goal cannot be displayed as a smaller reassuring target',()=>{
 const bounded=goalScenarios(snapshot,now,{maxAdditionalUsers:1});
 assert.equal(bounded.conservative.safe,null);
 assert.equal(bounded.conservative.daily,null);
});

test('conservative model cards take the maximum goal and worst rank separately without mutating scenarios',()=>{
 const before=JSON.stringify(result),cards=conservativeModelGoals(result);
 assert.deepEqual(cards.map(row=>row.model),['rank','ratio','minmax','log']);
 for(const card of cards){
  const rows=['recent','original','conservative'].map(key=>[...result[key].models,...result[key].experimentalModels].find(row=>row.model===card.model));
  assert.equal(card.remaining,Math.max(...rows.map(row=>row.remaining)));
  assert.equal(card.predictedRank,Math.max(...rows.map(row=>row.predictedRank)));
  const rankRow=[...result[card.rankScenario].models,...result[card.rankScenario].experimentalModels].find(row=>row.model===card.model);
  assert.deepEqual(card.predictedRankRange,rankRow.predictedRankRange);
 }
 assert.equal(Math.max(...cards.filter(row=>!row.experimental).map(row=>row.remaining)),result.conservative.safe);
 assert.equal(cards.filter(row=>row.experimental).length,1);
 assert.equal(JSON.stringify(result),before);
});

test('model comparison never converts an unavailable goal or ended period into a smaller valid goal',()=>{
 const bounded=goalScenarios(snapshot,now,{maxAdditionalUsers:1});
 for(const card of conservativeModelGoals(bounded)){
  const rows=['recent','original','conservative'].map(key=>[...bounded[key].models,...bounded[key].experimentalModels].find(row=>row.model===card.model));
  if(rows.some(row=>row.remaining===null)){assert.equal(card.remaining,null);assert.equal(card.daily,null);}
 }
 for(const card of conservativeModelGoals(goalScenarios(snapshot,'2026-12-01T00:00:00+09:00'))){
  assert.equal(card.remaining,null);assert.equal(card.daily,null);
 }
});
