import {MODELS} from './ranking.js';
import {rankLabel,reservationBoundary as getBoundary} from './ranking-exceptions.js?v=20261019-fixed';
import {rankingView, metricObservation, latestObservation} from './ranking-view.js?v=20261112-seven';
/** @template {HTMLElement} T @param {string} id @returns {T} */
const el = id => /** @type {T} */ (document.getElementById(id));
const fmt = n => n.toLocaleString('ko-KR');
const decimal = n => n.toFixed(2);
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const formatDate=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)).replaceAll('-','.')+' KST':'기준일 미확인';
let snapshot = null, ranked = [], pending = [], reserved = [], fixedSupport = [], model = 'rank', basis = 'forecast', filter = 'all', selectedId = null, view = null, loading = false;
function recalculate(){
  view=rankingView(snapshot,model,basis);ranked=view.ranked;pending=view.pending;reserved=view.reserved;fixedSupport=view.fixedSupport;
  document.documentElement.dataset.basis=view.forecast?'forecast':'actual';
  el('ranking-title').textContent=view.forecast?'11월 말 예상 순위':'현재 누적 기준 순위';
  el('basis-note').textContent=view.forecast?'메인 시뮬레이션과 같은 최근 7일 평균 증가 속도으로 11월 30일을 예상합니다. 표의 세 지표는 미래 추정치이며, 후원자 수는 마지막 확인값과 기존 증가 추정에 기반합니다.':'각 지표의 마지막 확인값으로 계산합니다. 수동 반영일이 다른 후원자 수와 미갱신 후보의 기준일은 상세에서 확인할 수 있습니다.';
  el('users-label').textContent=view.forecast?'예상 누적 유저':'누적 유저';
  el('donors-label').textContent=view.forecast?'예상 후원자':'후원자';
  el('balloons-label').textContent=view.forecast?'예상 별풍선':'별풍선';
  if(el('ranking-exception')){
  el('ranking-exception').hidden=!(reserved.length||fixedSupport.length);
  el('exception-note').textContent=fixedSupport.length?`${fixedSupport.map(row=>`${row.name}: 별풍선 ${fmt(row.balloonCount)}개(제공 월별 합계)·후원자 ${fmt(row.donorCount)}명(기존 연간 응답 참고)을 가정 고정합니다.`).join(' ')} 원본 비공개 값은 보존하며, 이 수치는 공개 확인된 연간 확정값이 아닙니다. 누적 유저는 새 자료로 갱신하고 미래 유저는 최근 7일 관측 추세를 우선 사용하며, 관측 부족 시 기존 추세로 대체합니다.`:reserved.length?`${reserved.map(row=>row.name).join(', ')} · 사용자 가정으로 TOP70 ${reserved.length}자리를 반영합니다. 공개 지표 후보 ${70-reserved.length}명과 함께 진입 기준을 계산하며, 비공개 후원 수치와 정확한 순위는 추정해 채우지 않습니다. 범위 표시는 예외 후보의 위치를 알 수 없어 생기는 차이입니다.`:'';
  }
  el('table-note').textContent=`${view.forecast?'11월 말 예상치':'현재 관측값'} 기준입니다. 유저 대비 차이는 계산 가능한 후보(후원 가정 포함) 내 누적 유저 순위와 종합 점수 순위의 차이이며, 전일 대비 변동이 아닙니다.`;
}
const search = /** @type {HTMLInputElement} */ (el('search'));
const detailDialog = /** @type {HTMLDialogElement} */ (el('detail-dialog'));
const methodDialog = /** @type {HTMLDialogElement} */ (el('method-dialog'));
let theme = 'light';
try { theme = localStorage.getItem('ranking-theme') || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'); } catch {}
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  el('theme').textContent = theme === 'dark' ? '라이트 모드' : '다크 모드';
  el('theme').setAttribute('aria-label',theme === 'dark' ? '밝은 테마로 변경' : '어두운 테마로 변경');
}
applyTheme();
el('theme').addEventListener('click',()=>{theme = theme === 'dark' ? 'light' : 'dark';applyTheme();try{localStorage.setItem('ranking-theme',theme);}catch{}});

