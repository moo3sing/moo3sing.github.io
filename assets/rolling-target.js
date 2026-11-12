import {calendarHorizon,liveTargets,dampedDays} from './live-target.js?v=20261113-time';
import {dynamicTargets as legacyTargets} from './dynamic-target.js?v=20261113-time';
const KEYS=['cumulativeUsers','donorCount','balloonCount'];
import {fixedSupportCandidates} from './ranking-exceptions.js?v=20261019-fixed';
import {recentSevenDayPace,usesRecentSevenDays} from './recent-pace.js';
const dateKey=t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
const timeOf=value=>Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T00:00:00+09:00':value);
const elapsed=(from,to)=>Math.max(0,(timeOf(to)-timeOf(from))/86400000);
export function blendPace(base,gain,days){
 const actualDailyPace=days?Math.max(0,gain/days):0,actualWeight=days/(days+7);
 return {elapsedActualDays:days,actualWeight,baseWeight:1-actualWeight,recentBaseDailyPace:base,actualGain:gain,actualDailyPace,
 forecastDailyPace:base*(1-actualWeight)+actualDailyPace*actualWeight,negativeGainClamped:gain<0};
}
export function rollingMetric(base,current,sep,october,anchor,key,observedDate,accountId){
 const baseDaily=base.daily;
 const observed=timeOf(observedDate);
 if(observed<timeOf('2026-11-01')){
  const days=Math.min(31,elapsed('2026-10-01',observedDate));
  return {...blendPace(baseDaily,current-sep,days),period:'2026-10',novemberBasis:'October rolling pace',baseMonths:base.months,baseWeights:base.weights,fallbackReason:base.fallbackReason};
 }
 const priorRow=october?.rows.find(r=>r.soopId===accountId),priorAt=priorRow?.metricObservedAt?.[key]||priorRow?.observedAt||october?.observedAt;
 const priorDays=priorAt?Math.min(31,elapsed('2026-10-01',priorAt)):0;
 const previous=priorRow?blendPace(baseDaily,priorRow[key]-sep,priorDays).forecastDailyPace:baseDaily;
 const anchorRow=anchor?.rows.find(r=>r.soopId===accountId);
 if(!anchorRow)return {...blendPace(previous,0,0),period:'2026-11',novemberBasis:'Last October rolling pace',baseMonths:base.months,baseWeights:base.weights,fallbackReason:'Oct31 observation unavailable; November actual growth not inferred'};
 const anchorAt=anchorRow.metricObservedAt?.[key]||anchorRow.observedAt||anchor.observedAt;
 const days=elapsed(anchorAt,observedDate);
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
 const metricObservation=usesRecentSevenDays(snapshot)&&snapshot.collectionMode==='automatic'?snapshot.actualObservedAt||observation:metricDates?.[key]||observation;
 const metricObservedDate=dateKey(metricObservation),metricDate=metricObservedDate>today?today:metricObservedDate;
 const paceAt=timeOf(metricObservation)>new Date(now).getTime()?new Date(now).toISOString():metricObservation;
 const previousPace=rollingMetric(input[key],actual[key],baseline[key],snapshot.octoberObservation,snapshot.oct31Observation,key,paceAt,actual.soopId);
 const pace=usesRecentSevenDays(snapshot)?recentSevenDayPace(snapshot,actual,key,previousPace,metricObservation):previousPace;
 const donorDays=dampedDays(horizon.remainingDays);
 const days=key==='donorCount'?donorDays:horizon.remainingDays;
 projected[key]=actual[key]+Math.round(pace.forecastDailyPace*days);
 metadata[key]={...pace,observedDate:metricDate,forecastRemaining:projected[key]-actual[key],projectedOctRemaining:key==='donorCount'?null:pace.forecastDailyPace*horizon.months[0].days,
 method:usesRecentSevenDays(snapshot)?(key==='donorCount'?'recent_7d_annual_unique_damped':'recent_7d_average'):key==='donorCount'?'annual_unique_actual_rolling_conservative_base_damped':'recent_trend_actual_rolling'};
 }
 projected.forecast={method:usesRecentSevenDays(snapshot)?'recent_7d_average':'recent_trend_actual_rolling',observedDate:usesRecentSevenDays(snapshot)?metadata.cumulativeUsers.observedDate:actualDate,remainingDays:horizon.remainingDays,metrics:metadata};
 return {actual,baseline,projected,forecast:projected.forecast,donorPace:{daily:metadata.donorCount.forecastDailyPace,source:metadata.donorCount.paceSource||'annual-unique-rolling'},balloonPace:{daily:metadata.balloonCount.forecastDailyPace,source:metadata.balloonCount.paceSource||'recent-trend-actual-rolling'},donorForecastEstimated:true,gains:Object.fromEntries(KEYS.map(k=>[k,actual[k]-baseline[k]]))};
 });
 const fixed=fixedSupportCandidates(snapshot,horizon,now);
 if(usesRecentSevenDays(snapshot))for(const item of fixed){
  const previous=item.forecast.metrics.cumulativeUsers;
  const observed=snapshot.collectionMode==='automatic'?snapshot.actualObservedAt||snapshot.updatedAt:item.actual.metricObservedAt?.cumulativeUsers||snapshot.updatedAt;
  const pace=recentSevenDayPace(snapshot,item.actual,'cumulativeUsers',previous,observed);
  const users=item.actual.cumulativeUsers+Math.round(pace.forecastDailyPace*horizon.remainingDays);
  item.projected.cumulativeUsers=users;
  item.forecast.method=pace.paceSource?.startsWith('recent-')?'recent_7d_viewer_fixed_support':item.forecast.method;
  item.forecast.metrics.cumulativeUsers={...pace,method:'recent_7d_average',forecastRemaining:users-item.actual.cumulativeUsers};
 }
 return {horizon,rows:[...rows,...fixed]};
}
export function rollingTargets(snapshot,now=new Date(),options={}){
 return {...legacyTargets(snapshot,now,{...options,projector:projectRollingCandidates}),mode:usesRecentSevenDays(snapshot)?'recent_7d_average':'recent_trend_actual_rolling'};
}
export function compareRollingModes(snapshot,now=new Date()){
 const fixed=liveTargets(snapshot,now),previous=legacyTargets(snapshot,now),dynamic=rollingTargets(snapshot,now);
 return {fixed,previous,dynamic,difference:dynamic.safe===null||fixed.safe===null?null:dynamic.safe-fixed.safe,previousDifference:dynamic.safe===null||previous.safe===null?null:dynamic.safe-previous.safe};
}
