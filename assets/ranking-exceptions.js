/** Explicit user assumptions never replace private observed metrics. */
export function top70Reservations(snapshot,cutoffRank=70){
 const entries=snapshot.rankingExceptions?.reservedTop70||[];
 const fixedIds=new Set(fixedEntries(snapshot).map(entry=>entry.soopId));
 if(!Array.isArray(entries))throw new Error('순위 예외 설정이 올바르지 않습니다.');
 const ids=new Set();
 const reserved=entries.flatMap(entry=>{
  if(!entry.soopId||ids.has(entry.soopId)||entry.basis!=='user_assumption')throw new Error('중복 또는 근거 없는 순위 예외');
  ids.add(entry.soopId);
  const row=snapshot.streamers.find(r=>r.soopId===entry.soopId);
  if(!row)throw new Error('순위 예외 후보가 없습니다.');
  // Once complete public metrics exist, score the candidate normally rather than twice.
  return row.status==='unavailable'&&!fixedIds.has(row.soopId)?[{...row,rankingException:entry}]:[];
 });
 if(reserved.length>=cutoffRank)throw new Error('TOP70 예약 인원이 너무 많습니다.');
 return reserved;
}

function fixedEntries(snapshot){
 const entries=snapshot.rankingExceptions?.fixedSupport||[],ids=new Set();
 if(!Array.isArray(entries))throw new Error('고정 후원 가정이 올바르지 않습니다.');
 for(const entry of entries){
  if(!entry.soopId||ids.has(entry.soopId)||entry.basis!=='user_assumption'||
   !Number.isSafeInteger(entry.donorCount)||entry.donorCount<0||!Number.isSafeInteger(entry.balloonCount)||entry.balloonCount<0)throw new Error('고정 후원 가정의 근거 또는 수치 오류');
  ids.add(entry.soopId);
  if(!snapshot.streamers.some(row=>row.soopId===entry.soopId))throw new Error('고정 후원 후보가 없습니다.');
  if(entry.monthlyBalloonCounts&&entry.monthlyBalloonCounts.reduce((sum,value)=>sum+value,0)!==entry.balloonCount)throw new Error('월별 별풍선 합계가 고정값과 다릅니다.');
 }
 return entries;
}

/** Scenario-only rows: source nulls and the immutable observation baseline stay intact. */
export function fixedSupportCandidates(snapshot,horizon,now=new Date()){
 return fixedEntries(snapshot).flatMap(entry=>{
  const raw=snapshot.streamers.find(row=>row.soopId===entry.soopId);
  if(raw.status!=='unavailable')return [];
  const baseline=snapshot.simulationBaseline.rows.find(row=>row.soopId===entry.soopId);
  const reference=snapshot.forecast.rows.find(row=>row.soopId===entry.soopId);
  if(!baseline||!Number.isSafeInteger(reference?.recentMonthlyUsers)||reference.recentMonthlyUsers<0)throw new Error('고정 후원 후보의 기존 유저 추세가 없습니다.');
  const daily=reference.recentMonthlyUsers/30;
  const observed=raw.metricObservedAt?.cumulativeUsers||snapshot.updatedAt;
  const observedDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date(observed));
  const actual={...raw,status:'assumed_support',donorCount:entry.donorCount,balloonCount:entry.balloonCount,
   donorEstimated:true,donorSource:'user-fixed assumption; saved annual response reference',supportFixed:true,fixedSupportAssumption:entry};
  const users=raw.cumulativeUsers+Math.round(daily*horizon.remainingDays);
  const fixedMetric={method:'user_fixed_support_assumption',forecastRemaining:0,forecastDailyPace:0,actualWeight:0,observedDate:null};
  const forecast={method:'fixed_support_september_viewer_fallback',observedDate,remainingDays:horizon.remainingDays,metrics:{
   cumulativeUsers:{method:'existing_september_monthly_fallback',observedDate,forecastDailyPace:daily,forecastRemaining:users-raw.cumulativeUsers,
    actualWeight:0,baseMonths:[reference.referenceMonth||'2026-09'],baseWeights:[1],fallbackReason:'No complete rolling input for private-support candidate; preserved existing September monthly viewer trend'},
   donorCount:{...fixedMetric},balloonCount:{...fixedMetric}}};
  const projected={...actual,cumulativeUsers:users,valueKind:horizon.ended?'final_observation':'forecast',forecast};
  return [{actual,baseline,projected,forecast,donorPace:{daily:0,source:'user-fixed assumption'},balloonPace:{daily:0,source:'user-fixed assumption'},
   donorForecastEstimated:true,gains:{cumulativeUsers:raw.cumulativeUsers-baseline.cumulativeUsers,donorCount:null,balloonCount:null}}];
 });
}

/** Unknown positions inside TOP70 produce ranges; outsiders shift by the full count. */
export function rankBounds(scoredRank,reservedCount,cutoffRank=70){
 const max=scoredRank+reservedCount;
 return {min:scoredRank<=cutoffRank-reservedCount?scoredRank:max,max};
}

export function includeReservations(ranked,reservedCount,cutoffRank=70){
 if(!reservedCount)return ranked;
 return ranked.map(row=>{
  const rankRange=rankBounds(row.predictedRank,reservedCount,cutoffRank);
  return {...row,scoredRank:row.predictedRank,predictedRank:rankRange.max,rankRange};
 });
}

export function reservationBoundary(ranked,cutoffRank=70){
 if(ranked.length<cutoffRank)return null;
 const cutoff=ranked[cutoffRank-1],next=ranked[cutoffRank]||null;
 return {cutoff,next,gap:next?cutoff.score-next.score:null};
}

export function rankLabel(range,fallback){
 return range&&range.min!==range.max?`${range.min}~${range.max}`:String(range?.max??fallback);
}
