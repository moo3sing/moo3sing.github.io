import fs from 'node:fs';
import assert from 'node:assert/strict';
import {dynamicTargets} from '../assets/dynamic-target.js';
import {rollingTargets} from '../assets/rolling-target.js';
import {calculateRanking} from '../assets/ranking.js';
const snapshot=JSON.parse(fs.readFileSync(process.argv[2]||'assets/data/ranking.json'));
const now=snapshot.actualObservedAt;
const previous=dynamicTargets(snapshot,now),current=rollingTargets(snapshot,now);
// The old production projector and solver remain unchanged; only injection was added.
const original=fs.readFileSync('docs/rolling-before/dynamic-target.js','utf8');
assert.equal(fs.readFileSync('assets/dynamic-target.js','utf8'),original.replace('const {horizon,rows}=projectCandidates(snapshot,now);','const {horizon,rows}=(options.projector||projectCandidates)(snapshot,now);'));
const ids=['singgyul','juju0228','gofl2237','he0901','nmangoquince','mj0128'];
const rankings=Object.fromEntries(['rank','ratio','minmax'].map(m=>[m,{before:calculateRanking(previous.projectedRows,m),after:calculateRanking(current.projectedRows,m)}]));
const metrics=['cumulativeUsers','donorCount','balloonCount'];
const rows=snapshot.streamers.filter(r=>r.status!=='unavailable').map(actual=>{
 const before=previous.projectedRows.find(r=>r.soopId===actual.soopId),after=current.projectedRows.find(r=>r.soopId===actual.soopId);
 return {soopId:actual.soopId,name:actual.name,actual:Object.fromEntries(metrics.map(k=>[k,actual[k]])),metrics:Object.fromEntries(metrics.map(k=>[k,{before:before[k],after:after[k],delta:after[k]-before[k]}])),models:Object.fromEntries(Object.entries(rankings).map(([k,v])=>{const b=v.before.find(r=>r.soopId===actual.soopId),a=v.after.find(r=>r.soopId===actual.soopId);return [k,{before:{score:b.score,rank:b.predictedRank},after:{score:a.score,rank:a.predictedRank},scoreDelta:a.score-b.score,rankDelta:a.predictedRank-b.predictedRank}];})),forecast:after.forecast};
});
const targets=current.models.map((r,i)=>({model:r.model,before:previous.models[i].remaining,after:r.remaining,delta:r.remaining-previous.models[i].remaining}));
const report={comparedAt:now,actualUpdatedAt:snapshot.updatedAt,basis:'Identical current actuals, support history and KST evaluation date; unchanged old production projector versus rolling projector',candidates:rows.length,targets,safe:{before:previous.safe,after:current.safe,delta:current.safe-previous.safe},representatives:ids.map(id=>rows.find(r=>r.soopId===id)),rows};
fs.writeFileSync('docs/rolling-comparison.json',JSON.stringify(report,null,2)+'\n');
const n=x=>x.toLocaleString('en-US'),pair=x=>`${n(x.before)} → ${n(x.after)} (${x.delta>=0?'+':''}${n(x.delta)})`;
let md=`# Rolling forecast 비교\n\n동일 actual 데이터·동일 평가일: ${now}. 현재값 기준 시각: ${snapshot.updatedAt}. 유효 후보 ${rows.length}명.\n\n`;
md+='| 모델 | 기존 목표 → 새 목표 (차이) |\n|---|---:|\n'+targets.map(x=>`| ${x.model} | ${pair(x)} |`).join('\n')+`\n| Safe | ${pair(report.safe)} |\n\n`;
md+='| 후보 | Projected viewer | Projected donor | Projected balloon |\n|---|---:|---:|---:|\n'+report.representatives.map(x=>`| ${x.name} (${x.soopId}) | ${metrics.map(k=>pair(x.metrics[k])).join(' | ')} |`).join('\n')+'\n\n';
for(const model of ['rank','ratio','minmax']){
 md+=`## ${model}: 최종 점수와 순위\n\n| 후보 | 기존 점수 → 새 점수 | 기존 순위 → 새 순위 |\n|---|---:|---:|\n`+report.representatives.map(x=>{const v=x.models[model];return `| ${x.name} | ${v.before.score.toFixed(6)} → ${v.after.score.toFixed(6)} | ${v.before.rank} → ${v.after.rank} |`;}).join('\n')+'\n\n';
}
md+='Viewer/balloon은 최근 월별 pace와 연간 actual 증가의 blend입니다. Donor actual은 연간 고유 수, 미래분은 기존 보수적 기준과 연간 신규 증가 pace를 섞고 기존 중복 감소 가정을 유지한 추정입니다. 월별 unique donor 수는 합산하지 않습니다.\n';
fs.writeFileSync('docs/rolling-comparison.md',md);
console.log(JSON.stringify({comparedAt:now,targets,safe:report.safe,representatives:report.representatives.map(({forecast,...r})=>r)},null,2));
