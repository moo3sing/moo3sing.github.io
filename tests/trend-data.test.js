import assert from 'node:assert/strict';
import {median,intervalRate,observations,trendView,currentObservation} from '../assets/trend-data.js';
import {readFileSync} from 'node:fs';
import {calculateRanking} from '../assets/ranking.js';
import {includeReservations} from '../assets/ranking-exceptions.js';

const rows=Array.from({length:99},(_,i)=>({soopId:i===70?'singgyul':`r${i}`,name:`후보 ${i}`,cumulativeUsers:(100-i)*10000,donorCount:100-i,balloonCount:(100-i)*1000}));
function point(day,gain,precision='minute'){
 return {observedAt:`2026-10-${day}T12:00:00+09:00`,comparisonKey:'same',viewerAdjustment:-70000,precision,
  rows:rows.map((row,i)=>({...row,cumulativeUsers:row.cumulativeUsers+gain*(i===70?2:1)})),projectedRows:rows,
  models:{rank:{currentRank:77,predictedRank:62+gain/1000},ratio:{currentRank:73,predictedRank:68+gain/1000},minmax:{currentRank:73,predictedRank:68+gain/1000}}};
}
const first=point('19',0),unknown=point('20',1000,'day'),next=point('22',3000),last=point('26',11000);
const snapshot={trendHistory:{comparisonKey:'same',points:[last,next,first,unknown,next]}};
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
test('deduplicates true observations, sorts timestamps, never fills missing dates',()=>assert.deepEqual(observations(snapshot).map(p=>p.observedAt),[first,unknown,next,last].map(p=>p.observedAt)));
test('normalizes irregular intervals by exact elapsed time',()=>{assert.equal(intervalRate(next,last,['singgyul']).daily,4000);assert.equal(intervalRate(next,last,['r0']).daily,2000);});
test('unknown source times and changed adjustments cannot become daily pace',()=>{
 assert.equal(intervalRate(first,unknown,['singgyul']),null);
 assert.equal(intervalRate(unknown,next,['singgyul']),null);
 assert.equal(intervalRate(next,{...last,viewerAdjustment:-80000},['singgyul']),null);
});
test('negative source corrections are not reported as measured growth',()=>{
 const decreased=structuredClone(last);decreased.rows.find(r=>r.soopId==='singgyul').cumulativeUsers=0;
 assert.equal(intervalRate(next,decreased,['singgyul']),null);
});
test('compares a fixed final boundary cohort, using median of individual gains',()=>{
 const view=trendView(snapshot,'minmax');assert.equal(view.rivals.length,10);
 assert.ok(view.rivals.every(r=>r.soopId!=='singgyul'&&r.rank>=65&&r.rank<=75));
 assert.deepEqual(view.series.map(p=>p.rivalGain),[0,1000,3000,11000]);
 assert.equal(view.series[0].targetGain,0);assert.equal(view.series.at(-1).targetGain,22000);
 assert.equal(view.series[0].targetUsers,300000);assert.equal(view.series.at(-1).targetUsers,322000);
 assert.deepEqual(view.series.map(p=>p.rivalUsers),[315000,316000,318000,326000]);
 assert.equal(view.recent.length,1);assert.equal(view.recent[0].targetDaily,4000);
});
test('historical rank lines use one explicit model rather than past representative switches',()=>{
 assert.deepEqual(trendView(snapshot,'rank').series.map(p=>p.forecastRank),[62,63,65,73]);
 assert.deepEqual(trendView(snapshot,'minmax').series.map(p=>p.forecastRank),[68,69,71,79]);
});
test('individual comparison is restricted to the final boundary cohort',()=>{
 assert.equal(trendView(snapshot,'minmax','r65').selectedRival.soopId,'r65');
 assert.equal(trendView(snapshot,'minmax','r65').series[0].rivalUsers,350000);
 assert.equal(trendView(snapshot,'minmax','r65').series.at(-1).rivalUsers,361000);
 assert.equal(trendView(snapshot,'minmax','r0'),null);
});
test('new adjustment begins a comparison segment, preserving old source points',()=>{
 const changed={...last,observedAt:'2026-10-28T12:00:00+09:00',viewerAdjustment:-80000};
 const s={trendHistory:{...snapshot.trendHistory,points:[first,next,last,changed]}};
 assert.equal(observations(s).length,1);assert.equal(s.trendHistory.points.length,4);assert.equal(trendView(s),null);
});
test('median does not mutate inputs',()=>{const a=[10,1,5,3];assert.equal(median(a),4);assert.deepEqual(a,[10,1,5,3]);});

