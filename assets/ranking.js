import {LOG_MODEL, logMetricScore} from './log-model.js';
/**
 * @typedef {{rankByViewer:number,name:string,soopId:string,category?:string,
 * cumulativeUsers:number,balloonCount:number,donorCount:number}} StreamerStats
 */
export const MODELS = {
  rank: {label: '순위형', description: '항목별 평균 순위를 0–100점으로 환산합니다.'},
  percentile: {label: '백분위', description: '동점 중간값을 반영한 경험적 백분위입니다. 순위형과 같은 결과가 나옵니다.'},
  ratio: {label: '1위 대비', description: '각 지표의 1위 수치를 100점으로 두고 비율을 계산합니다.'},
  minmax: {label: 'Min-Max', description: '각 지표의 최솟값은 0점, 최댓값은 100점으로 환산합니다.'},
  log: LOG_MODEL,
};
export const METRICS = [
  {key:'cumulativeUsers', label:'누적 유저', weight:.8, rankKey:'viewerRank'},
  {key:'donorCount', label:'후원자', weight:.1, rankKey:'donorRank'},
  {key:'balloonCount', label:'별풍선', weight:.1, rankKey:'balloonRank'},
];

export function metricScore(values, value, model) {
  if (!Object.hasOwn(MODELS, model)) throw new Error('알 수 없는 계산 모델');
  const n = values.length;
  if (!n) return 0;
  const min = Math.min(...values), max = Math.max(...values);
  if (model === 'ratio') return max === 0 ? 0 : value / max * 100;
  if (model === 'minmax') return max === min ? 0 : (value-min)/(max-min)*100;
  if (model === 'log') return logMetricScore(values, value);
  if (n === 1) return 100;
  const lower = values.filter(v => v < value).length;
  const equal = values.filter(v => v === value).length;
  if (model === 'percentile') return 100 * (lower + (equal-1)/2) / (n-1);
  const rank = values.filter(v => v > value).length + (equal+1)/2;
  return 100 * (n-rank) / (n-1);
}

/** Pure function; missing metrics are never coerced to zero. */
export function calculateRanking(streamers, model = 'rank') {
  if (!Object.hasOwn(MODELS, model)) throw new Error('알 수 없는 계산 모델');
  const seen = new Set();
  for (const row of streamers) {
    if (!row.soopId || seen.has(row.soopId)) throw new Error('중복/누락 스트리머 ID');
    seen.add(row.soopId);
    if (METRICS.some(m => !Number.isFinite(row[m.key]) || row[m.key] < 0)) throw new Error('불완전한 통계');
  }
  const columns = Object.fromEntries(METRICS.map(m => [m.key, streamers.map(s => s[m.key])]));
  const ranked = streamers.map(row => {
    const result = {...row, score: 0, breakdown: []};
    for (const metric of METRICS) {
      const values = columns[metric.key], value = row[metric.key];
      const rank = values.filter(v => v > value).length + (values.filter(v => v === value).length + 1)/2;
      const score = metricScore(values, value, model), weighted = score * metric.weight;
      result[metric.rankKey] = rank;
      result.breakdown.push({...metric, value, rank, score, weighted});
      result.score += weighted;
    }
    return result;
  }).sort((a,b) => b.score-a.score || b.cumulativeUsers-a.cumulativeUsers || a.soopId.localeCompare(b.soopId,'en'));
  return ranked.map((row, i) => ({...row, predictedRank:i+1}));
}

export function getBoundary(ranked) {
  if (ranked.length < 70) return null;
  const cutoff = ranked[69], next = ranked[70] || null;
  return {cutoff, next, gap:next ? cutoff.score-next.score : null};
}
