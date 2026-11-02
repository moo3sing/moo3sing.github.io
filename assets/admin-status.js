const format=value=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value))+' KST';
const set=(id,value)=>{document.getElementById(id).textContent=value;};
try{
 const stored=localStorage.getItem('theme');
 document.documentElement.dataset.theme=stored||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
}catch{}
async function load(){
 try{
  const response=await fetch('/assets/data/collection-status.json',{cache:'no-store'});
  if(!response.ok)throw new Error('Status unavailable');
  const status=await response.json(),schedule=status.automaticCollection||{};
  const until=schedule.blockedUntil||status.blockedUntil;
  const blocked=until&&Date.parse(until)>Date.now();
  set('auto-state',blocked?'자동 수집 차단 중 · 마지막 확인 자료를 보존합니다.':'자동 수집 · 매일 03:15 KST');
  set('auto-time',blocked?'차단 만료 '+format(until):status.lastCollectionAttempt?'마지막 확인 '+format(status.lastCollectionAttempt):'');
  set('auto-next',schedule.nextEligibleDailyKST?'다음 수집 가능 '+format(schedule.nextEligibleDailyKST):'');
 }catch{set('auto-state','자동 수집 상태를 불러오지 못했습니다. GitHub Actions 기록을 확인해 주세요.');}
}
load();