function draw() {
  const boundary = getBoundary(ranked,view.scoreCutoffRank);
  el('cutoff-name').textContent = boundary?.cutoff.name || '—';
  el('cutoff-score').textContent = boundary ? decimal(boundary.cutoff.score) : '—';
  el('cutoff-gap').textContent = boundary?.gap === 0 ? '동점' : boundary?.gap != null ? decimal(boundary.gap) : '—';
  el('candidate-count').textContent = String(snapshot.streamers.length);
  const query = search.value.trim().toLocaleLowerCase('ko-KR');
  const matches = row => !query || row.name.toLocaleLowerCase('ko-KR').includes(query) || row.soopId.toLowerCase().includes(query);
  const visible = ranked.filter(row => (filter === 'all' || (filter === 'top' ? row.predictedRank <= 70 : row.predictedRank >= 60 && row.predictedRank <= 80)) && matches(row));
  const visiblePending = filter==='all' ? pending.filter(matches) : [];
  const visibleReserved=reserved.filter(matches);
  const visibleFixed=visible.filter(row=>row.supportFixed);
  el('result-count').textContent = `${visible.length+visiblePending.length+visibleReserved.length}명${visibleReserved.length?' · TOP70 가정 '+visibleReserved.length+'명':''}${visibleFixed.length?' · 후원 가정 고정 '+visibleFixed.length+'명':''}${visiblePending.length?' · '+visiblePending.length+'명 산정 대기':''}`;
  el('empty').hidden = visible.length + visiblePending.length + visibleReserved.length > 0;
  el('table-wrap').hidden = !(visible.length + visiblePending.length + visibleReserved.length);
  const reservedHtml=visibleReserved.map(row=>`<tr class="ranked-row reserved-row" data-id="${escape(row.soopId)}"><td class="rank-cell">TOP70</td><td class="streamer-cell"><button class="streamer-button" aria-label="${escape(row.name)} TOP70 가정 보기"><span class="avatar" aria-hidden="true">${escape(Array.from(row.name)[0])}</span><span class="streamer-name">${escape(row.name)}<span class="streamer-id">TOP70 한 자리 반영 · 상세 순위 미정</span></span></button></td><td class="category-cell">${escape(row.category||'—')}</td><td class="numeric score-cell">—</td><td class="numeric users-cell">${fmt(row.cumulativeUsers)}<small class="reserved-actual">확인 누적</small></td><td class="numeric donors-cell">비공개</td><td class="numeric balloons-cell">비공개</td><td class="numeric movement-cell">—</td></tr>`).join('');
  el('ranking-rows').innerHTML = reservedHtml+visible.map(row => {
    const change = row.viewerRank-(row.scoredRank??row.predictedRank);
    const movement = change > 0 ? `▲ ${change}` : change < 0 ? `▼ ${-change}` : '—';
    const html = `<tr class="ranked-row ${row.predictedRank===70?'cutoff-row':''} ${row.predictedRank>70?'outside':''}" data-id="${escape(row.soopId)}"><td class="rank-cell"><span class="${row.rankRange?.min!==row.rankRange?.max?'rank-range':'rank-number'}">${rankLabel(row.rankRange,row.predictedRank)}</span></td><td class="streamer-cell"><button class="streamer-button" aria-label="${escape(row.name)} 점수 구성 보기"><span class="avatar" aria-hidden="true">${escape(Array.from(row.name)[0])}</span><span class="streamer-name">${escape(row.name)}<span class="streamer-id">${row.supportFixed?'후원 지표 가정 고정':escape(row.soopId)}</span></span></button></td><td class="category-cell">${escape(row.category || '—')}</td><td class="numeric score-cell"><span class="score-value">${decimal(row.score)}</span></td><td class="numeric users-cell">${fmt(row.cumulativeUsers)}</td><td class="numeric donors-cell">${fmt(row.donorCount)}${row.supportFixed?'<small class="fixed-support-label">가정 고정</small>':''}</td><td class="numeric balloons-cell">${fmt(row.balloonCount)}${row.supportFixed?'<small class="fixed-support-label">가정 고정</small>':''}</td><td class="numeric movement-cell"><span class="movement ${change>0?'up':change<0?'down':''}" title="같은 후보군의 누적 유저 ${row.viewerRank}위 대비">${movement}</span></td></tr>`;
    return html + (row.predictedRank === 70 && visible.some(r=>r.predictedRank===71) ? '<tr class="cutline"><td colspan="8">예상 TOP 70 기준선 · 아래는 TOP 70 경계 밖</td></tr>' : '');
  }).join('') + visiblePending.map(row=>`<tr class="ranked-row outside pending-row" data-id="${escape(row.soopId)}"><td class="rank-cell">—</td><td class="streamer-cell"><button class="streamer-button" aria-label="${escape(row.name)} 산정 대기 사유 보기"><span class="avatar" aria-hidden="true">${escape(Array.from(row.name)[0])}</span><span class="streamer-name">${escape(row.name)}<span class="streamer-id">산정 대기 · 후원 비공개</span></span></button></td><td class="category-cell">${escape(row.category||'—')}</td><td class="numeric score-cell">—</td><td class="numeric users-cell">${fmt(row.cumulativeUsers)}</td><td class="numeric donors-cell">비공개</td><td class="numeric balloons-cell">비공개</td><td class="numeric movement-cell">—</td></tr>`).join('');
  el('search-summary').hidden = !query || !visible.length;
  if(query && visible.length && boundary){
    el('search-summary').textContent = visible.length === 1 ? `${visible[0].name} · ${view.forecast?'11월 말 예상':'현재 기준'} ${rankLabel(visible[0].rankRange,visible[0].predictedRank)}위 · 누적 유저 후보 내 ${visible[0].viewerRank}위 · ${decimal(visible[0].score)}점 · 70위 기준 ${visible[0].score>=boundary.cutoff.score?'+':''}${decimal(visible[0].score-boundary.cutoff.score)}점` : `${visible.length}명 검색됨 · 이름을 누르면 70위와의 점수 차이를 확인할 수 있습니다.`;
  }
  el('announcement').textContent = `${MODELS[model].label} 모델, ${visible.length}명 표시`;
  if(selectedId && detailDialog.open) renderDetail(selectedId);
}

