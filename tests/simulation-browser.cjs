const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=process.env.BASE_URL||'http://127.0.0.1:4173';
const snapshot=JSON.parse(fs.readFileSync('assets/data/ranking.json'));
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1050},colorScheme:'light'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 assert.equal((await page.goto(base)).status(),200);
 await page.waitForSelector('#sim-content:not([hidden])');
 assert.match(await page.title(),/띵귤/);
 assert.equal(await page.locator('h1').innerText(),'TOP 70 진입 예상 데이터');
 assert.equal(await page.locator('.model-summary-card').count(),3);
 assert.equal(await page.locator('#sim-custom-rank').innerText(),'70위');
 const minimum=Number((await page.locator('#sim-needed').innerText()).replaceAll(',',''));
 await page.locator('#sim-additional').fill(String(minimum-1));
 assert.equal(await page.locator('#sim-custom-rank').innerText(),'71위');
 await page.locator('[data-preset=minimum]').click();
 assert.match(await page.locator('[data-reveal]').first().innerText(),/경쟁자/);
 await page.locator('[data-reveal]').first().focus();await page.keyboard.press('Enter');
 assert.equal(await page.locator('[data-reveal]').first().getAttribute('aria-pressed'),'true');
 await page.locator('#sim-reveal-all').click();
 assert.equal(await page.locator('[data-reveal][aria-pressed=false]').count(),0);
 await page.locator('#sim-reveal-all').click();
 assert.equal(await page.locator('[data-reveal][aria-pressed=true]').count(),0);
 for(const model of ['rank','ratio','minmax']){
  await page.locator(`[data-sim-model=${model}]`).click();
  assert.equal(await page.locator('#sim-custom-rank').innerText(),'70위');
 }
 assert.match(await page.locator('.competition-table thead').innerText(),/9월 말 후원 점수/);
 await page.locator('#sim-additional').fill('-1');
 assert.equal(await page.locator('#sim-additional').getAttribute('aria-invalid'),'true');
 await page.locator('[data-preset="1.2"]').click();
 assert.equal(await page.locator('#sim-additional').getAttribute('aria-invalid'),'false');
 await page.locator('[data-preset=minimum]').click();
 fs.mkdirSync('docs/simulation-previews',{recursive:true});
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:'docs/simulation-previews/desktop.png',fullPage:true});
 for(const width of [1024,768,390,320]){
  await page.setViewportSize({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Overflow ${width}`);
  if(width===390)await page.screenshot({path:'docs/simulation-previews/mobile.png',fullPage:true});
 }
 await page.locator('#sim-theme').click();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await page.setViewportSize({width:1440,height:1050});
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:'docs/simulation-previews/dark.png',fullPage:true});
 assert.deepEqual(errors,[]);
 const state=await browser.newPage();
 for(const [patch,message] of [[{forecast:null},/월간 데이터/],[{streamers:[],simulationBaseline:{status:'locked',rows:[]}},/100명/],[{updatedAt:'2026-12-01T00:00:00+09:00'},/기간이 종료/]]){
  await state.route('**/assets/data/ranking.json',route=>route.fulfill({json:{...snapshot,...patch}}));
  await state.goto(base);await state.waitForSelector('#sim-error:not([hidden])');
  assert.match(await state.locator('#sim-error').innerText(),message);
  assert.equal(await state.locator('#sim-content').isVisible(),false);
  await state.unroute('**/assets/data/ranking.json');
 }
 await state.route('**/assets/data/ranking.json',route=>route.fulfill({status:503,body:'unavailable'}));
 await state.reload();await state.waitForSelector('#sim-error:not([hidden])');
 await state.unroute('**/assets/data/ranking.json');await state.locator('#sim-retry').click();await state.waitForSelector('#sim-content:not([hidden])');
 await page.locator('a.ranking-link').click();await page.waitForSelector('.ranked-row');
 assert.equal(await page.locator('.ranked-row').count(),100);
 await browser.close();console.log('Simulation browser PASS: 3 equal primary models, exact boundary, fixed-support table, anonymity/keyboard, input, responsive, theme, CSP, fallback/retry, ranking route');
})().catch(e=>{console.error(e);process.exit(1)});
