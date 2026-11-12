import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dynamicTargets,compareModes,projectCandidates,recentPace} from '../assets/dynamic-target.js';
import {calculateRanking} from '../assets/ranking.js';
const data=JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-ranking.json',import.meta.url)));
const now='2026-10-01T18:00:00+09:00';
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
const before=JSON.stringify(data.simulationBaseline),r=dynamicTargets(data,now);
test('September baseline immutable',()=>assert.equal(JSON.stringify(data.simulationBaseline),before));
test('annual actual values used directly, no monthly donor double addition',()=>{
 const actual=data.streamers.find(x=>x.soopId==='singgyul');assert.equal(r.target.actual.donorCount,actual.donorCount);
 assert.equal(r.target.gains.donorCount,actual.donorCount-r.target.baseline.donorCount);
 assert.equal(r.target.actual.balloonCount,actual.balloonCount);assert.equal(r.target.actual.cumulativeUsers,actual.cumulativeUsers);
});
test('initial fallback never treats all monthly uniques as new annual donors',()=>{
 const t=r.target,sep=data.supportBaseline.rows.find(x=>x.soopId==='singgyul');
 assert(t.donorPace.daily<=sep.donorCount/30);assert(t.donorPace.daily<=t.baseline.donorCount/273);
 assert(t.projected.donorCount<t.actual.donorCount+t.donorPace.daily*r.horizon.remainingDays);
});
test('future support for target and every competitor; no past-date forecast',()=>{
 const p=projectCandidates(data,now);assert.equal(p.rows.length,98);
 for(const x of p.rows){assert(x.projected.balloonCount>=x.actual.balloonCount);assert(x.projected.donorCount>=x.actual.donorCount);}
 const lastMinute=projectCandidates(data,'2026-11-30T23:59:00+09:00');
 assert.equal(lastMinute.horizon.remainingDays,1/1440);
 assert(lastMinute.rows.some(x=>x.projected.balloonCount>x.actual.balloonCount));
 const end=projectCandidates(data,'2026-12-01T00:00:00+09:00');for(const x of end.rows)for(const k of ['donorCount','balloonCount','cumulativeUsers'])assert.equal(x.projected[k],x.actual[k]);
});
test('all three models match full projected-dataset normalization',()=>{
 for(const m of r.models){const expected=calculateRanking(r.projectedRows,m.model).find(x=>x.soopId==='singgyul');assert.equal(m.predictedRank,expected.predictedRank);assert.deepEqual(m.supportScores.map(s=>s.score),expected.breakdown.slice(1).map(s=>s.score));}
});
test('support ranks, ratio max and minmax extrema change with actual support',()=>{
 const next=structuredClone(data);const target=next.streamers.find(x=>x.soopId==='singgyul');target.donorCount=1e9;target.balloonCount=1e10;
 const updated=dynamicTargets(next,now);
 for(let i=0;i<3;i++){assert.notDeepEqual(updated.models[i].supportScores.map(s=>s.score),r.models[i].supportScores.map(s=>s.score));assert(updated.models[i].remaining<r.models[i].remaining);}
});
test('competitor support changes threshold',()=>{
 const next=structuredClone(data);next.streamers.filter(x=>x.status!=='unavailable'&&x.soopId!=='singgyul').forEach(x=>{x.donorCount+=1e7;x.balloonCount+=1e8;});
 const a=dynamicTargets(next,now);assert.notEqual(a.safe,r.safe);
});
test('threshold exact boundary and maximum safe target',()=>{
 for(const m of r.models){assert(m.boundary.at<=70);assert(m.boundary.before>70);assert(m.remaining>=0);}
 assert.equal(r.safe,Math.max(...r.models.map(x=>x.remaining)));
});
test('actual viewer gain reduces target while support assumptions remain equal',()=>{
 const next=structuredClone(data);next.streamers.find(x=>x.soopId==='singgyul').cumulativeUsers+=10000;
 const a=dynamicTargets(next,now);r.models.forEach((m,i)=>assert.equal(a.models[i].remaining,m.remaining-10000));
});
test('fixed mode remains available for comparison',()=>{
 const c=compareModes(data,now);assert.equal(c.difference,c.dynamic.safe-c.fixed.safe);assert.notEqual(c.fixed.safe,c.dynamic.safe);
});
test('robust recent pace clips one-day donation spike and uses fallback before 7 days',()=>{
 const start=Date.parse('2026-10-01T20:00:00+09:00');let value=1000;
 const history=Array.from({length:10},(_,i)=>{value+=i===5?100000:100;return {observedAt:new Date(start+i*86400000).toISOString(),rows:[{soopId:'a',balloonCount:value}]};});
 const current={soopId:'a',balloonCount:value+100};const last=new Date(start+10*86400000).toISOString();
 const p=recentPace(history,current,'balloonCount',100,last);assert.match(p.source,/recent/);assert(p.daily<200);assert(p.rawDaily>9000);
 const f=recentPace(history.slice(-2),current,'balloonCount',100,last);assert.equal(f.daily,100);assert.equal(f.source,'september-fallback');
});
test('unverified donors fail closed',()=>{
 const next=structuredClone(data);next.streamers.find(x=>x.soopId==='singgyul').donorEstimated=true;assert.throws(()=>dynamicTargets(next,now),/연간/);
});
test('December ends threshold calculation and forecasts',()=>{
 const e=dynamicTargets(data,'2026-12-01T00:00:00+09:00');assert.equal(e.safe,null);assert.equal(e.target.actual.donorCount,e.target.projected.donorCount);assert.equal(e.target.actual.balloonCount,e.target.projected.balloonCount);
});
console.log(`${count} dynamic target tests passed`);