function renderDetail(id){
  const reservation=reserved.find(row=>row.soopId===id);
  if(reservation){
    selectedId=id;
    el('detail-content').innerHTML=`<h2 id="detail-title">${escape(reservation.name)}</h2><div class="detail-rank">TOP70 한 자리 반영 · 상세 순위 미정</div><p>확인 누적 유저 ${fmt(reservation.cumulativeUsers)} · ${formatDate(metricObservation(snapshot,reservation,'cumulativeUsers'))}</p><p>사용자 요청에 따른 TOP70 진입 가정입니다. 후원자·별풍선 원본은 비공개 상태로 보존하며, 점수나 정확한 순위를 임의로 만들지 않습니다.</p><p>나머지 공개 지표 후보는 상위 ${view.scoreCutoffRank}명을 진입 기준으로 계산합니다. 누적 유저는 새 수동 자료가 들어오면 갱신하며, 단츄의 미래 유저 증가량을 별도로 추정한 값은 아닙니다.</p>`;
    return;
  }
  const waiting = pending.find(r=>r.soopId===id);
  if(waiting){selectedId=id;el('detail-content').innerHTML=`<h2 id="detail-title">${escape(waiting.name)}</h2><div class="detail-rank">산정 대기 · 후원 통계 비공개</div><p>현재 관측 누적 유저 ${fmt(waiting.cumulativeUsers)} · ${formatDate(metricObservation(snapshot,waiting,'cumulativeUsers'))}</p><p>Trackify에서 후원 통계를 비공개로 표시해 예상 점수와 순위, 70위 기준 점수 차이를 계산하지 않았습니다. 누락 값을 0으로 대체하지 않습니다.</p><a href="https://www.trackify.kr/soop/${encodeURIComponent(id)}" target="_blank" rel="noreferrer">원본 통계 ↗</a>`;return;}
  const row = ranked.find(r=>r.soopId===id);
  if(!row) return;
  selectedId = id;
  const boundary = getBoundary(ranked,view.scoreCutoffRank), gap = boundary ? row.score-boundary.cutoff.score : null;
  const actual=snapshot.streamers.find(r=>r.soopId===id),assumption=row.fixedSupportAssumption;
  const observations=[['cumulativeUsers','누적 유저'],['donorCount','후원자'],['balloonCount','별풍선']]
    .map(([key,label])=>assumption&&key!=='cumulativeUsers'?`${label}: 원본 비공개 · 계산용 가정 고정 ${fmt(assumption[key])}`:`${label} ${fmt(actual[key])} · ${formatDate(metricObservation(snapshot,actual,key))}`);
  const fixedNote=assumption?`<p>후원자 ${fmt(assumption.donorCount)}명은 기존 저장 연간 응답을 참고한 추정 고정값이며, 별풍선 ${fmt(assumption.balloonCount)}개는 제공한 월별 합계로 고정합니다. 두 수치는 공개 확인된 연간 확정값이 아닙니다. 미래 후원 증가를 더하지 않고, 미래 유저는 기존 9월 월간 유저 ÷ 30의 일평균으로 예상합니다.</p>`:'';
  const audit=snapshot.manualOverride;
  const adjustment=id===audit?.streamerId&&Number.isSafeInteger(audit.adjustment)&&audit.adjustment<0?
    `<p>누적 유저 수동 보정: 원본 ${fmt(audit.rawViewer)} → 적용 ${fmt(audit.adjustedViewer)} (보정 ${fmt(audit.adjustment)}명).</p>`:'';

  el('detail-content').innerHTML = `<div class="detail-heading"><div><h2 id="detail-title">${escape(row.name)}</h2><span class="muted">${escape(row.category || '카테고리 미제공')} · ${escape(MODELS[model].label)}</span></div><strong>${rankLabel(row.rankRange,row.predictedRank)}<small> 위</small></strong></div><div class="detail-rank">${view.forecast?'11월 말 예상':'현재 누적 기준'} · 누적 유저 후보 내 ${row.viewerRank}위 → 종합 <strong>${rankLabel(row.rankRange,row.predictedRank)}위</strong> · ${row.predictedRank<=70?'예상 TOP 70':'TOP 70 경계 밖'}</div><table class="breakdown"><caption class="sr-only">항목별 점수와 가중 합계</caption><thead><tr><th scope="col">항목 / ${view.forecast?'11월 말 예상치':'관측값'}</th><th scope="col">모델 점수</th><th scope="col">비중</th><th scope="col">반영 점수</th></tr></thead><tbody>${row.breakdown.map(m=>`<tr><td>${m.label}<small>${fmt(m.value)} · 후보 내 ${m.rank}위</small></td><td>${decimal(m.score)}</td><td>× ${m.weight*100}%</td><td><strong>${decimal(m.weighted)}</strong></td></tr>`).join('')}</tbody></table><div class="detail-total"><span>최종 예상 점수</span><strong>${decimal(row.score)}</strong></div><p>${gap===null?'70위 기준 없음':`70위 기준 점수와 ${gap>=0?'+':''}${decimal(gap)}점 차이입니다.`} 표시 반올림으로 항목 합계에 미세한 차이가 있을 수 있습니다.</p><h3>실제 관측값과 기준일</h3><p>${observations.map(escape).join('<br>')}</p>${adjustment}${fixedNote}${view.forecast&&!assumption?'<p>위 점수 표는 11월 말 예상치입니다. 후원자는 마지막 확인한 연간 고유 인원과 기존 증가 추정에 기반하며, 새 후원 인원수를 직접 확인한 값은 아닙니다.</p>':''}<div class="detail-links"><span>SOOP 공식 순위가 아닌 시뮬레이션입니다.</span><a href="https://www.trackify.kr/soop/${encodeURIComponent(id)}" target="_blank" rel="noreferrer">원본 통계 ↗</a></div>`;
}

