import {goalScenarios,conservativeModelGoals} from './goal-scenarios.js?v=20261112-models';
const el=id=>document.getElementById(id),fmt=n=>n===null?'—':n.toLocaleString('ko-KR'),names={rank:'순위형',ratio:'1위 대비',minmax:'Min-Max',log:'Log'};
import {rankLabel} from './ranking-exceptions.js?v=20261019-fixed';
import {updateTrends} from './trend-ui.js?v=20261112-partial';
import {viewerOnlyReference} from './viewer-reference.js?v=20261112-seven';
let snapshot;
function render(){
 const scenarios=goalScenarios(snapshot),r=scenarios.recent,original=scenarios.original,conservative=scenarios.conservative,ended=r.horizon.ended;
 const selectedModel=r.models.find(m=>m.model===r.safeModel);
 el('content').hidden=false;el('retry').hidden=true;
 el('status').textContent=ended?'2026 심사 기간 종료':snapshot.status==='stale'?'최근 수집에 실패하여 마지막 정상 데이터를 표시합니다.':'';
 el('safe').textContent=ended?'종료':fmt(original.safe);el('unit').hidden=ended||original.safe===null;
 el('recent-goal').textContent=ended?'종료':fmt(r.safe);el('recent-unit').hidden=ended||r.safe===null;
 el('conservative-goal').textContent=ended?'종료':fmt(conservative.safe);el('conservative-unit').hidden=ended||conservative.safe===null;
 el('recent-daily').textContent=fmt(r.daily);el('recent-daily-unit').hidden=r.daily===null;
 el('conservative-daily').textContent=fmt(conservative.daily);el('conservative-daily-unit').hidden=conservative.daily===null;
 el('conservative-policy').textContent='보수적: 띵귤은 낮은 추세 · 경쟁자는 높은 추세 / 세 경우 중 최대 목표 적용';
 el('verdict').textContent=ended?'11월 30일 마지막 관측값을 보존합니다.':original.safe===0?'기존 추세 기준 TOP 70 예상권':original.safe===null?'일부 모델의 목표가 산정 범위를 벗어났습니다.':'';
 el('daily').textContent=fmt(original.daily);el('daily-unit').hidden=original.daily===null;
 el('days').textContent=ended?'남은 기간 목표 계산 종료':r.horizon.remainingDays?`D-${r.horizon.remainingDays} · 내일부터 11월 30일까지 ${r.horizon.remainingDays}일`:'오늘 마감 · 남은 전체 날짜가 없어 일평균을 계산하지 않습니다.';
 el('gain').textContent=`${r.actualGain>=0?'+':''}${fmt(r.actualGain)}명`;el('current').textContent=fmt(r.currentUsers)+'명';el('current-rank').textContent=selectedModel.currentRank+'위';el('current-rank-basis').textContent=names[r.safeModel]+(r.fixedSupportCount?' · 가정 포함':' · 현재 누적');el('forecast-rank-label').textContent=ended?'11월 말 최종 관측 순위':'11월 말 예상 순위 · 최근 7일';el('rank').textContent=r.predictedRank+'위';el('rank-basis').textContent=names[r.safeModel]+(selectedModel.predictedRankRange.min!==selectedModel.predictedRankRange.max?` · ${rankLabel(selectedModel.predictedRankRange,r.predictedRank)}위 중 보수값`:ended?' · 최종 관측 기준':r.fixedSupportCount?' · 가정 포함':' · 안전 목표 모델');
 el('models').replaceChildren(...conservativeModelGoals(scenarios).map(m=>{const card=document.createElement('article');const experimental='experimental' in m&&m.experimental;card.dataset.modelResult=m.model;card.dataset.experimental=String(experimental);card.innerHTML=`<h3>${names[m.model]}${experimental?' <span class="model-badge">실험</span>':''}</h3><p class="model-rank">${ended?'관측':'보수 예상'} ${m.predictedRank}위</p><span>남은 목표</span><strong>${fmt(m.remaining)}<small>${m.remaining===null?'':'명'}</small></strong><p class="model-daily">하루 평균 <b>${fmt(m.daily)}</b>${m.daily===null?'':'명'}</p>${experimental?'<p class="model-policy">SafeTarget 미포함</p>':''}`;return card;}));
 el('october').textContent=fmt(r.october)+(r.october===null?'':'명');el('november').textContent=fmt(r.november)+(r.november===null?'':'명');
 const formatDate=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)).replaceAll('-','.');
 const manual=snapshot.collectionMode==='manual_partial';
 const batch=manual?snapshot.manualBatchOverride:null;
 const sourceObservation=batch?.sourceObservation;
 const updateTime=manual?snapshot.manualOverride.observedAt:r.updatedAt;
 const updateLabel=el('goal-updated-label'),updateDate=el('goal-updated-at');
 const dayOnly=sourceObservation?.precision==='day';
 updateLabel.textContent=dayOnly?'자료 기준':'자료 업데이트';
 updateDate.setAttribute('datetime',dayOnly?sourceObservation.date:updateTime);
 updateDate.textContent=dayOnly?`${sourceObservation.date.replaceAll('-','.')} · 집계 시각 미제공`:
  new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(updateTime))+' KST';
 updateDate.title=dayOnly?'원본 집계 시각이 제공되지 않은 날짜 기준 자료입니다.':formatDate(updateTime)+' KST · 누적 유저·별풍선 자료 기준';
 el('updated').textContent=sourceObservation?.precision==='day'?`누적 유저·별풍선: ${sourceObservation.date.replaceAll('-','.')} 연간 자료 · 수신 ${formatDate(sourceObservation.receivedAt)} KST (원본 집계 시각 미제공)`:manual?`띵귤 데이터 기준 ${formatDate(snapshot.manualOverride.observedAt)} KST · ${batch?`경쟁자 ${batch.updatedCompetitors}명 수동 자료 ${formatDate(batch.observedAt)}`:`경쟁자 데이터 기준 ${formatDate(snapshot.competitorDataAsOf)}`} KST`:'데이터 기준 '+formatDate(r.updatedAt)+' KST';
 el('manual-note').hidden=!manual;
 el('manual-note').textContent=batch?`기존 후보 ${batch.updatedCandidates}명의 누적 유저와 공개된 별풍선을 사용자 제공 자료로 수동 갱신했습니다. ${batch.retainedCandidates?`목록에 없는 ${batch.retainedCandidates}명은 이전 값입니다. `:''}후원자 수는 마지막 확인값을 유지하며, 지표별 기준일은 전체 랭킹의 상세에서 확인할 수 있습니다.`:manual?'띵귤 데이터는 수동 갱신됐습니다. 경쟁자 데이터는 마지막 자동 수집 시점을 기준으로 예측합니다.':'';
 const adjustment=snapshot.manualOverride;
 const adjusted=manual&&['suspected_bot_traffic_adjustment','suspected_viewbot_traffic'].includes(adjustment?.reason)&&
  Number.isSafeInteger(adjustment.rawViewer)&&Number.isSafeInteger(adjustment.adjustedViewer)&&Number.isSafeInteger(adjustment.adjustment)&&
  adjustment.adjustment<0&&adjustment.rawViewer+adjustment.adjustment===adjustment.adjustedViewer&&r.currentUsers===adjustment.adjustedViewer;
 const adjustmentNote=el('adjustment-note');
 if(adjustmentNote){
  adjustmentNote.hidden=!adjusted;
   adjustmentNote.textContent=adjusted?`뷰봇 의심 유입 ${fmt(-adjustment.adjustment)}명을 사용자 요청 가정으로 제외한 시뮬레이션입니다. 로그로 측정한 피해량은 아닙니다. 원본 ${fmt(adjustment.rawViewer)}명 → 적용 ${fmt(adjustment.adjustedViewer)}명.`:'';
 }
 el('freshness').textContent=!manual&&!ended&&Date.now()-Date.parse(r.updatedAt)>86400000?'마지막 데이터 변경 이후 24시간 이상 지났습니다. 원본 갱신 지연 또는 수집 상태를 확인해 주세요.':'';
 const t=r.target;
 const recentViewers=r.projectedRows.filter(row=>row.forecast?.metrics?.cumulativeUsers?.paceSource==='recent-7d-average').length;
 const partialViewers=r.projectedRows.filter(row=>row.forecast?.metrics?.cumulativeUsers?.paceSource==='recent-partial-average').length;
 el('recent-trend-note').textContent=snapshot.recentTrend?`최근 7일: 평균 ${recentViewers}명${partialViewers?` · 단기 관측 ${partialViewers}명`:""} · 대체 추세 ${r.projectedRows.length-recentViewers-partialViewers}명 · 대기 ${r.pendingCount+r.reservedCount}명`:'';
 el('support-state').textContent=ended?`전체 후보 ${snapshot.streamers.length}명 최종 실적 반영`:`상·하위 경쟁자 추세 반영 · 전체 후보 ${snapshot.streamers.length}명`;
 try{
  const reference=viewerOnlyReference(snapshot,r);
  el('viewer-reference-value').textContent=ended?'심사 종료':fmt(reference.remaining)+'명';
  el('viewer-reference-note').textContent=ended?'마지막 관측값 기준 · 안전 목표 미포함':'TOP70까지 앞으로 필요한 누적 · 경쟁자 최근 7일 추세 반영';
 }catch(error){
  el('viewer-reference-value').textContent='산정 대기';
  el('viewer-reference-note').textContent='전체 후보의 시청자 자료를 확인할 수 없습니다.';
 }
 el('donor-state').textContent=r.donorEstimated?'후원자 추정 데이터':'후원자 실제 데이터 · 연간 고유 집계';
 el('support-actual').textContent=`후원자 ${fmt(t.actual.donorCount)}명 · 9/30 대비 +${fmt(t.gains.donorCount)}명 / 별풍선 ${fmt(t.actual.balloonCount)}개 · +${fmt(t.gains.balloonCount)}개`;
 el('support-forecast').textContent=ended?'심사 기간 종료 — 마지막 관측값 보존':`11/30 예상 후원자 ${fmt(t.projected.donorCount)}명 / 예상 별풍선 ${fmt(t.projected.balloonCount)}개`;
 const viewerPace=t.forecast.metrics.cumulativeUsers;
 el('pace-state').textContent=snapshot.recentTrend?`최근 7일 관측 증가 속도 · 시청자 하루 평균 ${fmt(Math.round(viewerPace.forecastDailyPace))}명 · 비교 가능한 관측 ${Number(viewerPace.observedDays||0).toFixed(1)}일${viewerPace.fallbackReason?' · '+viewerPace.fallbackReason:''}`:`최근 추세와 10~11월 실제 데이터를 함께 반영한 예측 · 유저 actual 비중 ${(viewerPace.actualWeight*100).toFixed(1)}%`;
 const exceptionNote=el('ranking-exception-note');
 if(exceptionNote){
 exceptionNote.hidden=!(r.reservedCount||r.fixedSupportCount);
 exceptionNote.textContent=r.fixedSupportCount?`${r.fixedSupport.map(row=>`${row.name}: 별풍선 ${fmt(row.balloonCount)}개·후원자 ${fmt(row.donorCount)}명 가정 고정`).join('; ')}. 원본 비공개 값은 보존합니다. 누적 유저는 새 자료로 갱신하며, 미래 유저는 최근 7일 관측 추세를 우선 사용하고, 관측이 부족하면 기존 추세로 대체합니다.`:r.reservedCount?`${r.reserved.map(row=>row.name).join(', ')}는 사용자 요청에 따라 TOP70 ${r.reservedCount}자리를 가정합니다. 비공개 후원 수치는 채우지 않으며, 순위 범위가 있으면 메인에는 보수값을 표시합니다.`:'';
 }
 const fallback=snapshot.rollingForecast.rows.filter(x=>x.cumulativeUsers.fallbackReason||x.balloonCount.fallbackReason).length;
 el('limits').textContent=`후원 통계 비공개 ${r.pendingCount}명은 산정 대기입니다. 최근 월별 자료가 불완전한 ${fallback}명은 사용 가능한 월 또는 기존 대체 추세를 사용합니다. 후원자는 월별 고유 수를 합산하지 않고 연간 실제 증가와 보수적 기준을 혼합한 추정입니다.`;
 if(el('trends')){try{updateTrends(snapshot,r.safeModel);}catch(error){console.error('추이 표시 실패',error);el('trend-empty').hidden=false;el('trend-empty').textContent='추이 자료를 표시하지 못했습니다. 현재 목표와 순위는 위에서 확인할 수 있습니다.';el('trend-body').hidden=true;}}
}
async function load(){try{const response=await fetch('/assets/data/ranking.json',{cache:'no-store'});if(!response.ok)throw new Error('데이터를 불러오지 못했습니다.');snapshot=await response.json();render();}catch(error){el('status').textContent=error.message;el('retry').hidden=false;}}
el('retry').addEventListener('click',load);
el('theme').addEventListener('click',()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';el('theme').textContent=dark?'라이트 모드':'다크 모드';});
load();setInterval(load,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
