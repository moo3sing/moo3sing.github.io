import {METRICS,metricScore} from './ranking.js';
import {SIMULATION_CONFIG} from './simulation-config.js';

const DAY = 86400000;
const START = Date.parse('2026-10-01T00:00:00+09:00');
const NOVEMBER = Date.parse('2026-11-01T00:00:00+09:00');
const END = Date.parse('2026-12-01T00:00:00+09:00');

/** Snapshot-time calendar-month fractions; no September days counted twice. */
export function remainingHorizon(timestamp) {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) throw new Error('스냅샷 시각을 확인할 수 없습니다.');
  const begin = Math.max(time, START);
  const months = [
    {month:'2026-10', start:START, end:NOVEMBER},
    {month:'2026-11', start:NOVEMBER, end:END},
  ].map(m=>({...m, fraction:Math.max(0,m.end-Math.max(begin,m.start))/(m.end-m.start)}));
  return {months, remainingMonths:months.reduce((sum,m)=>sum+m.fraction,0),
    remainingDays:Math.max(0,END-begin)/DAY, end:'2026-11-30', excludesSeptember:time<START};
}

/** Calculate donor/balloon ranks and scores once from the Sep 30 baseline. */
export function fixedSupportScores(streamers, model) {
  const supportMetrics=METRICS.filter(metric=>metric.key!=='cumulativeUsers');
  const columns=Object.fromEntries(supportMetrics.map(metric=>[metric.key,streamers.map(row=>row[metric.key])]));
  return new Map(streamers.map(row=>[row.soopId,Object.fromEntries(supportMetrics.flatMap(metric=>{
    const values=columns[metric.key],value=row[metric.key];
    const equal=values.filter(item=>item===value).length;
    const rank=values.filter(item=>item>value).length+(equal+1)/2;
    const score=metricScore(values,value,model);
    return [[metric.rankKey,rank],[`${metric.key}Score`,score]];
  }))]));
}

/** Recalculate only the viewer component; every support component is baseline-fixed. */
export function calculateForecastRanking(baselineRows,viewerRows,model,fixedSupport=fixedSupportScores(baselineRows,model)) {
  const viewerMetric=METRICS.find(metric=>metric.key==='cumulativeUsers');
  const viewers=viewerRows.map(row=>row.cumulativeUsers);
  const baselineById=new Map(baselineRows.map(row=>[row.soopId,row]));
  const ranked=viewerRows.map(row=>{
    const baseline=baselineById.get(row.soopId),support=fixedSupport.get(row.soopId);
    if(!baseline||!support)throw new Error('9월 말 기준 데이터가 일치하지 않습니다.');
    const equal=viewers.filter(value=>value===row.cumulativeUsers).length;
    const viewerRank=viewers.filter(value=>value>row.cumulativeUsers).length+(equal+1)/2;
    const viewerScore=metricScore(viewers,row.cumulativeUsers,model);
    const donorScore=support.donorCountScore,balloonScore=support.balloonCountScore;
    const breakdown=[
      {...viewerMetric,value:row.cumulativeUsers,rank:viewerRank,score:viewerScore,weighted:viewerScore*.8,fixed:false},
      {...METRICS[1],value:baseline.donorCount,rank:support.donorRank,score:donorScore,weighted:donorScore*.1,fixed:true},
      {...METRICS[2],value:baseline.balloonCount,rank:support.balloonRank,score:balloonScore,weighted:balloonScore*.1,fixed:true},
    ];
    return {...baseline,cumulativeUsers:row.cumulativeUsers,viewerRank,donorRank:support.donorRank,
      balloonRank:support.balloonRank,score:breakdown.reduce((sum,item)=>sum+item.weighted,0),breakdown,
      fixedSupportScore:donorScore*.1+balloonScore*.1};
  }).sort((a,b)=>b.score-a.score||b.cumulativeUsers-a.cumulativeUsers||a.soopId.localeCompare(b.soopId,'en'));
  return ranked.map((row,index)=>({...row,predictedRank:index+1}));
}

export function rankForAdditional(context, additionalUsers) {
  if(!Number.isSafeInteger(additionalUsers)||additionalUsers<0) throw new Error('추가 누적 유저는 0 이상의 안전한 정수여야 합니다.');
  const rows=context.forecastRows.map(row=>row.soopId===context.config.targetId
    ? {...row,cumulativeUsers:context.target.cumulativeUsers+additionalUsers} : row);
  const ranked=calculateForecastRanking(context.baselineRows,rows,context.model,context.fixedSupport);
  return {ranked,target:ranked.find(row=>row.soopId===context.config.targetId),cutoff:ranked[context.config.cutoffRank-1]};
}

/** Find the smallest integer additional-user value; check exact tie-break behavior. */
export function minimumAdditional(context) {
  const qualifies=n=>rankForAdditional(context,n).target.predictedRank<=context.config.cutoffRank;
  if(qualifies(0))return 0;
  let low=0,high=1;
  while(high<context.config.maxAdditionalUsers&&!qualifies(high)) high=Math.min(high*2,context.config.maxAdditionalUsers);
  if(!qualifies(high))return null;
  while(high-low>1){const mid=Math.floor((low+high)/2);if(qualifies(mid))high=mid;else low=mid;}
  return high;
}

