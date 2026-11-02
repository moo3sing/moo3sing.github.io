const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');

const root = path.resolve('_site');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.txt':'text/plain'};
const server = http.createServer((req,res) => {
  let file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep) && file !== root) {res.writeHead(403);res.end();return;}
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!new URL(req.url, 'http://localhost').pathname.endsWith('/')) {
      res.writeHead(301,{Location:new URL(req.url,'http://localhost').pathname + '/'});res.end();return;
    }
    file = path.join(file,'index.html');
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)] || 'application/octet-stream'});
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = process.env.BASE_URL || `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
  try {
    const context = await browser.newContext({timezoneId:'Asia/Seoul',viewport:{width:1440,height:1000},colorScheme:'light'});
    const page = await context.newPage();
    const errors = [];const failed = [];const externalAPI = [];
    page.on('pageerror',error => errors.push(error.message));
    page.on('response',response => {if(response.status() >= 400)failed.push(response.url());});
    page.on('request',request => {if(request.url().includes('trackify.kr/api/'))externalAPI.push(request.url());});
    await page.clock.install({time:new Date('2026-11-02T12:00:00+09:00')});
    assert.equal((await page.goto(base + '/')).status(),200);
    await page.waitForSelector('#content:visible');
    assert.match(await page.locator('#safe').innerText(),/\d/);
    assert.match(await page.locator('#current-rank').innerText(),/\d/);
    assert.match(await page.locator('#rank').innerText(),/\d/);
    assert.equal(await page.locator('.models article').count(),3);
    await page.waitForSelector('#trend-growth-chart svg');
    await page.waitForSelector('#trend-rank-chart svg');
    await page.locator('[data-trend-mode="pace"]').click();
    await page.locator('[data-trend-mode="total"]').click();
    for(const width of [1440,1024,768,390,320]) {
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,'Home overflow at ' + width);
      if(process.env.SCREENSHOT_DIR && [1440,390].includes(width)) {
        fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`pages-home-${width}.png`),fullPage:true});
      }
    }
    await page.locator('#theme').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    assert.equal((await page.goto(base + '/ranking')).status(),200);
    await page.waitForSelector('#table-wrap:visible');
    assert.equal(await page.locator('#ranking-rows > tr[data-id]').count(),100);
    for(const model of ['rank','percentile','ratio','minmax']) {
      await page.locator(`[data-model="${model}"]`).click();
      assert.equal(await page.locator('#ranking-rows > tr[data-id]').count(),100);
      assert.match(await page.locator('#cutoff-name').innerText(),/\S/);
    }
    await page.locator('[data-basis="actual"]').click();
    assert.match(await page.locator('#basis-note').innerText(),/마지막 확인값/);
    await page.locator('#search').fill('띵귤');
    assert.equal(await page.locator('#ranking-rows > tr[data-id]').count(),1);
    await page.locator('#search').fill('');
    for(const width of [1440,768,390,320]) {
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,'Ranking overflow at ' + width);
    }
    const actual = await (await context.request.get(base + '/assets/data/ranking.json')).json();
    const source = JSON.parse(fs.readFileSync('assets/data/ranking.json','utf8'));
    assert.deepEqual(actual,source);
    for(const route of ['/privacy','/assets/ranking-favicon.svg','/robots.txt','/admin/']) {
      assert.equal((await context.request.get(base + route)).status(),200,route);
    }
    await page.goto(base + '/admin/');
    await page.waitForFunction(() => !document.getElementById('auto-state').textContent.includes('확인하고 있습니다'));
    const automaticStatus = await page.locator('#auto-state').innerText();
    assert.match(automaticStatus,/자동 수집/);
    assert.equal(automaticStatus.includes('불러오지'),false);
    if(!process.env.BASE_URL) {
      for(const route of ['/admin/server.py','/services/trackify.py','/data/viewer-adjustments.json','/.env']) {
        assert.equal((await context.request.get(base + route)).status(),404,route);
      }
    }
    assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.deepEqual(externalAPI,[]);
    console.log('Pages: routes, unchanged JSON, home goals/ranks/charts, all ranking models, mobile, dark mode, no exposed backend, no API calls: PASS');
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;}).finally(() => server.close());
