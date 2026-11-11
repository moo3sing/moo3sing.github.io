import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {viewerOnlyReference} from '../assets/viewer-reference.js';
import {rollingTargets} from '../assets/rolling-target.js';

function sample(){
 const snapshot={streamers:[['a',50],['b',40],['c',20],['d',5],['singgyul',10]].map(([soopId,cumulativeUsers])=>({soopId,cumulativeUsers,donorCount:null,balloonCount:null})),
  forecast:{rows:[]}};
 const report={horizon:{remainingDays:18,ended:false},projectedRows:[['a',70],['b',50],['c',30],['d',10],['singgyul',25]].map(([soopId,cumulativeUsers])=>({soopId,cumulativeUsers}))};
 return {snapshot,report};
}
const options={cutoffRank:3};

test('viewer reference finds the exact minimum against projected competitors, from target actuals',()=>{
 const {snapshot,report}=sample(),before=structuredClone({snapshot,report});
 const result=viewerOnlyReference(snapshot,report,options);
 assert.equal(result.remaining,21);assert.equal(result.requiredFinal,31);assert.equal(result.predictedRank,4);
 const rank=additional=>1+report.projectedRows.filter(row=>row.soopId!=='singgyul'&&
  (row.cumulativeUsers>10+additional||(row.cumulativeUsers===10+additional&&row.soopId.localeCompare('singgyul','en')<0))).length;
 assert.equal(rank(result.remaining),3);assert.equal(rank(result.remaining-1),4);
 assert.deepEqual({snapshot,report},before);
});

test('competitor growth raises the viewer reference while support values cannot change it',()=>{
 const {snapshot,report}=sample(),before=viewerOnlyReference(snapshot,report,options);
 report.projectedRows.find(row=>row.soopId==='c').cumulativeUsers+=10;
 assert.equal(viewerOnlyReference(snapshot,report,options).remaining,before.remaining+10);
 snapshot.streamers.forEach(row=>{row.donorCount=1e9;row.balloonCount=1e12;});
 assert.equal(viewerOnlyReference(snapshot,report,options).remaining,before.remaining+10);
});

test('same viewer tie-break as existing ranking permits equality only when target ID sorts first',()=>{
 const {snapshot,report}=sample();
 for(const row of [...snapshot.streamers,...report.projectedRows])if(row.soopId==='c')row.soopId='z';
 assert.equal(viewerOnlyReference(snapshot,report,options).remaining,20);
});

test('already qualified and all-cohort cutoffs require zero additional viewers',()=>{
 const {snapshot,report}=sample();snapshot.streamers.find(row=>row.soopId==='singgyul').cumulativeUsers=60;
 report.projectedRows.find(row=>row.soopId==='singgyul').cumulativeUsers=65;
 assert.equal(viewerOnlyReference(snapshot,report,options).remaining,0);
 assert.equal(viewerOnlyReference(snapshot,report,{cutoffRank:5}).remaining,0);
});

test('private-support viewer-known candidates count using the preserved September fallback',()=>{
 const {snapshot,report}=sample();
 snapshot.streamers.push({soopId:'private',cumulativeUsers:29,status:'unavailable'});
 snapshot.forecast.rows.push({soopId:'private',recentMonthlyUsers:30});
 const result=viewerOnlyReference(snapshot,report,options);
 assert.equal(result.candidateCount,6);assert.equal(result.requiredFinal,48);
 snapshot.forecast.rows=[];
 assert.throws(()=>viewerOnlyReference(snapshot,report,options),/Missing viewer trend/);
});

test('after period end there is no new target; zero future days need no missing forecast',()=>{
 const {snapshot,report}=sample();
 report.horizon={remainingDays:0,ended:true};report.projectedRows=[];
 const result=viewerOnlyReference(snapshot,report,options);
 assert.equal(result.remaining,null);assert.equal(result.requiredFinal,null);
 report.horizon.ended=false;
 assert.equal(viewerOnlyReference(snapshot,report,options).remaining,11);
});

test('invalid, duplicate or missing viewer inputs fail instead of creating a zero goal',()=>{
 for(const mutate of [s=>s.streamers[0].cumulativeUsers=null,s=>s.streamers[0].soopId='singgyul',s=>s.streamers.pop()]){
  const {snapshot,report}=sample();mutate(snapshot);assert.throws(()=>viewerOnlyReference(snapshot,report,options));
 }
 const {snapshot,report}=sample();report.projectedRows[0].cumulativeUsers=-1;
 assert.throws(()=>viewerOnlyReference(snapshot,report,options));
});

test('current production snapshot reuses competitor projections and never changes legacy targets or data',()=>{
 const snapshot=JSON.parse(readFileSync(new URL('../assets/data/ranking.json',import.meta.url),'utf8'));
 const report=rollingTargets(snapshot,new Date(snapshot.updatedAt)),before=JSON.stringify({snapshot,report});
 const result=viewerOnlyReference(snapshot,report);
 assert.equal(result.candidateCount,snapshot.streamers.length);
 assert.equal(result.requiredFinal,snapshot.manualOverride.adjustedViewer+result.remaining);
 assert.equal(report.safe,Math.max(...report.models.map(row=>row.remaining)));
 assert.deepEqual(report.models,snapshot.targetResults.dynamic.models);
 assert.equal(JSON.stringify({snapshot,report}),before);
});
