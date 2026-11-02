const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{
 const root='https://taehyeon-masu.xyz',path='/var/www/singdboo-site/public/assets/data/ranking.json';
 const response=await fetch(root+'/assets/data/ranking.json',{cache:'no-store'});assert.equal(response.status,200);
 const bytes=Buffer.from(await response.arrayBuffer());assert.equal(sha(bytes),sha(fs.readFileSync(path)));
 const data=JSON.parse(bytes),before=JSON.parse(fs.readFileSync('docs/rolling-before/ranking.json'));
 for(const key of ['simulationBaseline','supportBaseline','exclusions'])assert.deepEqual(data[key],before[key]);
 const deployment=JSON.parse(fs.readFileSync('docs/rolling-deployment.json'));
 for(const [p,h] of Object.entries(deployment.protectedHashes))assert.equal(sha(fs.readFileSync(p)),h);
 const moduleResponses=[];
 for(const name of ['index.html','assets/simulation-ui.js?v=20261002-rolling','assets/rolling-target.js?v=20261002-rolling','assets/dynamic-target.js?v=20261002-rolling']){
  const r=await fetch(root+'/'+name,{cache:'no-store'});assert.equal(r.status,200);
  assert.equal(sha(Buffer.from(await r.arrayBuffer())),sha(fs.readFileSync('/var/www/singdboo-site/public/'+name.split('?')[0])));
  moduleResponses.push({name,status:r.status,cacheControl:r.headers.get('cache-control')});
 }
 const status=JSON.parse(fs.readFileSync('/var/www/singdboo-site/public/assets/data/collection-status.json'));
 const day=data.forecastAsOf,history=JSON.parse(fs.readFileSync('/var/lib/soop-ranking/history/daily/'+day+'.json'));
 assert.equal(history.forecastMethod,'recent_trend_actual_rolling');assert.equal(history.projectedRows.length,98);
 assert.equal(history.safeTarget,data.targetResults.dynamic.safe);
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({timezoneId:'Asia/Seoul'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(root);await page.waitForSelector('#content:visible');
 const display=await page.evaluate(()=>Object.fromEntries(['safe','current','rank','updated','pace-state','limits'].map(id=>[id,document.getElementById(id).textContent])));
 assert.equal(display.safe,data.targetResults.dynamic.safe.toLocaleString('ko-KR'));
 assert.equal(display.current,data.targetResults.dynamic.currentUsers.toLocaleString('ko-KR')+'명');assert.match(display['pace-state'],/22.2%/);
 assert.deepEqual(errors,[]);await browser.close();
 const report={verifiedAt:new Date().toISOString(),jsonURL:response.url,jsonStatus:response.status,jsonSha256:sha(bytes),serverMtime:fs.statSync(path).mtime.toISOString(),cacheControl:response.headers.get('cache-control'),sourceUpdatedAt:data.updatedAt,actualObservedAt:data.actualObservedAt,status,historyPath:'/var/lib/soop-ranking/history/daily/'+day+'.json',historyCandidates:history.projectedRows.length,baselinePreserved:true,protectedHashesUnchanged:true,moduleResponses,display};
 fs.writeFileSync('docs/rolling-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
