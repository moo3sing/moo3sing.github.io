import test from 'node:test';
import assert from 'node:assert/strict';
import {recentSevenDayPace} from '../assets/recent-pace.js';
import {readFileSync} from 'node:fs';
import {projectRollingCandidates,rollingTargets} from '../assets/rolling-target.js';
import {rankingView} from '../assets/ranking-view.js';

const at=day=>`2026-11-${String(day).padStart(2,'0')}T12:00:00+09:00`;
const point=(day,value,id='a',key='cumulativeUsers')=>({observedAt:at(day),rows:[{soopId:id,[key]:value,metricObservedAt:{[key]:at(day)}}]});
const fallback={forecastDailyPace:999,actualWeight:.6};
function rate(points,value=900,day=12){
 return recentSevenDayPace({updatedAt:at(day),recentTrend:{observations:points}},
  {soopId:'a',cumulativeUsers:value},'cumulativeUsers',fallback,at(day));
}

test('exact seven-day average replaces the monthly mixture and ignores observations outside the window',()=>{
 const result=rate([point(1,0),point(5,200),point(8,300)]);
 assert.equal(result.forecastDailyPace,100);assert.equal(result.observedDays,7);
 assert.equal(result.actualWeight,1);assert.equal(result.baseWeight,0);assert.equal(result.actualGain,700);
 assert.equal(result.paceSource,'recent-7d-average');assert.equal(result.boundaryEstimated,false);
});

test('irregular intervals use elapsed time and clip the seven-day boundary within an observed segment',()=>{
 const result=rate([point(4,0),point(6,200),point(8,400)],1200);
 assert(Math.abs(result.forecastDailyPace-1100/7)<1e-9);
 assert.equal(result.observedDays,7);assert.equal(result.boundaryEstimated,true);
});

test('available one-to-seven-day observations use their actual span and disclose incomplete coverage',()=>{
 const result=rate([point(10,500)]);
 assert.equal(result.forecastDailyPace,200);assert.equal(result.observedDays,2);
 assert.equal(result.paceSource,'recent-partial-average');assert(result.fallbackReason);
 assert.equal(rate([point(12,900)]).paceSource,'previous-trend-fallback');
});

test('stale observations never shift their old seven-day window forward or create zero daily growth',()=>{
 const s={updatedAt:at(12),recentTrend:{observations:[point(1,0),point(3,200)]}};
 const result=recentSevenDayPace(s,{soopId:'a',cumulativeUsers:400},'cumulativeUsers',fallback,at(10));
 assert.equal(result.observedDays,5);assert.equal(result.paceSource,'recent-partial-average');
 assert.equal(recentSevenDayPace(s,{soopId:'a',cumulativeUsers:0},'cumulativeUsers',fallback,at(1)).paceSource,'previous-trend-fallback');
});

test('per-metric dates deduplicate unchanged donors; future records and day-only sources are excluded',()=>{
 const donorPoint=point(5,100,'a','donorCount');
 const s={updatedAt:at(12),recentTrend:{observations:[donorPoint,{...donorPoint,observedAt:at(10)},point(13,1e9,'a','donorCount')]}};
 const result=recentSevenDayPace(s,{soopId:'a',donorCount:100},'donorCount',fallback,at(5));
 assert.equal(result.forecastDailyPace,999);assert.equal(result.paceSource,'previous-trend-fallback');
 s.manualBatchOverride={sourceObservation:{precision:'day'}};
 assert.equal(recentSevenDayPace(s,{soopId:'a',cumulativeUsers:900},'cumulativeUsers',fallback,at(12)).paceSource,'previous-trend-fallback');
});

test('source decreases reset comparison and suspected-bot adjustments do not become growth',()=>{
 const reset=rate([point(5,500),point(8,400),point(10,600)],1000);
 assert.equal(reset.forecastDailyPace,150);assert.equal(reset.observedDays,4);
 const s={updatedAt:at(12),manualOverride:{rawViewer:1700},recentTrend:{observations:[point(5,1000,'singgyul')]}};
 const result=recentSevenDayPace(s,{soopId:'singgyul',cumulativeUsers:700},'cumulativeUsers',fallback,at(12));
 assert.equal(result.forecastDailyPace,100);
});

test('multi-day gaps beyond seven days are not connected and missing values never become zero',()=>{
 assert.equal(rate([point(1,0)],900).paceSource,'previous-trend-fallback');
 assert.equal(rate([point(5,null)],900).paceSource,'previous-trend-fallback');
 assert.equal(rate([point(5,200),point(13,1e12)]).forecastDailyPace,100);
});

test('successful automatic rechecks move the observation window even when counters stay flat',()=>{
 const s={updatedAt:at(12),actualObservedAt:at(13),collectionMode:'automatic',manualOverride:{rawViewer:999999},
  recentTrend:{asOf:at(13),observations:[point(6,100,'a','donorCount'),point(6,1000,'singgyul')]}};
 const donor=recentSevenDayPace(s,{soopId:'a',donorCount:100},'donorCount',fallback,at(13));
 assert.equal(donor.forecastDailyPace,0);assert.equal(donor.observedDays,7);
 const viewer=recentSevenDayPace(s,{soopId:'singgyul',cumulativeUsers:900,rawMetrics:{viewer:1700}},'cumulativeUsers',fallback,at(13));
 assert.equal(viewer.forecastDailyPace,100);assert.equal(viewer.observedDays,7);
});

test('main ranking, Log, solver and viewer forecast share the latest seven-day competitor projection',()=>{
 const s=JSON.parse(readFileSync(new URL('../assets/data/ranking.json',import.meta.url),'utf8'));
 const before=JSON.stringify(s),now=new Date(s.updatedAt),projection=projectRollingCandidates(s,now),report=rollingTargets(s,now);
 assert.equal(report.mode,'recent_7d_average');
 assert.equal(report.safe,Math.max(...report.models.map(row=>row.remaining)));
 for(const model of ['rank','ratio','minmax','log']){
  const ranking=rankingView(s,model,'forecast',now).ranked.find(row=>row.soopId==='singgyul');
  const result=[...report.models,...report.experimentalModels].find(row=>row.model===model);
  assert.equal(result.predictedRank,ranking.predictedRank);
 }
 assert.deepEqual(projection.rows.map(row=>row.projected),report.projectedRows);
 assert.equal(JSON.stringify(s),before);
 const ended=projectRollingCandidates(s,'2026-12-01T00:00:00+09:00');
 for(const row of ended.rows)assert.equal(row.projected.cumulativeUsers,row.actual.cumulativeUsers);
});
