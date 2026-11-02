const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const fixture=JSON.parse(fs.readFileSync('/tmp/soop-manual-preview.json'));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({timezoneId:'Asia/Seoul',viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/assets/data/ranking.json',route=>route.fulfill({json:fixture}));
 await page.goto('http://127.0.0.1:4173/');await page.waitForSelector('#content:visible');
 assert.equal(await page.locator('#safe').innerText(),fixture.targetResults.dynamic.safe.toLocaleString('ko-KR'));
 assert.match(await page.locator('#updated').innerText(),/띵귤 데이터 기준.*경쟁자 데이터 기준/);
 assert.match(await page.locator('#manual-note').innerText(),/수동 갱신/);
 assert.equal(await page.locator('#manual-note').isVisible(),true);
 assert.equal(await page.locator('#freshness').innerText(),'');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);await browser.close();console.log('manual partial UI PASS');
})().catch(e=>{console.error(e);process.exit(1)});
