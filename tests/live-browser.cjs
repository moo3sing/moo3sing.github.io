const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const root=process.env.BASE_URL||'http://127.0.0.1:4173/';
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({timezoneId:'Asia/Seoul',viewport:{width:1440,height:1000},colorScheme:'light'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(root);await page.waitForSelector('#content:visible');
 assert.equal(await page.locator('.models article').count(),4);
 assert.match(await page.locator('#safe').innerText(),/\d/);
 assert.match(await page.locator('#support-state').innerText(),/ON/);
 await page.locator('summary').click();
 assert.match(await page.locator('#donor-state').innerText(),/실제 데이터/);
 assert.match(await page.locator('#support-forecast').innerText(),/예상/);
 await page.locator('summary').click();
 assert.match(await page.locator('#updated').innerText(),/KST/);
 assert.equal(await page.locator('details').getAttribute('open'),null);
 const safe=await page.locator('#safe').boundingBox();assert(safe.y+safe.height<600);
 fs.mkdirSync('docs/live-previews',{recursive:true});
 for(const width of [1440,1024,768,390,320]){
  await page.setViewportSize({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow '+width);
  if(width===1440||width===390)await page.screenshot({path:`docs/live-previews/${width}.png`,fullPage:true});
 }
 await page.locator('#theme').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await page.screenshot({path:'docs/live-previews/dark.png',fullPage:true});
 const snapshot=JSON.parse(fs.readFileSync('assets/data/ranking.json'));
 await page.route('**/assets/data/ranking.json',route=>route.fulfill({json:{...snapshot,status:'stale'}}));await page.reload();await page.waitForSelector('#content:visible');assert.match(await page.locator('#status').innerText(),/실패/);
 await page.clock.install({time:new Date('2026-12-01T00:00:00+09:00')});await page.reload();await page.waitForSelector('#content:visible');assert.equal(await page.locator('#safe').innerText(),'심사 종료');
 await page.route('**/assets/data/ranking.json',route=>route.fulfill({status:503,body:'Unavailable'}));await page.reload();await page.waitForSelector('#retry:visible');assert.equal(await page.locator('#content').isVisible(),false);
 assert.deepEqual(errors,[]);await browser.close();console.log('Live page: desktop/mobile/dark/error/stale/end/CSP PASS');
})().catch(e=>{console.error(e);process.exit(1)});
