import {calculateRanking} from './ranking.js';
import {calendarHorizon} from './live-target.js?v=20261113-time';
import {projectRollingCandidates} from './rolling-target.js?v=20261113-time';
import {top70Reservations,includeReservations,fixedSupportCandidates} from './ranking-exceptions.js?v=20261019-fixed';

// Use the same candidate projection as the main simulation, without running its target solver.
export function rankingView(snapshot, model='rank', basis='forecast', now=new Date()) {
  if(!['forecast','actual'].includes(basis))throw new Error('알 수 없는 집계 기준');
  const horizon=calendarHorizon(now);
  const reserved=top70Reservations(snapshot),fixed=fixedSupportCandidates(snapshot,horizon,now);
  const ids=new Set([...reserved.map(row=>row.soopId),...fixed.map(row=>row.actual.soopId)]);
  const pending=snapshot.streamers.filter(row=>row.status==='unavailable'&&!ids.has(row.soopId));
  const rows=basis==='forecast'?projectRollingCandidates(snapshot,now).rows.map(row=>row.projected):
    [...snapshot.streamers.filter(row=>row.status!=='unavailable'),...fixed.map(row=>row.actual)];
  return {ranked:includeReservations(calculateRanking(rows,model),reserved.length),pending,reserved,fixedSupport:fixed.map(row=>row.actual),
    scoreCutoffRank:70-reserved.length,horizon,forecast:basis==='forecast'&&!horizon.ended};
}

export function metricObservation(snapshot,row,key) {
  const manual=snapshot.collectionMode==='manual_partial';
  const fallback=manual&&row.soopId==='singgyul'?snapshot.manualOverride?.observedAt:
    manual?snapshot.competitorDataAsOf:snapshot.actualObservedAt||snapshot.updatedAt;
  const dates=manual&&row.soopId==='singgyul'&&
    Date.parse(fallback)>Date.parse(row.metricObservedAt?.cumulativeUsers||fallback)?null:row.metricObservedAt;
  return dates?.[key]||fallback;
}

export function latestObservation(snapshot) {
  const dates=[snapshot.updatedAt,snapshot.manualBatchOverride?.observedAt,snapshot.manualOverride?.observedAt];
  return dates.filter(value=>Number.isFinite(Date.parse(value)))
    .sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
}
