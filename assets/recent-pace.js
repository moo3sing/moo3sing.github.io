const DAY=86400000, WINDOW=7*DAY;
export const usesRecentSevenDays=snapshot=>snapshot.recentTrend?.method==='trailing_7d_average';

/** Time-weighted observed increments in the last seven days, per metric observation time. */
export function recentSevenDayPace(snapshot,row,key,fallback,observedAt){
 const end=Date.parse(observedAt),asOf=Date.parse(snapshot.recentTrend?.asOf||snapshot.updatedAt),cutoff=asOf-WINDOW;
 const fail=reason=>({...fallback,paceSource:'previous-trend-fallback',windowDays:7,observedDays:0,
  windowEnd:observedAt,boundaryEstimated:false,fallbackReason:reason});
 if(!Number.isFinite(end)||!Number.isFinite(asOf)||asOf-end>WINDOW||end>asOf)return fail('최근 7일 내 유효한 새 관측 없음');
 const precision=snapshot.manualBatchOverride?.sourceObservation?.precision||snapshot.manualOverride?.sourceObservation?.precision;
 if(snapshot.collectionMode!=='automatic'&&precision==='day'&&end===asOf)return fail('원본 집계 시각 미제공');
 const points=new Map();
 for(const point of snapshot.recentTrend?.observations||[]){
  const item=point.rows.find(value=>value.soopId===row.soopId);
  const time=Date.parse(item?.metricObservedAt?.[key]),value=item?.[key];
  if(Number.isFinite(time)&&time<=end&&time>=end-3*WINDOW&&Number.isSafeInteger(value)&&value>=0)points.set(time,{time,value});
 }
 const rawViewer=snapshot.collectionMode==='automatic'?row.rawMetrics?.viewer??row.cumulativeUsers:
  snapshot.manualOverride?.rawViewer??row.rawMetrics?.viewer??row.cumulativeUsers;
 const value=key==='cumulativeUsers'&&row.soopId==='singgyul'?rawViewer:row[key];
 if(!Number.isSafeInteger(value)||value<0)return fail('유효한 관측값 부족');
 points.set(end,{time:end,value});
 let ordered=[...points.values()].sort((a,b)=>a.time-b.time);
 // A source correction starts a new comparable segment; it is never organic growth.
 for(let i=ordered.length-1;i>0;i--)if(ordered[i].value<ordered[i-1].value){ordered=ordered.slice(i);break;}
 let gain=0,start=end,samples=1,boundaryEstimated=false;
 for(let i=ordered.length-1;i>0;i--){
  const current=ordered[i],previous=ordered[i-1],span=current.time-previous.time;
  if(span>WINDOW||current.time<=cutoff)break;
  const from=Math.max(previous.time,cutoff);
  gain+=(current.value-previous.value)*(current.time-from)/span;
  start=from;samples++;boundaryEstimated=from>previous.time;
  if(start===cutoff)break;
 }
 const days=(end-start)/DAY;
 if(days<1)return fail('비교 가능한 관측 기간이 1일 미만');
 const daily=gain/days,partial=days<7-1e-9;
 return {...fallback,forecastDailyPace:daily,actualDailyPace:daily,actualGain:gain,elapsedActualDays:days,
  actualWeight:1,baseWeight:0,period:'trailing_7d',novemberBasis:'Latest seven-day observation intervals',
  paceSource:partial?'recent-partial-average':'recent-7d-average',windowDays:7,observedDays:days,
  windowStart:new Date(start).toISOString(),windowEnd:observedAt,sampleCount:samples,boundaryEstimated,
  fallbackReason:partial?'7일 미만의 실제 관측 구간 평균 사용':null};
}
