import assert from 'node:assert/strict';
import fs from 'node:fs';
import {liveTargets,calendarHorizon,dampedDays} from '../assets/live-target.js';
import {fixedSupportScores} from '../assets/simulation.js';
const data=JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-ranking.json',import.meta.url)));
const at='2026-10-15T12:00:00+09:00';
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
const result=liveTargets(data,at);
test('KST horizon includes partial today, stays continuous at midnight, and ends exactly at deadline',()=>{
 assert.equal(calendarHorizon('2026-09-30T15:00:00Z').remainingDays,61);
 const before=calendarHorizon('2026-10-15T14:59:59Z').remainingDays;
 const after=calendarHorizon('2026-10-15T15:00:00Z').remainingDays;
 assert(Math.abs(before-after-1/86400)<1e-12);assert.equal(after,46);
 assert.equal(calendarHorizon('2026-11-30T23:59:59+09:00').remainingDays,1/86400);
 assert.equal(calendarHorizon('2026-11-30T23:59:59+09:00').ended,false);
 assert.equal(calendarHorizon('2026-12-01T00:00:00+09:00').ended,true);
});
test('donor decay includes fractional days and preserves the old whole-day rule',()=>{
 assert.equal(dampedDays(0),0);assert.equal(dampedDays(.5),.5/(1+1/60));
 const old=Array.from({length:18},(_,i)=>1/(1+(i+1)/60)).reduce((s,n)=>s+n,0);
 assert.equal(dampedDays(18),old);
 assert(Math.abs(dampedDays(18.5)-old-.5/(1+19/60))<1e-12);
 assert(Math.abs(dampedDays(18+1/86400)-old)<1/86400);
 assert.throws(()=>dampedDays(-1));assert.throws(()=>dampedDays(NaN));
});
test('annual actual is used without adding September twice',()=>assert.equal(result.currentUsers,data.streamers.find(r=>r.soopId==='singgyul').cumulativeUsers));
test('each model verifies exact integer threshold independently',()=>{
 assert.equal(result.models.length,3);
 for(const m of result.models){assert(m.boundary.at<=70);if(m.remaining>0)assert(m.boundary.before>70);assert.equal(m.requiredFinal,result.currentUsers+m.remaining);}
});
test('safe target is maximum; month allocation uses days and sums exactly',()=>{
 assert.equal(result.safe,Math.max(...result.models.map(m=>m.remaining)));
 assert.equal(result.october,Math.floor(result.safe*16.5/46.5));assert.equal(result.october+result.november,result.safe);assert.equal(result.daily,Math.ceil(result.safe/46.5));
});
test('target actual increase reduces remaining by exactly actual gain',()=>{
 const next=structuredClone(data);next.streamers.find(r=>r.soopId==='singgyul').cumulativeUsers+=10000;
 const updated=liveTargets(next,at);
 result.models.forEach((m,i)=>assert.equal(updated.models[i].remaining,Math.max(0,m.remaining-10000)));
});
test('all competitor actuals change thresholds',()=>{
 const next=structuredClone(data);next.streamers.filter(r=>r.soopId!=='singgyul').forEach(r=>r.cumulativeUsers+=1000000);
 const updated=liveTargets(next,at);result.models.forEach((m,i)=>assert(updated.models[i].remaining>m.remaining));
});
test('new donor and balloon data cannot affect fixed scores or targets',()=>{
 const next=structuredClone(data);next.streamers.forEach(r=>{r.donorCount=999999999;r.balloonCount=999999999;});
 assert.deepEqual(liveTargets(next,at),result);
 for(const model of ['rank','ratio','minmax'])assert.deepEqual(fixedSupportScores(next.simulationBaseline.rows,model),fixedSupportScores(data.simulationBaseline.rows,model));
});
test('already qualifying target has zero remaining, never negative',()=>{
 const next=structuredClone(data);next.streamers.find(r=>r.soopId==='singgyul').cumulativeUsers=1e12;
 const r=liveTargets(next,at);assert.equal(r.safe,0);r.models.forEach(m=>assert.equal(m.remaining,0));
});
test('only future days are forecast: zero pace makes date irrelevant to threshold',()=>{
 const next=structuredClone(data);next.forecast.rows.forEach(r=>r.recentMonthlyUsers=0);
 const a=liveTargets(next,at),b=liveTargets(next,'2026-11-30T12:00:00+09:00');
 assert.deepEqual(a.models.map(m=>m.remaining),b.models.map(m=>m.remaining));assert.equal(b.daily,Math.ceil(b.safe/.5));
});
test('end stops all target calculations even with a November snapshot',()=>{
 const r=liveTargets(data,'2026-12-01T00:00:00+09:00');assert.equal(r.safe,null);r.models.forEach(m=>{assert.equal(m.remaining,null);assert.equal(m.requiredFinal,null);});
});
test('missing candidate actual fails closed',()=>{
 const next=structuredClone(data);next.streamers=next.streamers.filter(r=>r.soopId!=='singgyul');assert.throws(()=>liveTargets(next,at),/누락/);
});
console.log(`${count} live target tests passed`);
