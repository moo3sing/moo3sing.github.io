import {trendView,MODEL_NAMES} from './trend-data.js?v=20261028-totals';

const el=id=>document.getElementById(id),fmt=n=>Math.round(n).toLocaleString('ko-KR');
const parts=value=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(part=>[part.type,part.value]));
const date=value=>{const p=parts(value);return `${p.month}/${p.day}`;};
const stamp=value=>{const p=parts(value);return `${p.month}/${p.day} ${p.hour}:${p.minute}`;};
let snapshot,model,mode='total',rival='median',pinned=false,observer,lastWidth;
const ns='http://www.w3.org/2000/svg';
function node(tag,attrs={},content=''){
 const item=document.createElementNS(ns,tag);
 Object.entries(attrs).forEach(([key,value])=>item.setAttribute(key,String(value)));
 if(content)item.textContent=content;
 return item;
}
function plot(id,rows,lines,rank,onSelect){
 const box=el(id),width=Math.max(280,Math.round(box.clientWidth)),height=250;
 const svg=node('svg',{viewBox:`0 0 ${width} ${height}`,role:'img',tabindex:0,
  'aria-label':rank?'같은 모델의 현재 순위와 11월 말 예상 순위. 위쪽이 높은 순위입니다.':mode==='total'?'띵귤과 경계 경쟁자의 실제 누적 유저 추이':'띵귤과 경계 경쟁자의 유저 일평균 증가 추이',
  'aria-describedby':id+'-readout'});
 const pad={left:rank?38:50,right:18,top:24,bottom:32},w=width-pad.left-pad.right,h=height-pad.top-pad.bottom;
 const values=rows.flatMap(row=>lines.map(line=>row[line.key])).filter(Number.isFinite);
 if(rank)values.push(70);
 let low=rank?Math.floor((Math.min(...values)-2)/2)*2:Math.min(0,...values);
 let high=rank?Math.ceil((Math.max(...values)+2)/2)*2:Math.max(1,...values)*1.14;
 if(high===low)high=low+1;
 if(!rank){const step=Math.pow(10,Math.floor(Math.log10(Math.max(1,...values))));high=Math.ceil(high/step)*step;}
 let tickCount=4;
 if(!rank&&mode==='total'){
  const min=Math.min(...values),max=Math.max(...values),padding=Math.max((max-min)*.12,max*.006,1);
  const rough=(max-min+padding*2)/4,magnitude=Math.pow(10,Math.floor(Math.log10(rough)));
  const step=Math.ceil(rough/magnitude)*magnitude;
  low=Math.max(0,Math.floor((min-padding)/step)*step);high=Math.ceil((max+padding)/step)*step;
  tickCount=Math.round((high-low)/step);
 }
 const start=rows[0].time,end=rows.at(-1).time;
 const x=t=>pad.left+(t-start)/Math.max(1,end-start)*w;
 const y=v=>pad.top+(rank?(v-low)/(high-low):(high-v)/(high-low))*h;
 for(let i=0;i<=tickCount;i++){
  const value=rank?Math.round(low+(high-low)*i/tickCount):low+(high-low)*i/tickCount,py=y(value);
  svg.append(node('line',{x1:pad.left,x2:width-pad.right,y1:py,y2:py,class:'trend-grid'}));
  svg.append(node('text',{x:pad.left-9,y:py+4,'text-anchor':'end',class:'trend-axis'},rank?String(value):value===0?'0':(value/10000).toLocaleString('ko-KR',{maximumFractionDigits:1})));
 }
 svg.append(node('text',{x:pad.left,y:13,class:'trend-axis'},rank?'위 · 위로 갈수록 높은 순위':'만 명'+(mode==='pace'?' / 일':'')));
 const midpoint=(start+end)/2;
 const middle=rows.reduce((best,row,i)=>Math.abs(row.time-midpoint)<Math.abs(rows[best].time-midpoint)?i:best,0);
 const indexes=[...new Set([0,middle,rows.length-1])].filter((i,position,array)=>position===0||x(rows[i].time)-x(rows[array[position-1]].time)>56);
 indexes.forEach(index=>svg.append(node('text',{x:x(rows[index].time),y:height-9,'text-anchor':index===0?'start':index===rows.length-1?'end':'middle',class:'trend-axis'},date(rows[index].observedAt))));
 if(rank){
  const py=y(70);
  svg.append(node('line',{x1:pad.left,x2:width-pad.right,y1:py,y2:py,class:'trend-cutoff'}));
  svg.append(node('text',{x:width-pad.right-2,y:py-6,'text-anchor':'end',class:'trend-cutoff-label'},'TOP 70'));
 }
 lines.forEach(line=>{
  let drawing=false,path='';
  rows.forEach(row=>{
   const value=row[line.key];
   if(!Number.isFinite(value)){drawing=false;return;}
   path+=(drawing?' L':' M')+x(row.time).toFixed(2)+' '+y(value).toFixed(2);drawing=true;
  });
  svg.append(node('path',{d:path,fill:'none',class:`trend-line ${line.kind}`,'stroke-linejoin':'round','stroke-linecap':'round'}));
  rows.forEach(row=>{
   if(Number.isFinite(row[line.key]))svg.append(node('circle',{cx:x(row.time),cy:y(row[line.key]),r:3.2,class:`trend-dot ${line.kind}`}));
  });
 });
 const guide=node('line',{y1:pad.top,y2:height-pad.bottom,class:'trend-guide'});svg.append(guide);
 const focus=lines.map(line=>{const dot=node('circle',{r:5,class:`trend-dot ${line.kind}`});svg.append(dot);return dot;});
 let selected=rows.length-1;
 function select(index){
  selected=Math.max(0,Math.min(rows.length-1,index));const row=rows[selected];
  guide.setAttribute('x1',String(x(row.time)));guide.setAttribute('x2',String(x(row.time)));
  focus.forEach((dot,i)=>{
   const value=row[lines[i].key];dot.setAttribute('visibility',Number.isFinite(value)?'visible':'hidden');
   if(Number.isFinite(value)){dot.setAttribute('cx',String(x(row.time)));dot.setAttribute('cy',String(y(value)));}
  });
  onSelect(row);
 }
 svg.addEventListener('pointermove',event=>{
  const px=(event.clientX-svg.getBoundingClientRect().left)*width/svg.getBoundingClientRect().width;
  select(rows.reduce((best,row,i)=>Math.abs(x(row.time)-px)<Math.abs(x(rows[best].time)-px)?i:best,0));
 });
 svg.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();select(event.key==='Home'?0:event.key==='End'?rows.length-1:selected+(event.key==='ArrowLeft'?-1:1));
 });
 box.replaceChildren(svg);select(selected);
}
function text(id,value){el(id).textContent=value;}
function render(){
 if(!snapshot)return;
 let view=trendView(snapshot,model,rival);
 if(!view&&rival!=='median'){rival='median';view=trendView(snapshot,model,rival);}
 el('trend-empty').hidden=!!view;el('trend-body').hidden=!view;
 if(!view)return;
 document.querySelectorAll('[data-trend-model]').forEach(button=>button.setAttribute('aria-pressed',String(button.getAttribute('data-trend-model')===model)));
 document.querySelectorAll('[data-trend-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.getAttribute('data-trend-mode')===mode)));
 const select=/** @type {HTMLSelectElement} */(el('trend-rival'));
 select.replaceChildren(new Option('경계 경쟁자 중앙값','median'),...view.rivals.map(row=>new Option(`${row.name} · 예상 ${row.rank}위`,row.soopId)));
 select.value=rival;
 const name=view.selectedRival?.name||'경계 경쟁자 중앙값',latest=view.series.at(-1),recent=view.recent.at(-1),prior=view.recent.at(-2);
 text('trend-range',`${date(view.first.observedAt)}–${date(view.last.observedAt)} · ${view.series.length}회 관측`);
 text('trend-cohort',`${MODEL_NAMES[model]} 기준, 마지막 관측의 11월 말 예상 65–75위 중 띵귤을 제외한 ${view.rivals.length}명을 같은 명단으로 비교합니다.`);
 text('trend-member-names',view.rivals.map(row=>`${row.name}(${row.rank}위)`).join(' · '));
 text('trend-rival-legend',name);text('trend-selected-model',`${MODEL_NAMES[model]} · 관측 당시 같은 계산 방식`);
 text('trend-growth-title',mode==='total'?'실제 누적 유저 추이':'관측 사이의 하루 평균 증가');
 text('trend-growth-subtitle',mode==='total'?'각 관측 시점의 연간 누적 유저 · 띵귤은 기존 보정 반영':'두 관측 사이 증가량 ÷ 실제 경과일 · 방송일 평균이 아닙니다');
 text('trend-target-label',mode==='total'?'띵귤 누적 유저':'띵귤 하루 평균');
 text('trend-target-rate',mode==='total'?fmt(latest.targetUsers)+'명':recent?fmt(recent.targetDaily)+'명':'—');
 text('trend-rival-rate',mode==='total'?fmt(latest.rivalUsers)+'명':recent?fmt(recent.rivalDaily)+'명':'—');
 text('trend-rate-period',mode==='total'?`${stamp(latest.observedAt)}${latest.precision==='day'?' 수신 기준':' 관측 기준'} · 세로축은 표시된 누적값 범위에 맞춰 조정됩니다.`:recent?`${date(recent.intervalStart)}–${date(recent.observedAt)} 관측 사이 하루 평균`:'시각이 확인된 관측이 쌓이면 일평균을 표시합니다.');
 text('trend-rate-rival-label',view.selectedRival?.name||'경계 경쟁자 중앙값');
 let insight='누적 유저의 증가만으로 순위를 설명할 수는 없습니다. 경쟁자의 유저·별풍선과 남은 기간도 예상 순위에 함께 반영됩니다.';
 if(recent&&prior&&prior.targetDaily>0){
  const change=(recent.targetDaily/prior.targetDaily-1)*100;
  insight=`최근 구간 띵귤의 일평균은 앞 구간보다 ${Math.abs(change).toFixed(1)}% ${change>=0?'늘었습니다':'줄었습니다'}. 예상 순위에는 경쟁자의 실적과 남은 기간도 함께 반영됩니다.`;
 }
 text('trend-insight',insight);
 const growthRows=mode==='total'?view.series:view.series.filter(row=>row.targetDaily!==null&&row.rivalDaily!==null);
 if(growthRows.length){
  plot('trend-growth-chart',growthRows,[{key:mode==='total'?'targetUsers':'targetDaily',kind:'target'},{key:mode==='total'?'rivalUsers':'rivalDaily',kind:'rival'}],false,row=>{
   text('trend-growth-chart-readout',mode==='total'?`${stamp(row.observedAt)}${row.precision==='day'?' 수신 기준':''} · 띵귤 ${fmt(row.targetUsers)}명 / ${name} ${fmt(row.rivalUsers)}명`:
    `${date(row.intervalStart)}–${date(row.observedAt)} (${row.spanDays.toFixed(2)}일) · 띵귤 ${fmt(row.targetDaily)}명/일 / ${name} ${fmt(row.rivalDaily)}명/일`);
  });
 }else{el('trend-growth-chart').replaceChildren();text('trend-growth-chart-readout','집계 시각이 확인된 비교 구간이 없습니다.');}
 plot('trend-rank-chart',view.series,[{key:'forecastRank',kind:'target'},{key:'currentRank',kind:'current'}],true,row=>{
  text('trend-rank-chart-readout',`${stamp(row.observedAt)}${row.precision==='day'?' 수신 기준':''} · 현재 ${row.currentRank}위 / 11월 말 예상 ${row.forecastRank}위`);
 });
 text('trend-rank-summary',`${view.series[0].forecastRank}위 → ${latest.forecastRank}위`);
 text('trend-history-note',`유저는 방송 지표 누적이며 서로 다른 신규 시청자 수가 아닙니다. 점은 실제 자료가 들어온 때만 표시하며, 선은 관측 사이를 연결한 것입니다. ${view.unknownTimes?'10/20은 원본 집계 시각이 없어 수신 시각에 표시하고, 해당 구간의 일평균은 제외했습니다. ':''}경계 명단은 다음 자료에서 달라질 수 있습니다.`);
 const body=el('trend-table-body');body.replaceChildren();
 view.series.forEach(row=>{
  const tr=document.createElement('tr');
  [stamp(row.observedAt)+(row.precision==='day'?' 수신':''),fmt(row.targetUsers),fmt(row.rivalUsers),fmt(row.targetGain),fmt(row.rivalGain),row.targetDaily===null?'—':fmt(row.targetDaily),String(row.forecastRank)].forEach(value=>{
   const td=document.createElement('td');td.textContent=value;tr.append(td);
  });body.append(tr);
 });
}
export function updateTrends(data,safeModel){
 snapshot=data;if(!pinned)model=safeModel;
 if(!observer){
  document.querySelectorAll('[data-trend-model]').forEach(button=>button.addEventListener('click',()=>{
   model=button.getAttribute('data-trend-model');pinned=true;rival='median';render();
  }));
  document.querySelectorAll('[data-trend-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.getAttribute('data-trend-mode');render();}));
  el('trend-rival').addEventListener('change',event=>{rival=/** @type {HTMLSelectElement} */(event.target).value;render();});
  lastWidth=el('trends').getBoundingClientRect().width;
  observer=new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(Math.abs(width-lastWidth)>.5){lastWidth=width;render();}});observer.observe(el('trends'));
 }
 render();
}
