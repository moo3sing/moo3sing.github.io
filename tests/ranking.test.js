import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRanking, metricScore, getBoundary, MODELS} from '../assets/ranking.js';
const row = (id,v,d=v,b=v) => ({soopId:id,name:id,rankByViewer:1,cumulativeUsers:v,donorCount:d,balloonCount:b});
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
for (const model of Object.keys(MODELS)) {
  test(`${model}: extrema, weights, purity`,()=>{
    const data=[row('a',100,0,0),row('b',0,100,100)];
    const before=JSON.stringify(data), result=calculateRanking(data,model);
    close(result[0].score,80);close(result[1].score,20);
    assert.equal(JSON.stringify(data),before);
    close(metricScore([0,50,100],100,model),100);
    close(metricScore([0,50,100],0,model),0);
  });
  test(`${model}: ties, singleton, empty, zeros`,()=>{
    const result=calculateRanking([row('b',10),row('a',10)],model);
    close(result[0].score,result[1].score);assert.equal(result[0].soopId,'a');
    assert.equal(result[0].viewerRank,1.5);
    assert.ok(Number.isFinite(calculateRanking([row('a',0)],model)[0].score));
    assert.deepEqual(calculateRanking([],model),[]);
    assert.ok(calculateRanking([row('a',0),row('b',0)],model).every(r=>Number.isFinite(r.score)));
  });
}
test('rank and empirical percentile agree including ties',()=>{
  for (const v of [3,5,5,8,20])close(metricScore([3,5,5,8,20],v,'rank'),metricScore([3,5,5,8,20],v,'percentile'));
});
test('missing, negative, NaN, duplicate IDs rejected',()=>{
  for(const bad of [null,undefined,NaN,-1,Infinity])assert.throws(()=>calculateRanking([row('a',bad)]));
  assert.throws(()=>calculateRanking([row('a',1),row('a',2)]));
});
test('boundary is exactly positions 70 and 71; no early rounding',()=>{
  const rows=calculateRanking(Array.from({length:100},(_,i)=>row(String(i),100-i)));
  const boundary=getBoundary(rows);
  assert.equal(boundary.cutoff.soopId,'69');assert.equal(boundary.next.soopId,'70');
  close(boundary.gap,100/99);assert.equal(rows.filter(r=>r.predictedRank<=70).length,70);
  assert.equal(getBoundary(rows.slice(0,69)),null);
});