el('ranking-rows').addEventListener('click',event=>{
  const row = /** @type {HTMLElement} */ (event.target).closest('tr[data-id]');
  if(!row) return;
  renderDetail(row.getAttribute('data-id'));
  detailDialog.showModal();
});
document.querySelectorAll('[data-model]').forEach(button=>button.addEventListener('click',()=>{
  model=button.getAttribute('data-model');
  document.querySelectorAll('[data-model]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  el('model-description').textContent=MODELS[model].description;
  if(snapshot?.streamers?.length){recalculate();draw();}
}));
document.querySelectorAll('button[data-basis]').forEach(button=>button.addEventListener('click',()=>{
  basis=button.getAttribute('data-basis');
  document.querySelectorAll('button[data-basis]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  if(snapshot?.streamers?.length){recalculate();draw();}
}));
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
  filter=button.getAttribute('data-filter');
  document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  if(ranked.length)draw();
}));
search.addEventListener('input',()=>{if(ranked.length)draw();});
el('reset-search').addEventListener('click',()=>{search.value='';filter='all';document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.getAttribute('data-filter')==='all')));draw();search.focus();});
for(const id of ['method-open','method-inline','exclusions-open'])el(id).addEventListener('click',()=>{methodDialog.showModal();if(id==='exclusions-open')el('exclusions-title').focus();});
document.querySelectorAll('dialog').forEach(dialog=>{
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
});

