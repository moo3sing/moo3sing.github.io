import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {currentViewerGap} from '../assets/viewer-reference.js';
import {rollingTargets} from '../assets/rolling-target.js';

const sample=()=>({streamers:[['a',50],['b',40],['c',20],['d',5],['singgyul',10]].map(([soopId,cumulativeUsers])=>({soopId,cumulativeUsers,donorCount:null,balloonCount:null}))});
const options={cutoffRank:3};

test('reference is the exact current cutoff difference, with no extra one-user solver margin',()=>{
 const snapshot=sample(),before=structuredClone(snapshot),result=currentViewerGap(snapshot,options);
 assert.equal(result.gap,10);assert.equal(result.cutoffUsers,20);assert.equal(result.currentUsers,10);assert.equal(result.currentRank,4);
 assert.deepEqual(snapshot,before);
});

test('forecasts, support values and calendar metadata cannot affect the current gap',()=>{
 const snapshot=sample(),before=currentViewerGap(snapshot,options);
 snapshot.forecast={rows:snapshot.streamers.map(row=>({...row,recentMonthlyUsers:1e9}))};
 snapshot.targetResults={dynamic:{projectedRows:snapshot.streamers.map(row=>({...row,cumulativeUsers:1e12}))}};
 snapshot.updatedAt='2026-12-01T00:00:00+09:00';
 snapshot.streamers.forEach(row=>{row.donorCount=1e9;row.balloonCount=1e12;});
 assert.deepEqual(currentViewerGap(snapshot,options),before);
});

test('only current viewer updates change the gap',()=>{
 const snapshot=sample();snapshot.streamers.find(row=>row.soopId==='c').cumulativeUsers+=7;
 assert.equal(currentViewerGap(snapshot,options).gap,17);
 snapshot.streamers.find(row=>row.soopId==='singgyul').cumulativeUsers+=3;
 assert.equal(currentViewerGap(snapshot,options).gap,14);
});

test('reference includes private-support candidates without requiring forecast data',()=>{
 const snapshot=sample();snapshot.streamers.push({soopId:'private',cumulativeUsers:30,status:'unavailable'});
 const result=currentViewerGap(snapshot,options);
 assert.equal(result.candidateCount,6);assert.equal(result.cutoffUsers,30);assert.equal(result.gap,20);
});

test('already at or above the cutoff displays zero; ties do not add a solver margin',()=>{
 const snapshot=sample(),target=snapshot.streamers.find(row=>row.soopId==='singgyul');
 for(const value of [20,21,100]){target.cumulativeUsers=value;assert.equal(currentViewerGap(snapshot,options).gap,0);}
 target.cumulativeUsers=10;
 assert.equal(currentViewerGap(snapshot,{cutoffRank:5}).gap,0);
});

test('invalid, missing and duplicate inputs fail instead of showing a misleading zero',()=>{
 for(const mutate of [s=>s.streamers[0].cumulativeUsers=null,s=>s.streamers[0].cumulativeUsers=-1,s=>s.streamers[0].soopId='singgyul',s=>s.streamers.pop()]){
  const snapshot=sample();mutate(snapshot);assert.throws(()=>currentViewerGap(snapshot,options));
 }
 assert.throws(()=>currentViewerGap(sample(),{cutoffRank:0}));
 assert.throws(()=>currentViewerGap(sample(),{cutoffRank:6}));
});

test('production gap uses the 70th current viewer total and leaves data and legacy targets untouched',()=>{
 const snapshot=JSON.parse(readFileSync(new URL('../assets/data/ranking.json',import.meta.url),'utf8'));
 const report=rollingTargets(snapshot,new Date(snapshot.updatedAt)),before=JSON.stringify({snapshot,report});
 const result=currentViewerGap(snapshot);
 const values=snapshot.streamers.map(row=>row.cumulativeUsers).sort((a,b)=>b-a);
 assert.equal(result.cutoffUsers,values[69]);
 assert.equal(result.gap,Math.max(0,values[69]-snapshot.manualOverride.adjustedViewer));
 assert.equal(report.safe,Math.max(...report.models.map(row=>row.remaining)));
 assert.deepEqual(report.models,snapshot.targetResults.dynamic.models);
 assert.equal(JSON.stringify({snapshot,report}),before);
});
