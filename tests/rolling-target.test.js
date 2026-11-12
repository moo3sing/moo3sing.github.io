import assert from 'node:assert/strict';
import fs from 'node:fs';
import {blendPace,rollingMetric,rollingTargets,projectRollingCandidates} from '../assets/rolling-target.js';
import {calculateRanking} from '../assets/ranking.js';
const data=JSON.parse(fs.readFileSync(new URL('./fixtures/legacy-ranking.json',import.meta.url)));
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
const at=day=>`2026-${day}T12:00:00+09:00`;
function sample(day){const s=structuredClone(data);s.actualObservedAt=at(day);return s;}
const now=at('10-02'),baseline=JSON.stringify(data.simulationBaseline),r=rollingTargets(sample('10-02'),now);
test('October 1/2 actual weights stay low and use elapsed observation time',()=>{assert.equal(blendPace(100,1000,1).actualWeight,1/8);assert.equal(blendPace(100,1000,2).actualWeight,2/9);assert.equal(r.target.forecast.metrics.cumulativeUsers.actualWeight,1.5/8.5);});
test('October 15 weight rises',()=>assert.equal(rollingTargets(sample('10-15'),at('10-15')).target.forecast.metrics.cumulativeUsers.actualWeight,14.5/21.5));
test('October 31 weight includes its remaining half day and all of November',()=>{const x=rollingTargets(sample('10-31'),at('10-31'));assert.equal(x.target.forecast.metrics.cumulativeUsers.actualWeight,30.5/37.5);assert.equal(x.horizon.remainingDays,30.5);});
const base={daily:100,months:['2026-09'],weights:[1],fallbackReason:null},oct={observedAt:at('10-31'),rows:[{soopId:'a',cumulativeUsers:4100}]};
test('rolling pace divides by the actual anchor interval, with no midnight discontinuity',()=>{
 const anchor={observedAt:'2026-10-31T18:00:00+09:00',rows:[{soopId:'a',cumulativeUsers:4100}]};
 const p=rollingMetric(base,5100,1000,oct,anchor,'cumulativeUsers','2026-11-01T06:00:00+09:00','a');
 assert.equal(p.elapsedActualDays,.5);assert.equal(p.actualDailyPace,2000);
 const a=rollingMetric(base,7100,1000,oct,anchor,'cumulativeUsers','2026-11-12T23:59:59+09:00','a');
 const b=rollingMetric(base,7100,1000,oct,anchor,'cumulativeUsers','2026-11-13T00:00:00+09:00','a');
 assert(Math.abs(a.forecastDailyPace-b.forecastDailyPace)<.001);
});
test('November without anchor uses observed October trend, never invents actual gain',()=>{const x=rollingMetric(base,5000,1000,oct,null,'cumulativeUsers','2026-11-15','a');assert(Math.abs(x.forecastDailyPace-3800/37.5)<1e-10);assert.equal(x.actualWeight,0);assert.match(x.fallbackReason,/unavailable/);});
test('November verified actual blends against October trend',()=>{const x=rollingMetric(base,7100,1000,oct,{...oct,status:'last_observation_not_exact_midnight'},'cumulativeUsers','2026-11-15','a');assert.equal(x.actualGain,3000);assert.equal(x.actualWeight,14.5/21.5);assert(Math.abs(x.forecastDailyPace-((3800/37.5)*7+3000)/21.5)<1e-10);});
test('confirmed correction changes actual and all forecast models without changing baseline',()=>{const s=sample('10-02'),t=s.streamers.find(x=>x.soopId==='sccha21');t.balloonCount=2318049;const before=rollingTargets(s,now);t.balloonCount=2290254;const after=rollingTargets(s,now);assert.equal(after.projectedRows.find(x=>x.soopId==='sccha21').balloonCount,projectRollingCandidates(s,now).rows.find(x=>x.actual.soopId==='sccha21').projected.balloonCount);assert.notEqual(before.projectedRows.find(x=>x.soopId==='sccha21').balloonCount,after.projectedRows.find(x=>x.soopId==='sccha21').balloonCount);assert.equal(JSON.stringify(s.simulationBaseline),baseline);assert.equal(after.projectedRows.length,98);});
test('annual unique donors actual stays direct; monthly uniques not summed',()=>{assert.equal(r.target.actual.donorCount,data.streamers.find(x=>x.soopId==='singgyul').donorCount);const s=sample('10-02');s.supportBaseline.rows.forEach(x=>x.donorCount*=100);assert.equal(rollingTargets(s,now).target.projected.donorCount,r.target.projected.donorCount);assert.equal(r.target.projected.donorEstimated,true);});
test('November 30 includes its remaining half day for all three metrics',()=>{const x=projectRollingCandidates(sample('11-30'),at('11-30'));assert.equal(x.horizon.remainingDays,.5);assert(x.rows.some(row=>row.projected.cumulativeUsers>row.actual.cumulativeUsers));for(const row of x.rows)for(const k of ['cumulativeUsers','donorCount','balloonCount'])assert(row.projected[k]>=row.actual[k]);});
test('December 1 ends forecast and target solver',()=>{const x=rollingTargets(sample('12-01'),at('12-01'));assert.equal(x.safe,null);assert.equal(x.target.projected.valueKind,'final_observation');assert.equal(x.target.projected.donorEstimated,false);});
test('every candidate normalized from projected values and exact solver boundary retained',()=>{for(const m of r.models){const expected=calculateRanking(r.projectedRows,m.model).find(x=>x.soopId==='singgyul');assert.equal(m.predictedRank,expected.predictedRank);assert.deepEqual(m.supportScores.map(x=>x.score),expected.breakdown.slice(1).map(x=>x.score));assert(m.boundary.at<=70);assert(m.boundary.before>70);}assert.equal(r.safe,Math.max(...r.models.map(x=>x.remaining)));});
test('competitor changes force full normalization and targets',()=>{const s=sample('10-02');s.streamers.filter(x=>x.status!=='unavailable'&&x.soopId!=='singgyul').forEach(x=>{x.cumulativeUsers+=1e7;x.donorCount+=1e5;x.balloonCount+=1e8;});const x=rollingTargets(s,now);assert.notEqual(x.safe,r.safe);for(let i=0;i<3;i++)assert.notDeepEqual(x.models[i].supportScores,r.models[i].supportScores);});
test('no past-day forecast or stale observation aging',()=>{assert.equal(r.horizon.remainingDays,59.5);const x=rollingTargets(sample('10-02'),at('10-15'));assert.equal(x.target.forecast.metrics.cumulativeUsers.elapsedActualDays,1.5);assert.equal(x.horizon.remainingDays,46.5);});
test('negative correction gain retained but future pace cannot be negative',()=>{const x=blendPace(100,-1000,2);assert.equal(x.actualGain,-1000);assert.equal(x.actualDailyPace,0);assert(x.forecastDailyPace>=0);assert(x.negativeGainClamped);assert.equal(JSON.stringify(data.simulationBaseline),baseline);});
test('manual partial uses separate target and competitor observation dates',()=>{const s=sample('10-02');s.collectionMode='manual_partial';s.competitorDataAsOf=at('10-02');s.manualOverride={streamerId:'singgyul',observedAt:at('10-05')};s.streamers.find(x=>x.soopId==='singgyul').cumulativeUsers+=10000;const x=projectRollingCandidates(s,at('10-05'));assert.equal(x.rows.find(r=>r.actual.soopId==='singgyul').forecast.observedDate,'2026-10-05');assert.equal(x.rows.find(r=>r.actual.soopId==='sccha21').forecast.observedDate,'2026-10-02');});
test('partial batch uses separate metric observation dates without aging unchanged donors',()=>{
 const s=sample('10-04');s.collectionMode='manual_partial';s.competitorDataAsOf=at('10-04');s.manualOverride={observedAt:at('10-18')};
 const target=s.streamers.find(x=>x.soopId==='singgyul'),competitor=s.streamers.find(x=>x.soopId==='sccha21');
 target.metricObservedAt={cumulativeUsers:at('10-18'),donorCount:at('10-17'),balloonCount:at('10-18')};
 competitor.metricObservedAt={cumulativeUsers:at('10-18'),donorCount:at('10-04'),balloonCount:at('10-18')};
 const x=projectRollingCandidates(s,at('10-18'));
 const t=x.rows.find(r=>r.actual.soopId==='singgyul'),c=x.rows.find(r=>r.actual.soopId==='sccha21');
 assert.equal(t.forecast.metrics.donorCount.elapsedActualDays,16.5);assert.equal(t.forecast.metrics.cumulativeUsers.elapsedActualDays,17.5);
 assert.equal(c.forecast.metrics.donorCount.elapsedActualDays,3.5);assert.equal(c.forecast.metrics.cumulativeUsers.elapsedActualDays,17.5);
 assert.equal(x.rows.find(r=>r.actual.soopId==='khm11903').forecast.observedDate,'2026-10-04');
 s.manualOverride.observedAt=at('10-19');
 assert.equal(projectRollingCandidates(s,at('10-19')).rows.find(r=>r.actual.soopId==='singgyul').forecast.metrics.donorCount.elapsedActualDays,18.5);
});
console.log(`${count} rolling target tests passed`);
