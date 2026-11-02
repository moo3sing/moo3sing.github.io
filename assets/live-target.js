import {fixedSupportScores, calculateForecastRanking, minimumAdditional, rankForAdditional} from './simulation.js';
import {SIMULATION_CONFIG} from './simulation-config.js';
import {top70Reservations,rankBounds,fixedSupportCandidates} from './ranking-exceptions.js?v=20261019-fixed';
const DAY=86400000, START=Date.parse('2026-10-01T00:00:00+09:00'), NOV=Date.parse('2026-11-01T00:00:00+09:00'), END=Date.parse('2026-12-01T00:00:00+09:00');
export function calendarHorizon(now=new Date()) {
 const time=new Date(now).getTime();
 if(!Number.isFinite(time))throw new Error('날짜가 올바르지 않습니다.');
 const day=Math.floor((time+9*3600000)/DAY)*DAY-9*3600000;
 // Today's observed actual is used as-is. Forecast starts tomorrow; Nov 30 is included.
 const begin=Math.max(START,day+DAY);
 const months=[{month:'2026-10',days:Math.max(0,(NOV-Math.min(NOV,begin))/DAY)},
 {month:'2026-11',days:Math.max(0,(END-Math.max(NOV,begin))/DAY)}];
 return {remainingDays:months.reduce((s,m)=>s+m.days,0),months,ended:time>=END};
}
export function liveTargets(snapshot,now=new Date(),options={}) {
 const horizon=calendarHorizon(now),config={...SIMULATION_CONFIG,...options};
 const reserved=top70Reservations(snapshot,config.cutoffRank),reservedCount=reserved.length;
 const scoreConfig={...config,cutoffRank:config.cutoffRank-reservedCount};
 const baseline=snapshot.simulationBaseline;
 if(baseline?.status!=='locked')throw new Error('9월 30일 고정 기준을 확인하고 있습니다.');
 if(snapshot.forecast?.status!=='ok'||snapshot.forecast.referenceMonth!=='2026-09')throw new Error('9월 기준 추세 데이터가 필요합니다.');
 const fixed=fixedSupportCandidates(snapshot,horizon,now);
 const baselineRows=[...baseline.rows.filter(r=>r.status!=='unavailable'),...fixed.map(row=>({...row.actual,cumulativeUsers:row.baseline.cumulativeUsers}))];
 const live=new Map(snapshot.streamers.map(r=>[r.soopId,r]));
 const rates=new Map(snapshot.forecast.rows.map(r=>[r.soopId,r.recentMonthlyUsers]));
 const actualRows=baselineRows.map(r=>{
 const value=live.get(r.soopId)?.cumulativeUsers,pace=rates.get(r.soopId);
 if(!Number.isSafeInteger(value)||value<0||!Number.isSafeInteger(pace)||pace<0)throw new Error('전체 후보의 실제 누적 유저 또는 기준 추세가 누락되었습니다.');
 return {...r,cumulativeUsers:value};
 });
 const target=actualRows.find(r=>r.soopId===config.targetId),sepTarget=baselineRows.find(r=>r.soopId===config.targetId);
 if(!target||baselineRows.length<config.cutoffRank)throw new Error('TOP 70 계산에 필요한 후보가 부족합니다.');
 const forecastRows=actualRows.map(r=>({...r,cumulativeUsers:r.cumulativeUsers+Math.round(rates.get(r.soopId)/30*horizon.remainingDays)}));
 const models=['rank','ratio','minmax'].map(model=>{
 const fixedSupport=fixedSupportScores(baselineRows,model);
 const context={baselineRows,forecastRows,target,config:scoreConfig,model,fixedSupport};
 const predicted=calculateForecastRanking(baselineRows,forecastRows,model,fixedSupport).find(r=>r.soopId===config.targetId);
 const current=calculateForecastRanking(baselineRows,actualRows,model,fixedSupport).find(r=>r.soopId===config.targetId);
 const predictedRankRange=rankBounds(horizon.ended?current.predictedRank:predicted.predictedRank,reservedCount,config.cutoffRank),currentRankRange=rankBounds(current.predictedRank,reservedCount,config.cutoffRank);
 if(horizon.ended)return {model,predictedRank:currentRankRange.max,currentRank:currentRankRange.max,predictedRankRange:currentRankRange,currentRankRange,remaining:null,daily:null,requiredFinal:null,boundary:null};
 const remaining=minimumAdditional(context);
 const boundary=remaining===null?null:{at:rankForAdditional(context,remaining).target.predictedRank+reservedCount,before:remaining>0?rankForAdditional(context,remaining-1).target.predictedRank+reservedCount:null};
 if(boundary&&(boundary.at>config.cutoffRank||(boundary.before!==null&&boundary.before<=config.cutoffRank)))throw new Error('최소 목표 경계 검증 실패');
 return {model,predictedRank:predictedRankRange.max,currentRank:currentRankRange.max,predictedRankRange,currentRankRange,remaining,
 daily:remaining===null||!horizon.remainingDays?null:Math.ceil(remaining/horizon.remainingDays),requiredFinal:remaining===null?null:target.cumulativeUsers+remaining,boundary};
 });
 const safe=horizon.ended||models.some(m=>m.remaining===null)?null:Math.max(...models.map(m=>m.remaining));
 const safeModel=models.find(m=>m.remaining===safe)||models[0];
 const october=safe===null||!horizon.remainingDays?null:Math.floor(safe*horizon.months[0].days/horizon.remainingDays);
 return {horizon,models,safe,safeModel:safeModel.model,predictedRank:safeModel.predictedRank,currentUsers:target.cumulativeUsers,
 actualGain:target.cumulativeUsers-sepTarget.cumulativeUsers,daily:safe===null||!horizon.remainingDays?null:Math.ceil(safe/horizon.remainingDays),
 october,november:october===null?null:safe-october,updatedAt:snapshot.updatedAt,pendingCount:baseline.rows.length-baselineRows.length-reservedCount,
 reservedCount,reserved,fixedSupport:fixed.map(row=>row.actual),fixedSupportCount:fixed.length,
 scoreCutoffRank:scoreConfig.cutoffRank,predictedRankRange:safeModel.predictedRankRange};
}
