import {writeFileSync} from 'node:fs';
import {MODELS,calculateRanking,getBoundary} from '../assets/ranking.js';
const response=await fetch('https://taehyeon-masu.xyz/assets/data/ranking.json',{cache:'no-cache'});
if(!response.ok)throw new Error(`HTTP ${response.status}`);
const snapshot=await response.json();
const available=snapshot.streamers.filter(r=>r.status!=='unavailable');
const report={url:response.url,httpStatus:response.status,cacheControl:response.headers.get('cache-control'),updatedAt:snapshot.updatedAt,completedAt:snapshot.completedAt,asOf:snapshot.asOf,status:snapshot.status,candidates:snapshot.streamers.length,scored:available.length,pending:snapshot.streamers.length-available.length,models:{}};
for(const [key,model] of Object.entries(MODELS)){
  const ranked=calculateRanking(available,key),boundary=getBoundary(ranked);
  if(ranked.slice(0,70).length!==70)throw new Error('TOP70 incomplete');
  report.models[key]={label:model.label,cutoff:boundary.cutoff.name,score:boundary.cutoff.score,gap:boundary.gap,top70:ranked.slice(0,70).map(({soopId,name,score,predictedRank})=>({soopId,name,score,predictedRank}))};
}
writeFileSync(new URL('../docs/production-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,models:Object.fromEntries(Object.entries(report.models).map(([k,{top70,...m}])=>[k,{...m,count:top70.length}]))},null,2));
