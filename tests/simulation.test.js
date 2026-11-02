import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculateRanking} from '../assets/ranking.js';
import {createSimulation,rankForAdditional,remainingHorizon,allocateByMonth,fixedSupportScores} from '../assets/simulation.js';
const fixture=()=>{
 const streamers=Array.from({length:100},(_,i)=>({soopId:i===85?'singgyul':`person${i}`,name:`person${i}`,rankByViewer:i+1,cumulativeUsers:100000-i*700,donorCount:1000-i*5,balloonCount:9000-i*50,status:'ok'}));
 return {updatedAt:'2026-09-30T00:00:00+09:00',streamers,forecast:{status:'ok',rows:streamers.map((r,i)=>({soopId:r.soopId,recentMonthlyUsers:1000+i*10}))}};
};
for(const model of ['ratio','minmax','rank','percentile']){
 test(`${model}: exact minimum, all-candidate normalization, fixed support`,()=>{
  const input=fixture(),before=JSON.stringify(input),s=createSimulation(input,model);
  assert.equal(s.status,'ok');assert.ok(s.minimum>0);
  assert.ok(rankForAdditional(s,s.minimum).target.predictedRank<=70);
  assert.ok(rankForAdditional(s,s.minimum-1).target.predictedRank>70);
  assert.equal(s.forecastRows.length,100);
  assert.equal(s.forecastRows[0].donorCount,input.streamers[0].donorCount);
  assert.equal(s.forecastRows[0].balloonCount,input.streamers[0].balloonCount);
  assert.equal(s.competition.every(r=>r.predictedRank>=50&&r.predictedRank<=90),true);
  assert.equal(JSON.stringify(input),before);
  const comparable=rows=>rows.map(row=>({soopId:row.soopId,predictedRank:row.predictedRank,score:row.score,
    viewerRank:row.viewerRank,donorRank:row.donorRank,balloonRank:row.balloonRank}));
  assert.deepEqual(comparable(s.current),comparable(calculateRanking(input.streamers,model)));
  assert.equal(s.scenarios.length,5);
 });
 test(`${model}: narrower display competition window never changes minimum`,()=>{
  const a=createSimulation(fixture(),model),b=createSimulation(fixture(),model,{competitionFrom:65,competitionTo:75});
  assert.equal(a.minimum,b.minimum);assert.ok(b.competition.length<a.competition.length);
 });
}
test('calendar horizon: September two months, fractional October, no December',()=>{
 assert.equal(remainingHorizon('2026-09-30T23:59:59+09:00').remainingMonths,2);
 assert.equal(remainingHorizon('2026-10-01T00:00:00+09:00').remainingMonths,2);
 assert.equal(remainingHorizon('2026-10-16T12:00:00+09:00').remainingMonths,1.5);
 assert.equal(remainingHorizon('2026-11-01T00:00:00+09:00').remainingMonths,1);
 assert.equal(remainingHorizon('2026-12-01T00:00:00+09:00').remainingMonths,0);
 assert.throws(()=>remainingHorizon('not a date'));
});
test('integer month allocation sums exactly to the minimum',()=>{
 const months=remainingHorizon('2026-09-30T00:00:00+09:00').months;
 assert.deepEqual(allocateByMonth(5,months).map(m=>m.additionalUsers),[2,3]);
 const late=remainingHorizon('2026-11-15T00:00:00+09:00').months;
 assert.deepEqual(allocateByMonth(5,late).map(m=>m.additionalUsers),[0,5]);
});
test('missing monthly data is unavailable, never zero-filled',()=>{
 const data=fixture();data.forecast.rows.pop();assert.equal(createSimulation(data).status,'unavailable');
 delete data.forecast;assert.equal(createSimulation(data).status,'unavailable');
});
test('private support excluded and target-private fallback',()=>{
 const data=fixture();data.streamers[0].status='unavailable';data.streamers[0].donorCount=null;
 assert.equal(createSimulation(data).current.length,99);
 data.streamers.find(r=>r.soopId==='singgyul').status='unavailable';assert.equal(createSimulation(data).status,'unavailable');
});
test('zero pace never generates infinite growth percentages',()=>{
 const data=fixture();data.forecast.rows.find(r=>r.soopId==='singgyul').recentMonthlyUsers=0;
 const s=createSimulation(data);assert.equal(s.growthNeeded,null);assert.ok(s.minimum>0);
});
test('already qualified returns zero; ended period creates no forecast',()=>{
 const data=fixture();data.streamers.find(r=>r.soopId==='singgyul').cumulativeUsers=1e9;
 assert.equal(createSimulation(data).minimum,0);
 data.updatedAt='2026-12-01T00:00:00+09:00';assert.equal(createSimulation(data).status,'ended');
});
test('bounded search reports unreachable; invalid inputs rejected',()=>{
 const s=createSimulation(fixture(),'ratio',{maxAdditionalUsers:1});assert.equal(s.minimum,null);
 assert.throws(()=>rankForAdditional(s,-1));assert.throws(()=>rankForAdditional(s,NaN));
});
for(const model of ['rank','ratio','minmax']){
 test(`${model}: Sep 30 support is individual and immutable while only viewers change`,()=>{
  const input=fixture(),rows=input.streamers;
  const support=fixedSupportScores(rows,model);
  const first=support.get(rows[0].soopId),third=support.get(rows[2].soopId);
  assert.notEqual(rows[0].donorCount,rows[2].donorCount);
  assert.notEqual(rows[0].balloonCount,rows[2].balloonCount);
  assert.notEqual(first.donorCountScore,third.donorCountScore);
  assert.notEqual(first.balloonCountScore,third.balloonCountScore);
  const simulation=createSimulation(input,model);
  const before=rankForAdditional(simulation,0).target;
  const after=rankForAdditional(simulation,simulation.minimum).target;
  assert.equal(after.donorCount,before.donorCount);
  assert.equal(after.balloonCount,before.balloonCount);
  assert.equal(after.donorRank,before.donorRank);
  assert.equal(after.balloonRank,before.balloonRank);
  assert.equal(after.breakdown[1].score,before.breakdown[1].score);
  assert.equal(after.breakdown[2].score,before.breakdown[2].score);
  assert.ok(after.cumulativeUsers>before.cumulativeUsers);
  assert.ok(after.score>=before.score);
  assert.ok(after.predictedRank<=70);
  assert.ok(rankForAdditional(simulation,simulation.minimum-1).target.predictedRank>=71);
  assert.equal(simulation.forecastRows.every((row,index)=>row.donorCount===rows[index].donorCount&&row.balloonCount===rows[index].balloonCount),true);
 });
}
test('locked simulation baseline is used instead of later annual values',()=>{
 const input=fixture(),baseline=structuredClone(input.streamers);
 input.simulationBaseline={status:'locked',asOf:'2026-09-30',cutoffAt:'2026-10-01T00:00:00+09:00',rows:baseline};
 input.streamers.forEach(row=>{row.cumulativeUsers+=999999;row.donorCount+=999;row.balloonCount+=999;});
 const simulation=createSimulation(input,'ratio');
 const target=baseline.find(row=>row.soopId==='singgyul');
 assert.equal(simulation.target.cumulativeUsers,target.cumulativeUsers);
 assert.equal(simulation.target.donorCount,target.donorCount);
 assert.equal(simulation.target.balloonCount,target.balloonCount);
 assert.equal(simulation.horizon.remainingMonths,2);
});
test('ranking source remains byte-identical to deployed scoring model',async()=>{
 const {createHash}=await import('node:crypto');
 const sha=createHash('sha256').update(readFileSync(new URL('../assets/ranking.js',import.meta.url))).digest('hex');
 assert.equal(sha,'8539dec19c2c206bf3160271afc4c5ab1ac35e6b1e7fda63baa05303324fb95e');
});
