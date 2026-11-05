import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {calculateRanking,metricScore,METRICS} from '../assets/ranking.js';
import {rankingView} from '../assets/ranking-view.js';
import {dynamicTargets} from '../assets/dynamic-target.js';
import {rollingTargets,compareRollingModes} from '../assets/rolling-target.js';
import {calendarHorizon} from '../assets/live-target.js';
import {fixedSupportScores,rankForAdditional} from '../assets/simulation.js';
import {SIMULATION_CONFIG,TARGET_MODEL_POLICY} from '../assets/simulation-config.js';

const fixtureText=readFileSync(new URL('./fixtures/legacy-ranking.json',import.meta.url),'utf8').replaceAll('\r\n','\n');
const fixture=JSON.parse(fixtureText);
const golden=JSON.parse(readFileSync(new URL('./fixtures/legacy-model-regression.json',import.meta.url),'utf8'));
const current=JSON.parse(readFileSync(new URL('../assets/data/ranking.json',import.meta.url),'utf8'));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const row=(id,v,d=v,b=v)=>({soopId:id,name:id,cumulativeUsers:v,donorCount:d,balloonCount:b});
const close=(a,b,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
function legacyFields(value){
  if(Array.isArray(value))return value.map(legacyFields);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value)
    .filter(([key])=>key!=='experimentalModels').map(([key,item])=>[key,legacyFields(item)]));
  return value;
}

test('Log has exact extrema, interior values, zero and the requested ln(1+x) formula',()=>{
  const values=[0,10,100,1000];
  close(metricScore(values,0,'log'),0);
  close(metricScore(values,1000,'log'),100);
  for(const x of [10,100]){
    const score=metricScore(values,x,'log');
    assert(score>0&&score<100);
    close(score,Math.log1p(x)/Math.log1p(1000)*100);
  }
  close(metricScore([100,1000,10000],100,'log'),0);
});

test('Log handles identical, singleton, empty and very large finite values',()=>{
  for(const values of [[0,0],[42,42],[42],[1e300,1e300]]){
    const score=metricScore(values,values[0],'log');
    assert.equal(score,0);assert(Number.isFinite(score));
  }
  assert.equal(metricScore([],0,'log'),0);
  for(const x of [0,1e300,1e308])assert(Number.isFinite(metricScore([0,1e300,1e308],x,'log')));
  for(const x of [-1,NaN,Infinity])assert.throws(()=>calculateRanking([row('bad',x)],'log'));
});

test('Log preserves each metric order and never reduces the growing candidate score',()=>{
  let previous=-1;
  for(const value of [0,10,100,1000,10000,100000,1000000,2000000]){
    const score=calculateRanking([row('target',value,20,30),row('a',100,10,20),row('b',1000000,30,40)],'log')
      .find(r=>r.soopId==='target').score;
    assert(score>=previous);previous=score;
  }
  const values=[0,1,10,1000,1000000],scores=values.map(x=>metricScore(values,x,'log'));
  assert(scores.every((score,i)=>i===0||score>scores[i-1]));
});

test('Log uses the unchanged 80/10/10 weights and does not mutate raw metrics',()=>{
  assert.deepEqual(METRICS.map(m=>m.weight),[.8,.1,.1]);
  const input=[row('a',100,0,0),row('b',0,100,100)],before=structuredClone(input);
  const ranked=calculateRanking(input,'log');
  close(ranked[0].score,80);close(ranked[1].score,20);
  assert.deepEqual(input,before);
});

test('Log compresses the requested 100 to 1000000 example without production data changes',()=>{
  const values=[100,1000,10000,100000,1000000];
  const log=values.map(x=>metricScore(values,x,'log'));
  const minmax=values.map(x=>metricScore(values,x,'minmax'));
  for(let i=1;i<4;i++)assert(Math.abs(log[i]-i*25)<.2);
  assert(log[1]>minmax[1]);assert(log[3]-log[2]<minmax[4]-minmax[3]);
});