test('retained observations are not measured zero growth, and a true fresh recheck can measure zero',()=>{
 const retained=structuredClone(last),row=retained.rows.find(row=>row.soopId==='r65');
 row.cumulativeUsers=next.rows.find(row=>row.soopId==='r65').cumulativeUsers;
 row.metricObservedAt={cumulativeUsers:next.observedAt};
 assert.equal(intervalRate(next,retained,['r65']),null);
 assert.equal(intervalRate(next,retained,['r65','r66']),null);
 assert.equal(intervalRate(next,retained,['singgyul']).daily,4000);
 row.metricObservedAt.cumulativeUsers=last.observedAt;
 assert.equal(intervalRate(next,retained,['r65']).daily,0);
 row.metricObservedAt.cumulativeUsers=null;
 assert.equal(intervalRate(next,retained,['r65']),null);
});

test('a current partial batch adds a fresh chart endpoint and keeps per-candidate timestamps',()=>{
 const s={status:'ok',updatedAt:last.observedAt,collectionMode:'manual_partial',
  manualOverride:{observedAt:last.observedAt,adjustment:-70000},manualBatchOverride:{updatedCandidates:98,retainedCandidates:1},
  streamers:last.rows.map(row=>({...row,metricObservedAt:{cumulativeUsers:row.soopId==='r65'?next.observedAt:last.observedAt}})),
  trendHistory:{comparisonKey:'same',points:[first,next]},
  targetResults:{dynamic:{updatedAt:last.observedAt,projectedRows:last.projectedRows,models:Object.entries(last.models).map(([model,row])=>({model,...row}))}}};
 const before=structuredClone(s),point=currentObservation(s),view=trendView(s);
 assert.equal(point.updatedCandidates,98);assert.equal(point.retainedCandidates,1);
 assert.equal(point.rows.find(row=>row.soopId==='r65').metricObservedAt.cumulativeUsers,next.observedAt);
 assert.equal(view.last.observedAt,last.observedAt);assert.equal(view.series.at(-1).retainedCandidates,1);
 assert.equal(view.series.at(-1).targetDaily,4000);assert.equal(view.series.at(-1).rivalDaily,null);
 assert.deepEqual(s,before);
 s.streamers.find(row=>row.soopId==='singgyul').metricObservedAt.cumulativeUsers=next.observedAt;
 assert.equal(currentObservation(s),null);
});

test('production graph reaches the latest data timestamp, target count and saved model ranks',()=>{
 const s=JSON.parse(readFileSync(new URL('../assets/data/ranking.json',import.meta.url),'utf8'));
 const before=JSON.stringify(s),point=currentObservation(s),view=trendView(s,'minmax');
 assert(point);assert.equal(point.observedAt,s.updatedAt);assert.equal(view.last.observedAt,s.updatedAt);
 assert.equal(view.series.at(-1).targetUsers,s.manualOverride.adjustedViewer);
 assert.equal(view.series.at(-1).forecastRank,s.targetResults.dynamic.models.find(row=>row.model==='minmax').predictedRank);
 const expected=includeReservations(calculateRanking(s.targetResults.dynamic.projectedRows,'minmax'),s.targetResults.dynamic.reservedCount||0).filter(row=>row.soopId!=='singgyul'&&row.predictedRank>=65&&row.predictedRank<=75);
 assert.deepEqual(view.rivals.map(row=>row.soopId),expected.map(row=>row.soopId));
 assert.equal(JSON.stringify(s),before);
});
console.log(`${count} trend data tests passed`);
