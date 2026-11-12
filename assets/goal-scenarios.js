import {projectRollingCandidates} from './rolling-target.js?v=20261112-seven';
import {dynamicTargets} from './dynamic-target.js?v=20261019-fixed';
import {usesRecentSevenDays} from './recent-pace.js';

/** Compare trend assumptions with the same cohort, weights and exact TOP70 solver. */
export function goalScenarios(snapshot,now=new Date(),options={}){
 const recentProjection=projectRollingCandidates(snapshot,now);
 // Removing only the new pace input selects the original, continuously updated rolling model.
 const originalProjection=projectRollingCandidates({...snapshot,recentTrend:undefined},now);
 const calculate=(projection,mode)=>({...dynamicTargets(snapshot,now,{...options,projector:()=>projection}),mode});
 const recent=calculate(recentProjection,usesRecentSevenDays(snapshot)?'recent_7d_average':'recent_trend_actual_rolling');
 const original=calculate(originalProjection,'recent_trend_actual_rolling');
 const originalById=new Map(originalProjection.rows.map(row=>[row.actual.soopId,row]));
 const rows=recentProjection.rows.map(item=>{
  const previous=originalById.get(item.actual.soopId);
  if(!previous)throw new Error('Scenario cohorts do not match');
  const target=item.actual.soopId===recent.target.actual.soopId;
  const projected={...item.projected},metrics={...item.forecast.metrics};
  for(const key of ['cumulativeUsers','donorCount','balloonCount']){
   const select=target?Math.min:Math.max;
   projected[key]=select(item.projected[key],previous.projected[key]);
   const chosen=projected[key]===item.projected[key]?item:previous;
   metrics[key]={...chosen.forecast.metrics[key],scenarioChoice:target?'lower-trend':'higher-trend'};
  }
  projected.forecast={...item.forecast,method:'conservative-trend-envelope',metrics};
  return {...item,projected,forecast:projected.forecast,
   donorPace:{...item.donorPace,daily:metrics.donorCount.forecastDailyPace},
   balloonPace:{...item.balloonPace,daily:metrics.balloonCount.forecastDailyPace}};
 });
 const adverse=calculate({...recentProjection,rows},'conservative-trend-envelope');
 // Normalization can move thresholds counterintuitively. Keep the conservative display
 // at least as high as either comparison, and fail closed if any required goal is unavailable.
 const goals=[recent.safe,original.safe,adverse.safe];
 const safe=goals.some(value=>value===null)?null:Math.max(...goals);
 const conservative={...adverse,scenarioSafe:adverse.safe,safe,
  daily:safe===null||!adverse.horizon.remainingDays?null:Math.ceil(safe/adverse.horizon.remainingDays),
  comparisonFloorApplied:safe!==null&&safe!==adverse.safe};
 return {recent,original,conservative,policy:'target-lower-rivals-higher-of-recent-7d-and-original'};
}
