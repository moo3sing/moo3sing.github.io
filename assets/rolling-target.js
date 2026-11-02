import {calendarHorizon,liveTargets} from './live-target.js?v=20261019-fixed';
import {dynamicTargets as legacyTargets} from './dynamic-target.js?v=20261019-fixed';
const KEYS=['cumulativeUsers','donorCount','balloonCount'];
import {fixedSupportCandidates} from './ranking-exceptions.js?v=20261019-fixed';
const dateKey=t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
export function blendPace(base,gain,days){
 const actualDailyPace=days?Math.max(0,gain/days):0,actualWeight=days/(days+7);
 return {elapsedActualDays:days,actualWeight,baseWeight:1-actualWeight,recentBaseDailyPace:base,actualGain:gain,actualDailyPace,
 forecastDailyPace:base*(1-actualWeight)+actualDailyPace*actualWeight,negativeGainClamped:gain<0};
}
export function rollingMetric(base,current,sep,october,anchor,key,observedDate,accountId){
 const baseDaily=base.daily;
 if(observedDate<'2026-11-01'){
  const days=observedDate<'2026-10-01'?0:Math.min(31,Number(observedDate.slice(8)));
  return {...blendPace(baseDaily,current-sep,days),period:'2026-10',novemberBasis:'October rolling pace',baseMonths:base.months,baseWeights:base.weights,fallbackReason:base.fallbackReason};
 }
 const priorRow=october?.rows.find(r=>r.soopId===accountId),priorDate=priorRow||october?dateKey(priorRow?.metricObservedAt?.[key]||priorRow?.observedAt||october.observedAt):null;
 const priorDays=priorDate?.startsWith('2026-10')?Number(priorDate.slice(8)):0;
 const previous=priorRow?blendPace(baseDaily,priorRow[key]-sep,priorDays).forecastDailyPace:baseDaily;
 const anchorRow=anchor?.rows.find(r=>r.soopId===accountId);
 if(!anchorRow)return {...blendPace(previous,0,0),period:'2026-11',novemberBasis:'Last October rolling pace',baseMonths:base.months,baseWeights:base.weights,fallbackReason:'Oct31 observation unavailable; November actual growth not inferred'};
 const days=Math.min(30,Number(observedDate.slice(8)));
 return {...blendPace(previous,current-anchorRow[key],days),period:'2026-11',novemberBasis:'Oct31 last observation + November annual unique/cumulative actual',baseMonths:base.months,baseWeights:base.weights,fallbackReason:base.fallbackReason,anchorObservedAt:anchor.observedAt,anchorStatus:anchor.status};
}
export function projectRollingCandidates(snapshot,now=new Date()){
 const horizon=calendarHorizon(now);
 if(snapshot.simulationBaseline?.status!=='locked'||snapshot.rollingForecast?.method!=='recent_trend_actual_rolling')throw new Error('최근 추세 자료가 준비되지 않았습니다.');
 const originals=new Map(snapshot.simulationBaseline.rows.map(r=>[r.soopId,r]));
 const inputs=new Map(snapshot.rollingForecast.rows.map(r=>[r.soopId,r]));
 const today=dateKey(now);
 const rows=snapshot.streamers.filter(r=>r.status!=='unavailable').map(actual=>{
 const observation=snapshot.collectionMode==='manual_partial'&&actual.soopId==='singgyul'?snapshot.manualOverride?.observedAt:
  snapshot.collectionMode==='manual_partial'?snapshot.competitorDataAsOf:snapshot.actualObservedAt||snapshot.updatedAt;
 if(!observation)throw new Error('후보 관측 시각 누락');
 // A later single-account admin override supersedes dates from an earlier batch.
 const metricDates=snapshot.collectionMode==='manual_partial'&&actual.soopId==='singgyul'&&
  Date.parse(observation)>Date.parse(actual.metricObservedAt?.cumulativeUsers||observation)?null:actual.metricObservedAt;
 const viewerObservation=metricDates?.cumulativeUsers||observation;
 const observed=dateKey(viewerObservation),actualDate=observed>today?today:observed;
 const baseline=originals.get(actual.soopId),input=inputs.get(actual.soopId);
 if(!baseline||!input||actual.donorEstimated!==false)throw new Error('검증된 전체 후보 actual/recent 데이터가 필요합니다.');
 const metadata={},projected={...actual,valueKind:horizon.ended?'final_observation':'forecast',donorEstimated:!horizon.ended,donorSource:'Annual unique actual + estimated new-to-year rolling growth'};
 for(const key of KEYS){
 if(!Number.isSafeInteger(actual[key])||actual[key]<0||!Number.isFinite(input[key]?.daily)||input[key].daily<0)throw new Error('실제값 또는 추세 누락');
 const metricObservation=metricDates?.[key]||observation;
 const metricObservedDate=dateKey(metricObservation),metricDate=metricObservedDate>today?today:metricObservedDate;
 const pace=rollingMetric(input[key],actual[key],baseline[key],snapshot.octoberObservation,snapshot.oct31Observation,key,metricDate,actual.soopId);
 const donorDays=Array.from({length:horizon.remainingDays},(_,i)=>1/(1+(i+1)/60)).reduce((s,n)=>s+n,0);
 const days=key==='donorCount'?donorDays:horizon.remainingDays;
 projected[key]=actual[key]+Math.round(pace.forecastDailyPace*days);
 metadata[key]={...pace,observedDate:metricDate,forecastRemaining:projected[key]-actual[key],projectedOctRemaining:key==='donorCount'?null:pace.forecastDailyPace*horizon.months[0].days,
 method:key==='donorCount'?'annual_unique_actual_rolling_conservative_base_damped':'recent_trend_actual_rolling'};
 }
 projected.forecast={method:'recent_trend_actual_rolling',observedDate:actualDate,remainingDays:horizon.remainingDays,metrics:metadata};
 return {actual,baseline,projected,forecast:projected.forecast,donorPace:{daily:metadata.donorCount.forecastDailyPace,source:'annual-unique-rolling'},balloonPace:{daily:metadata.balloonCount.forecastDailyPace,source:'recent-trend-actual-rolling'},donorForecastEstimated:true,gains:Object.fromEntries(KEYS.map(k=>[k,actual[k]-baseline[k]]))};
 });
 return {horizon,rows:[...rows,...fixedSupportCandidates(snapshot,horizon,now)]};
}
export function rollingTargets(snapshot,now=new Date(),options={}){
 return {...legacyTargets(snapshot,now,{...options,projector:projectRollingCandidates}),mode:'recent_trend_actual_rolling'};
}
export function compareRollingModes(snapshot,now=new Date()){
 const fixed=liveTargets(snapshot,now),previous=legacyTargets(snapshot,now),dynamic=rollingTargets(snapshot,now);
 return {fixed,previous,dynamic,difference:dynamic.safe===null||fixed.safe===null?null:dynamic.safe-fixed.safe,previousDifference:dynamic.safe===null||previous.safe===null?null:dynamic.safe-previous.safe};
}