export function allocateByMonth(total, months) {
  const sum=months.reduce((s,m)=>s+m.fraction,0);
  if(!sum)return months.map(m=>({month:m.month,additionalUsers:0,fraction:0}));
  let assigned=0;
  const active=months.filter(m=>m.fraction>0),last=active[active.length-1].month;
  return months.map(m=>{
    const value=m.month===last?total-assigned:Math.floor(total*m.fraction/sum);
    assigned+=value;
    return {month:m.month,additionalUsers:value,fraction:m.fraction};
  });
}

export function createSimulation(snapshot,model='ratio',options={}) {
  const config={...SIMULATION_CONFIG,...options};
  const baselineSnapshot=snapshot.simulationBaseline||{status:'legacy',asOf:'2026-09-30',cutoffAt:'2026-10-01T00:00:00+09:00',rows:snapshot.streamers};
  const valid=(baselineSnapshot.rows||[]).filter(r=>r.status!=='unavailable');
  const fixedSupport=fixedSupportScores(valid,model);
  const current=calculateForecastRanking(valid,valid,model,fixedSupport);
  const target=current.find(r=>r.soopId===config.targetId),cutoff=current[config.cutoffRank-1];
  const base={model,config,current,target,cutoff,baselineSnapshot,baselineRows:valid,fixedSupport,
    pendingCount:(baselineSnapshot.rows||[]).length-valid.length};
  if(!target||!cutoff)return {...base,status:/** @type {'unavailable'} */('unavailable'),reason:'띵귤 또는 TOP 70 계산에 필요한 공개 데이터가 없습니다.'};
  const horizon=remainingHorizon(baselineSnapshot.cutoffAt||'2026-10-01T00:00:00+09:00');
  if(Date.parse(snapshot.updatedAt)>=END)return {...base,horizon,status:/** @type {'ended'} */('ended'),reason:'심사 기간이 끝났습니다. 남은 기간 목표를 새로 산출하지 않습니다.'};
  if(snapshot.forecast?.status!=='ok')return {...base,horizon,status:/** @type {'unavailable'} */('unavailable'),reason:'최근 월간 데이터가 아직 준비되지 않았습니다. 현재 랭킹은 전체 예상 랭킹에서 확인할 수 있습니다.'};
  const rates=new Map(snapshot.forecast.rows.map(r=>[r.soopId,r.recentMonthlyUsers]));
  const missing=valid.filter(r=>!Number.isSafeInteger(rates.get(r.soopId))||rates.get(r.soopId)<0);
  if(missing.length)return {...base,horizon,status:/** @type {'unavailable'} */('unavailable'),reason:`월간 통계 ${missing.length}명이 누락되어 목표를 계산하지 않았습니다. 누락을 0으로 대체하지 않습니다.`};
  const forecastRows=valid.map(row=>({...row,cumulativeUsers:row.soopId===config.targetId?row.cumulativeUsers:
    row.cumulativeUsers+Math.round(rates.get(row.soopId)*horizon.remainingMonths)}));
  const context={...base,horizon,forecastRows};
  const pace=rates.get(config.targetId);
  const baselineAdditional=Math.round(pace*horizon.remainingMonths);
  const minimum=minimumAdditional(context);
  const baseline=rankForAdditional(context,baselineAdditional);
  const required=minimum===null?null:rankForAdditional(context,minimum);
  const scenarios=config.growthMultipliers.map(multiplier=>{
    const additionalUsers=Math.round(pace*multiplier*horizon.remainingMonths);
    return {key:String(multiplier),label:multiplier===1?'현 추세 유지':`띵귤 +${Math.round((multiplier-1)*100)}%`,
      multiplier,additionalUsers,...rankForAdditional(context,additionalUsers)};
  });
  if(required)scenarios.push({key:'minimum',multiplier:pace?minimum/horizon.remainingMonths/pace:0,label:'진입 최소 목표',additionalUsers:minimum,...required});
  const plotMax=Math.max(1,Math.ceil(Math.max(minimum??0,baselineAdditional*1.3)*1.25));
  const chart=Array.from({length:25},(_,i)=>{
    const additionalUsers=Math.round(plotMax*i/24),result=rankForAdditional(context,additionalUsers);
    return {additionalUsers,rank:result.target.predictedRank,score:result.target.score};
  });
  const competition=current.filter(row=>row.soopId!==config.targetId&&row.predictedRank>=config.competitionFrom&&row.predictedRank<=config.competitionTo)
    .map((row,i)=>({...row,anonymousName:`경쟁자 ${String(i+1).padStart(2,'0')}`,monthlyUsers:rates.get(row.soopId),
      forecast:baseline.ranked.find(r=>r.soopId===row.soopId)}));
  return {...context,status:/** @type {'ok'} */('ok'),pace,baselineAdditional,baseline,minimum,required,scenarios,chart,competition,
    monthlyNeeded:minimum===null?null:minimum/horizon.remainingMonths,
    growthNeeded:minimum===null||pace===0?null:(minimum/horizon.remainingMonths/pace-1)*100,
    shortfall:minimum===null?null:Math.max(0,minimum-baselineAdditional),
    allocations:minimum===null?[]:allocateByMonth(minimum,horizon.months),
    finalUsers:minimum===null?null:target.cumulativeUsers+minimum,
    currentScoreGap:target.score-cutoff.score,currentUserGap:target.cumulativeUsers-cutoff.cumulativeUsers};
}
