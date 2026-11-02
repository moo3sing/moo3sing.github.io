import {calculateRanking} from './ranking.js';

const DAY=86400000;
export const MODEL_NAMES={rank:'순위형',ratio:'1위 대비',minmax:'Min-Max'};
export function median(values){
 const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b),n=sorted.length;
 return n?(n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2):null;
}
/** The live point uses the saved observation-time forecast, never today's calendar on old data. */
export function currentObservation(snapshot){
 const report=snapshot.targetResults?.dynamic,batch=snapshot.manualBatchOverride;
 if(!report||report.updatedAt!==snapshot.updatedAt)return null;
 if(snapshot.collectionMode==='manual_partial'&&(batch?.updatedCandidates!==snapshot.streamers.length||batch?.retainedCandidates!==0||
  snapshot.streamers.some(row=>row.metricObservedAt?.cumulativeUsers!==snapshot.updatedAt)))return null;
 const target=snapshot.streamers.find(row=>row.soopId==='singgyul');
 if(!target||!snapshot.trendHistory?.comparisonKey)return null;
 return {observedAt:snapshot.updatedAt,precision:batch?.sourceObservation?.precision||'minute',
  comparisonKey:snapshot.trendHistory.comparisonKey,viewerAdjustment:snapshot.manualOverride?.adjustment??target.viewerAdjustmentTotal??0,
  rawUsers:snapshot.manualOverride?.rawViewer??target.rawMetrics?.viewer??target.cumulativeUsers,
  models:Object.fromEntries(report.models.map(row=>[row.model,row])),rows:snapshot.streamers,projectedRows:report.projectedRows};
}
export function observations(snapshot){
 const current=currentObservation(snapshot),key=snapshot.trendHistory?.comparisonKey;
 const points=[...(snapshot.trendHistory?.points||[]),...(current?[current]:[])];
 const ordered=[...new Map(points.filter(p=>p.comparisonKey===key&&Number.isFinite(Date.parse(p.observedAt)))
  .map(p=>[p.observedAt,p])).values()].sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
 const adjustment=ordered.at(-1)?.viewerAdjustment;
 let start=ordered.length-1;
 while(start>0&&ordered[start-1].viewerAdjustment===adjustment)start--;
 return ordered.slice(Math.max(0,start));
}
export function intervalRate(previous,current,ids){
 // Unknown source times, changed corrections and decreases cannot be presented as measured daily growth.
 if(previous.precision!=='minute'||current.precision!=='minute'||previous.viewerAdjustment!==current.viewerAdjustment)return null;
 const days=(Date.parse(current.observedAt)-Date.parse(previous.observedAt))/DAY;
 if(days<=0)return null;
 const old=new Map(previous.rows.map(row=>[row.soopId,row.cumulativeUsers]));
 const next=new Map(current.rows.map(row=>[row.soopId,row.cumulativeUsers]));
 const gains=ids.map(id=>old.has(id)&&next.has(id)?next.get(id)-old.get(id):null);
 if(gains.some(n=>n===null||n<0))return null;
 return {days,daily:median(gains.map(n=>n/days))};
}
export function trendView(snapshot,model='minmax',rivalId='median'){
 if(!MODEL_NAMES[model])throw new Error('Unknown chart model');
 const points=observations(snapshot);
 if(points.length<2)return null;
 const first=points[0],last=points.at(-1);
 // Fix today's boundary cohort across the whole graph; no changing-membership average.
 const rivals=calculateRanking(last.projectedRows,model).filter(row=>row.soopId!=='singgyul'&&row.predictedRank>=65&&row.predictedRank<=75)
  .map(row=>({soopId:row.soopId,name:row.name,rank:row.predictedRank}));
 const ids=rivalId==='median'?rivals.map(row=>row.soopId):rivals.filter(row=>row.soopId===rivalId).map(row=>row.soopId);
 if(!ids.length)return null;
 const base=new Map(first.rows.map(row=>[row.soopId,row.cumulativeUsers]));
 const targetBase=base.get('singgyul');
 const series=points.map((point,index)=>{
  const rows=new Map(point.rows.map(row=>[row.soopId,row.cumulativeUsers]));
  const totals=ids.map(id=>rows.get(id));
  const gains=ids.map(id=>rows.has(id)&&base.has(id)?rows.get(id)-base.get(id):null);
  const previous=points[index-1];
  const targetRate=previous?intervalRate(previous,point,['singgyul']):null;
  const rivalRate=previous?intervalRate(previous,point,ids):null;
  return {time:Date.parse(point.observedAt),observedAt:point.observedAt,precision:point.precision,
   targetUsers:rows.get('singgyul'),targetGain:rows.get('singgyul')-targetBase,
   rivalUsers:totals.every(Number.isFinite)?median(totals):null,
   rivalGain:gains.every(Number.isFinite)?median(gains):null,
   targetDaily:targetRate?.daily??null,rivalDaily:rivalRate?.daily??null,spanDays:targetRate?.days??null,
   intervalStart:previous?.observedAt??null,forecastRank:point.models[model].predictedRank,currentRank:point.models[model].currentRank};
 });
 const recent=series.filter(p=>p.targetDaily!==null&&p.rivalDaily!==null).slice(-2);
 return {model,rivals,selectedRival:rivals.find(row=>row.soopId===rivalId)||null,first,last,series,recent,
  unknownTimes:points.filter(p=>p.precision!=='minute').length};
}