assert.equal(createHash('sha256').update(fixtureText).digest('hex'),golden.fixtureSha256);
for(const scenario of golden.cases)test(`legacy rankings, targets and SafeTarget are unchanged at ${scenario.now}`,()=>{
  for(const [key,expected] of Object.entries(scenario.rankings)){
    const [basis,model]=key.split(':');
    assert.equal(hash(rankingView(fixture,model,basis,scenario.now)),expected,key);
  }
  assert.equal(hash(legacyFields(compareRollingModes(fixture,scenario.now))),scenario.targets);
});

test('Log actual/projected rankings use the full existing cohort and adjusted viewer',()=>{
  const before=structuredClone(current),now=current.updatedAt;
  const result=rollingTargets(current,now);
  const view=rankingView(current,'log','forecast',now);
  const scored=calculateRanking(result.projectedRows,'log');
  assert.deepEqual(view.ranked.map(r=>[r.soopId,r.score]),scored.map(r=>[r.soopId,r.score]));
  const actual=rankingView(current,'log','actual',now).ranked;
  const target=actual.find(r=>r.soopId==='singgyul');
  assert.equal(target.cumulativeUsers,current.manualOverride.adjustedViewer);
  assert.equal(target.cumulativeUsers,current.manualOverride.rawViewer+current.manualOverride.adjustment);
  const fullValues=actual.map(r=>r.cumulativeUsers);
  close(target.breakdown[0].score,metricScore(fullValues,target.cumulativeUsers,'log'));
  assert.deepEqual(result.models,current.targetResults.dynamic.models);
  assert.equal(result.safe,current.targetResults.dynamic.safe);
  assert.deepEqual(current,before);
});

test('Log reuses the exact integer solver and full projected support normalization',()=>{
  const result=rollingTargets(fixture,'2026-10-01T12:00:00+09:00');
  const log=result.experimentalModels.find(m=>m.model==='log');
  assert(log.experimental);assert(log.remaining>0);
  const context={baselineRows:result.projectedRows,forecastRows:result.projectedRows,
    target:result.target.actual,config:{...SIMULATION_CONFIG,cutoffRank:result.scoreCutoffRank},
    model:'log',fixedSupport:fixedSupportScores(result.projectedRows,'log')};
  assert(rankForAdditional(context,log.remaining).target.predictedRank<=result.scoreCutoffRank);
  assert(rankForAdditional(context,log.remaining-1).target.predictedRank>result.scoreCutoffRank);
  const expected=calculateRanking(result.projectedRows,'log').find(r=>r.soopId==='singgyul');
  assert.deepEqual(log.supportScores.map(s=>s.score),expected.breakdown.slice(1).map(s=>s.score));
  assert.equal(log.requiredFinal,result.currentUsers+log.remaining);
  assert.equal(result.safe,Math.max(...result.models.map(m=>m.remaining)));
});

test('a larger or unreachable experimental Log target cannot change SafeTarget',()=>{
  const actual=[row('singgyul',1000000,0,0),...Array.from({length:99},(_,i)=>row('c'+i,(i+2)*1000000,i===98?1e9:10000,i===98?1e9:10000))];
  const snapshot={streamers:actual};
  const projector=(_snapshot,now)=>({horizon:calendarHorizon(now),rows:actual.map(value=>({actual:value,projected:value,gains:{cumulativeUsers:0}}))});
  const result=dynamicTargets(snapshot,'2026-11-05T12:00:00+09:00',{projector});
  assert.deepEqual(result.models.map(m=>m.model),['rank','ratio','minmax']);
  assert(result.experimentalModels[0].remaining>result.safe);
  const bounded=dynamicTargets(snapshot,'2026-11-05T12:00:00+09:00',{projector,maxAdditionalUsers:result.safe});
  assert.equal(bounded.experimentalModels[0].remaining,null);
  assert.equal(bounded.safe,result.safe);
  assert.equal(bounded.safeModel,result.safeModel);
  assert.deepEqual(TARGET_MODEL_POLICY.safe,['rank','ratio','minmax']);
  assert.deepEqual(TARGET_MODEL_POLICY.experimental,['log']);
});

test('Log respects the existing evaluation end date',()=>{
  const ended=rollingTargets(fixture,'2026-12-01T00:00:00+09:00');
  assert.equal(ended.experimentalModels[0].remaining,null);
  assert.equal(ended.experimentalModels[0].boundary,null);
  assert.equal(ended.safe,null);
});
