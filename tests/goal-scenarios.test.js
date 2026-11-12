import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {goalScenarios} from '../assets/goal-scenarios.js';
import {rollingTargets,projectRollingCandidates} from '../assets/rolling-target.js';
import {viewerOnlyReference} from '../assets/viewer-reference.js';
import {calculateRanking} from '../assets/ranking.js';

const snapshot=JSON.parse(readFileSync(new URL('../assets/data/ranking.json',import.meta.url),'utf8'));
const now=new Date(snapshot.updatedAt),before=JSON.stringify(snapshot),result=goalScenarios(snapshot,now);
const old={...snapshot,recentTrend:undefined};

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
