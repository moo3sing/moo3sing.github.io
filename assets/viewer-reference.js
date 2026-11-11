import {SIMULATION_CONFIG} from './simulation-config.js';

/** Current viewer-only gap, with no forecast, support scores or solver adjustment. */
export function currentViewerGap(snapshot, options={}) {
 const {targetId,cutoffRank}={...SIMULATION_CONFIG,...options};
 if(!Number.isSafeInteger(cutoffRank)||cutoffRank<1)throw new Error('Invalid viewer cutoff');
 const seen=new Set();
 for(const row of snapshot.streamers){
  if(!row.soopId||seen.has(row.soopId)||!Number.isSafeInteger(row.cumulativeUsers)||row.cumulativeUsers<0)throw new Error('Incomplete viewer cohort');
  seen.add(row.soopId);
 }
 const ranked=[...snapshot.streamers].sort((a,b)=>b.cumulativeUsers-a.cumulativeUsers||a.soopId.localeCompare(b.soopId,'en'));
 const currentRank=ranked.findIndex(row=>row.soopId===targetId)+1;
 const cutoff=ranked[cutoffRank-1],target=ranked[currentRank-1];
 if(!target||!cutoff)throw new Error('Insufficient viewer candidates');
 return {gap:Math.max(0,cutoff.cumulativeUsers-target.cumulativeUsers),
  cutoffUsers:cutoff.cumulativeUsers,currentUsers:target.cumulativeUsers,
  currentRank,candidateCount:ranked.length,cutoffRank};
}
