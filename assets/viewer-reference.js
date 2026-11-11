import {SIMULATION_CONFIG} from './simulation-config.js';

/** Display-only viewer 100% reference; never feeds a scoring model or SafeTarget. */
export function viewerOnlyReference(snapshot, report, options={}) {
 const {targetId,cutoffRank}={...SIMULATION_CONFIG,...options};
 if(!Number.isSafeInteger(cutoffRank)||cutoffRank<1)throw new Error('Invalid viewer cutoff');
 const projected=new Map(report.projectedRows.map(row=>[row.soopId,row.cumulativeUsers]));
 const rates=new Map((snapshot.forecast?.rows||[]).map(row=>[row.soopId,row.recentMonthlyUsers]));
 const seen=new Set();
 const rows=snapshot.streamers.map(row=>{
  if(!row.soopId||seen.has(row.soopId)||!Number.isSafeInteger(row.cumulativeUsers)||row.cumulativeUsers<0)throw new Error('Incomplete viewer cohort');
  seen.add(row.soopId);
  let finalUsers=projected.get(row.soopId);
  if(finalUsers===undefined){
   // Private-support candidates still have viewer data. Preserve the existing September fallback.
   const monthly=rates.get(row.soopId);
   if(report.horizon.remainingDays&&!Number.isSafeInteger(monthly))throw new Error('Missing viewer trend');
   if(monthly<0)throw new Error('Invalid viewer trend');
   finalUsers=row.cumulativeUsers+(report.horizon.remainingDays?Math.round(monthly/30*report.horizon.remainingDays):0);
  }
  if(!Number.isSafeInteger(finalUsers)||finalUsers<row.cumulativeUsers)throw new Error('Invalid viewer projection');
  return {soopId:row.soopId,actualUsers:row.cumulativeUsers,finalUsers};
 });
 const target=rows.find(row=>row.soopId===targetId);
 if(!target||rows.length<cutoffRank)throw new Error('Insufficient viewer candidates');
 // Use the same ID tie-break as the existing ranking; all viewer-known candidates count.
 const compare=(a,b)=>b.finalUsers-a.finalUsers||a.soopId.localeCompare(b.soopId,'en');
 const rivals=rows.filter(row=>row.soopId!==targetId).sort(compare);
 const boundary=rivals[cutoffRank-1];
 const threshold=boundary?boundary.finalUsers+(targetId.localeCompare(boundary.soopId,'en')>0?1:0):0;
 if(!Number.isSafeInteger(threshold))throw new Error('Viewer threshold out of range');
 const requiredFinal=Math.max(target.actualUsers,threshold);
 return {remaining:report.horizon.ended?null:requiredFinal-target.actualUsers,
  requiredFinal:report.horizon.ended?null:requiredFinal,
  predictedRank:[...rows].sort(compare).findIndex(row=>row.soopId===targetId)+1,
  candidateCount:rows.length,cutoffRank};
}