async function load(){
  if(loading)return;
  loading=true;
  el('loading').hidden=!!snapshot;el('fetch-error').hidden=true;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch('/assets/data/ranking.json',{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error('통계 파일 응답 오류');
    const next=await response.json();
    if(next.status==='unavailable'||!Array.isArray(next.streamers)||next.streamers.length!==100)throw new Error(next.message||'완전한 후보 100명의 통계가 아직 준비되지 않았습니다.');
    const updated=new Date(latestObservation(next));
    if(!Number.isFinite(updated.getTime()))throw new Error('갱신 시각 검증 실패');
    rankingView(next,model,basis); // Validate before replacing the last usable display.
    snapshot=next;
    const reasons={official:'공식 방송',foreign:'해외 방송', 'non-personal':'비개인 채널'};
    el('exclusion-list').innerHTML=(snapshot.exclusions||[]).map(x=>`<div><span><a href="https://www.trackify.kr/soop/${encodeURIComponent(x.soopId)}" target="_blank" rel="noreferrer">${escape(x.name)} ↗</a><small>${escape(x.soopId)} · ${escape(x.evidence||'수동 확인')}</small></span><span>${escape(reasons[x.reason]||x.reason)}</span></div>`).join('');
    recalculate();
    const manual=snapshot.collectionMode==='manual_partial',batch=manual?snapshot.manualBatchOverride:null;
    const stale = snapshot.status==='stale'||Date.now()-updated.getTime()>24*60*60*1000;
    const notes=[];
    if(batch)notes.push(`누적 유저 ${batch.updatedViewerCandidates??batch.updatedCandidates}명·별풍선 ${batch.updatedBalloonCandidates??batch.updatedCandidates}명을 수동 갱신했습니다. 후원자 수는 마지막 확인값을 유지합니다.${batch.retainedCandidates?` 미갱신 ${batch.retainedCandidates}명(${(batch.retainedCandidateNames||[]).join(', ')||'상세 기준일 확인'})은 이전 값입니다.`:''}`);
    else if(manual)notes.push(`띵귤 자료는 수동 반영됐으며, 경쟁자 자료 기준은 ${formatDate(snapshot.competitorDataAsOf)}입니다.`);
    if(pending.length)notes.push(`후원 통계 비공개 ${pending.length}명(${pending.map(r=>r.name).join(', ')})은 산정 대기입니다. 순위와 TOP70은 점수 계산 ${ranked.length}명${fixedSupport.length?`(후원 가정 고정 ${fixedSupport.length}명 포함)`:``}${reserved.length?`·TOP70 가정 ${reserved.length}명`:``} 기준 잠정 결과입니다.`);
    if(stale)notes.push('최근 관측 이후 24시간 이상 지났거나 자동 수집이 지연되어 마지막 확인값을 표시합니다.');
    el('data-status').hidden=!notes.length;
    el('data-status').textContent=notes.join(' ');
    el('as-of').textContent=manual?'사용자 제공 자료 수동 반영':'공개 통계 수집 기준';
    el('updated-at').textContent=(manual?'최근 수동 반영 ':'최근 갱신 ')+formatDate(updated.toISOString());
    el('date-note').textContent=manual?'연간 누적 자료와 지표별 마지막 관측일을 사용합니다. 후원자 자료는 누적 유저·별풍선과 기준일이 다를 수 있습니다.':snapshot.dateNote;
    draw();
  }catch(error){
    if(snapshot){el('data-status').hidden=false;el('data-status').textContent='새 자료를 확인하지 못해 마지막으로 표시한 순위를 유지합니다. 잠시 후 자동으로 다시 확인합니다.';}
    else{
      el('fetch-error').hidden=false;el('table-wrap').hidden=true;
      el('error-message').textContent=error instanceof Error?error.message:'통계를 불러오지 못했습니다.';
      el('as-of').textContent='데이터 확인 불가';
    }
  }finally{clearTimeout(timeout);loading=false;el('loading').hidden=true;}
}
el('retry').addEventListener('click',load);
el('refresh').addEventListener('click',load);
load();setInterval(()=>{if(!document.hidden)load();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
