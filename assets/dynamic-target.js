import {calendarHorizon,liveTargets} from './live-target.js?v=20261019-fixed';
import {fixedSupportScores,calculateForecastRanking,minimumAdditional,rankForAdditional} from './simulation.js';
import {calculateRanking} from './ranking.js';
import {SIMULATION_CONFIG,TARGET_MODEL_POLICY} from './simulation-config.js';
import {top70Reservations,rankBounds,fixedSupportCandidates} from './ranking-exceptions.js?v=20261019-fixed';
const DAY=86400000;
const valueKeys=['cumulativeUsers','donorCount','balloonCount'];
function median(a){const s=[...a].sort((x,y)=>x-y),n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;}
/** Observed differences between daily annual totals; never sum monthly unique donors. */
export function recentPace(history,current,key,baselinePace,asOf){
 const cutoff=Date.parse(asOf)-14*DAY;
 const points=history.filter(h=>Date.parse(h.observedAt)>=cutoff&&Date.parse(h.observedAt)<Date.parse(asOf))
 .map(h=>({time:Date.parse(h.observedAt),value:h.rows.find(r=>r.soopId===current.soopId)?.[key]}))
 .filter(p=>Number.isSafeInteger(p.value)).sort((a,b)=>a.time-b.time);
 points.push({time:Date.parse(asOf),value:current[key]});
 const rates=[];let days=0;
 for(let i=1;i<points.length;i++){
  const span=(points[i].time-points[i-1].time)/DAY;
  if(span<.5||span>2.1||points[i].value<points[i-1].value)continue;
  rates.push({rate:(points[i].value-points[i-1].value)/span,days:span});days+=span;
 }
 if(days<7||rates.length<6)return {daily:baselinePace,source:'september-fallback',observedDays:days,rawDaily:null};
 const cap=Math.max(baselinePace*3,median(rates.map(r=>r.rate))*3);
 const rawDaily=rates.reduce((s,r)=>s+r.rate*r.days,0)/days;
 const robust=rates.reduce((s,r)=>s+Math.min(r.rate,cap)*r.days,0)/days;
 return {daily:baselinePace*.3+robust*.7,source:'recent-14d-70%+september-30%',observedDays:days,rawDaily};
}
export function projectCandidates(snapshot,now=new Date()){
 const horizon=calendarHorizon(now);
 if(snapshot.simulationBaseline?.status!=='locked'||snapshot.supportBaseline?.status!=='locked')throw new Error('후원 추세 기준이 준비되지 않았습니다.');
 const originals=new Map(snapshot.simulationBaseline.rows.map(r=>[r.soopId,r]));
 const support=new Map(snapshot.supportBaseline.rows.map(r=>[r.soopId,r]));
 const viewers=new Map(snapshot.forecast.rows.map(r=>[r.soopId,r.recentMonthlyUsers]));
 const rows=snapshot.streamers.filter(r=>r.status!=='unavailable').map(actual=>{
 const base=originals.get(actual.soopId),sep=support.get(actual.soopId);
 if(!base||!sep||actual.donorEstimated!==false)throw new Error('검증된 연간 후원자 데이터가 필요합니다.');
 for(const key of valueKeys)if(!Number.isSafeInteger(actual[key])||actual[key]<0)throw new Error('실제 데이터 누락');
 // September monthly unique donors are an upper bound, not new-to-year donors.
 const donorDaily=Math.min(sep.donorCount/30,base.donorCount/273);
 const balloonPace=recentPace(snapshot.supportHistory||[],actual,'balloonCount',sep.balloonCount/30,snapshot.updatedAt);
 const donorPace=recentPace(snapshot.supportHistory||[],actual,'donorCount',donorDaily,snapshot.updatedAt);
 const viewerDaily=viewers.get(actual.soopId)/30;
 if(!Number.isFinite(viewerDaily)||viewerDaily<0)throw new Error('9월 유저 추세 누락');
 // Explicit scenario assumption: marginal new annual donors decay with a 60-day scale.
 const effectiveDonorDays=Array.from({length:horizon.remainingDays},(_,i)=>1/(1+(i+1)/60)).reduce((s,n)=>s+n,0);
 const projected={...actual,valueKind:'forecast',donorEstimated:true,donorSource:'forecast: observed annual unique increments with diminishing marginal growth',cumulativeUsers:actual.cumulativeUsers+Math.round(viewerDaily*horizon.remainingDays),
 donorCount:actual.donorCount+Math.round(donorPace.daily*effectiveDonorDays),balloonCount:actual.balloonCount+Math.round(balloonPace.daily*horizon.remainingDays)};
 return {actual,baseline:base,projected,donorPace,balloonPace,donorForecastEstimated:true,
 gains:Object.fromEntries(valueKeys.map(k=>[k,actual[k]-base[k]]))};
 });
 return {horizon,rows:[...rows,...fixedSupportCandidates(snapshot,horizon,now)]};
}
export function dynamicTargets(snapshot,now=new Date(),options={}){
 const config={...SIMULATION_CONFIG,...options};
 const reserved=top70Reservations(snapshot,config.cutoffRank),reservedCount=reserved.length;
 if(reserved.some(r=>r.soopId===config.targetId))throw new Error('목표 후보는 순위 예약으로 계산할 수 없습니다.');
 const scoreConfig={...config,cutoffRank:config.cutoffRank-reservedCount};
 const {horizon,rows}=(options.projector||projectCandidates)(snapshot,now);
 const target=rows.find(r=>r.actual.soopId===config.targetId);
 if(!target||rows.length<config.cutoffRank)throw new Error('TOP 70 계산에 필요한 후보 부족');
 const finalRows=rows.map(r=>r.projected),actualRows=rows.map(r=>r.actual);
 const calculateModel=model=>{
 // Support is normalized from THIS projected dataset, once per threshold search.
 const support=fixedSupportScores(finalRows,model);
 const context={baselineRows:finalRows,forecastRows:finalRows,target:target.actual,config:scoreConfig,model,fixedSupport:support};
 const predicted=calculateForecastRanking(finalRows,finalRows,model,support).find(r=>r.soopId===config.targetId);
 const current=calculateRanking(actualRows,model).find(r=>r.soopId===config.targetId);
 const remaining=horizon.ended?null:minimumAdditional(context);
 const boundary=remaining===null?null:{at:rankForAdditional(context,remaining).target.predictedRank+reservedCount,before:remaining>0?rankForAdditional(context,remaining-1).target.predictedRank+reservedCount:null};
 if(boundary&&(boundary.at>config.cutoffRank||(boundary.before!==null&&boundary.before<=config.cutoffRank)))throw new Error('최소 목표 경계 검증 실패');
 const predictedRankRange=rankBounds(predicted.predictedRank,reservedCount,config.cutoffRank),currentRankRange=rankBounds(current.predictedRank,reservedCount,config.cutoffRank);
 return {model,predictedRank:predictedRankRange.max,currentRank:currentRankRange.max,predictedRankRange,currentRankRange,remaining,requiredFinal:remaining===null?null:target.actual.cumulativeUsers+remaining,
 daily:remaining===null||!horizon.remainingDays?null:Math.ceil(remaining/horizon.remainingDays),boundary,supportScores:predicted.breakdown.filter(b=>b.key!=='cumulativeUsers')};
 };
 const models=TARGET_MODEL_POLICY.safe.map(calculateModel);
 const experimentalModels=TARGET_MODEL_POLICY.experimental.map(model=>({...calculateModel(model),experimental:true}));
 const safe=models.some(m=>m.remaining===null)?null:Math.max(...models.map(m=>m.remaining));
 const safeModel=models.find(m=>m.remaining===safe)||models[0];
 const october=safe===null||!horizon.remainingDays?null:Math.floor(safe*horizon.months[0].days/horizon.remainingDays);
 return {mode:'dynamic-support',horizon,models,experimentalModels,safe,safeModel:safeModel.model,predictedRank:safeModel.predictedRank,
 currentUsers:target.actual.cumulativeUsers,actualGain:target.gains.cumulativeUsers,daily:safe===null||!horizon.remainingDays?null:Math.ceil(safe/horizon.remainingDays),
 october,november:october===null?null:safe-october,updatedAt:snapshot.updatedAt,pendingCount:snapshot.streamers.length-rows.length-reservedCount,
 reservedCount,reserved,fixedSupport:rows.filter(row=>row.actual.supportFixed).map(row=>row.actual),fixedSupportCount:rows.filter(row=>row.actual.supportFixed).length,
 scoreCutoffRank:scoreConfig.cutoffRank,predictedRankRange:safeModel.predictedRankRange,
 target,projectedRows:finalRows,donorEstimated:false,donorForecastEstimated:true};
}
export function compareModes(snapshot,now=new Date()){
 const fixed=liveTargets(snapshot,now),dynamic=dynamicTargets(snapshot,now);
 return {fixed,dynamic,difference:fixed.safe===null||dynamic.safe===null?null:dynamic.safe-fixed.safe};
}
