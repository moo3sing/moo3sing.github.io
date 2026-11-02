import {readFileSync, writeFileSync} from 'node:fs';
import {MODELS,calculateRanking,getBoundary} from '../assets/ranking.js';
const snapshot=JSON.parse(readFileSync(new URL('../assets/data/ranking.json',import.meta.url),'utf8'));
const available=snapshot.streamers.filter(r=>r.status!=='unavailable');
const report={asOf:snapshot.asOf,updatedAt:snapshot.updatedAt,candidates:snapshot.streamers.length,scored:available.length,unavailable:snapshot.streamers.filter(r=>r.status==='unavailable').map(r=>({name:r.name,soopId:r.soopId})),models:{}};
for(const [key,model] of Object.entries(MODELS)){
  const ranked=calculateRanking(available,key),boundary=getBoundary(ranked);
  const top70=ranked.slice(0,70).map(({predictedRank,name,soopId,score})=>({predictedRank,name,soopId,score}));
  if(top70.length!==70||new Set(top70.map(r=>r.soopId)).size!==70)throw new Error('TOP 70 검증 실패');
  report.models[key]={label:model.label,cutoff:boundary.cutoff.name,score:boundary.cutoff.score,gap:boundary.gap,top70};
  console.log(`${model.label}: TOP ${top70.length} / 70위 ${boundary.cutoff.name} ${boundary.cutoff.score.toFixed(2)} / 차이 ${boundary.gap.toFixed(2)}`);
}
writeFileSync(new URL('../docs/model-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
