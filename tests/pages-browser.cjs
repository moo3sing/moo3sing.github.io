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
    const sourceSnapshot = JSON.parse(fs.readFileSync('assets/data/ranking.json','utf8'));
    const testTime = new Date(sourceSnapshot.updatedAt);
    await page.clock.setFixedTime(testTime);
    assert.equal((await page.goto(base + '/')).status(),200);
    await page.waitForSelector('#content:visible');
    assert.match(await page.locator('#safe').innerText(),/\d/);
    assert.match(await page.locator('#current-rank').innerText(),/\d/);
    assert.match(await page.locator('#rank').innerText(),/\d/);
    assert.equal(await page.locator('.models article').count(),4);
    assert.equal(await page.locator('.models article[data-experimental="false"]').count(),3);
    assert.match(await page.locator('[data-model-result="log"]').innerText(),/실험[\s\S]*SafeTarget 미포함/);
    const {rollingTargets} = await import('../assets/rolling-target.js');
    const expectedTargets = rollingTargets(sourceSnapshot,testTime);
    const {goalScenarios,conservativeModelGoals} = await import('../assets/goal-scenarios.js');
    const scenarios = goalScenarios(sourceSnapshot,testTime);
    assert.equal(await page.locator('#safe').innerText(),scenarios.original.safe.toLocaleString('ko-KR'));
    assert.equal(await page.locator('#recent-goal').innerText(),expectedTargets.safe.toLocaleString('ko-KR'));
    assert.equal(await page.locator('#conservative-goal').innerText(),scenarios.conservative.safe.toLocaleString('ko-KR'));
    assert.equal(await page.locator('#daily').innerText(),scenarios.original.daily.toLocaleString('ko-KR'));
    assert.match(await page.locator('#days').innerText(),/현재 시각부터 11월 30일 마감까지/);
    assert(!((await page.locator('#days').innerText()).includes('내일부터')));
    assert.match(await page.locator('#conservative-policy').innerText(),/띵귤은 낮은 추세 · 경쟁자는 높은 추세/);
    const {viewerOnlyReference} = await import('../assets/viewer-reference.js');
    const viewerReference = viewerOnlyReference(sourceSnapshot,expectedTargets);
    assert.equal(await page.locator('#viewer-reference-value').innerText(),viewerReference.remaining.toLocaleString('ko-KR')+'명');
    assert.match(await page.locator('#viewer-reference-note').innerText(),/경쟁자 최근 7일 추세 반영/);
    assert.match(await page.locator('#support-state').innerText(),/상·하위 경쟁자 추세 반영 · 전체 후보 100명/);
    assert.equal(await page.locator('#goal-updated-at').getAttribute('datetime'),sourceSnapshot.manualOverride?.observedAt||sourceSnapshot.updatedAt);
    assert.match(await page.locator('#goal-updated-at').innerText(),/\d+월 \d+일 (오전|오후) \d+:\d{2} KST/);
    assert.equal(await page.locator('#models-title').innerText(),'모델별 목표 · 보수적');
    for(const model of conservativeModelGoals(scenarios)){
      assert.equal(await page.locator(`[data-model-result="${model.model}"] > strong`).textContent(),model.remaining.toLocaleString('ko-KR')+'명');
      assert.equal(await page.locator(`[data-model-result="${model.model}"] .model-rank`).innerText(),'보수 예상 '+model.predictedRank+'위');
    }
    await page.waitForSelector('#trend-growth-chart svg');
    await page.waitForSelector('#trend-rank-chart svg');
    const {trendView} = await import('../assets/trend-data.js');
    const latestTrend = trendView(sourceSnapshot,expectedTargets.safeModel);
    const graphLast = latestTrend.series.at(-1);
    const stamp = value => {
      const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(part=>[part.type,part.value]));
      return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
    };
    assert.equal(latestTrend.last.observedAt,sourceSnapshot.collectionMode==='automatic'?sourceSnapshot.actualObservedAt||sourceSnapshot.updatedAt:sourceSnapshot.updatedAt);
    assert((await page.locator('#trend-range').innerText()).includes(stamp(graphLast.observedAt)));
    assert.equal(await page.locator('#trend-target-rate').innerText(),graphLast.targetUsers.toLocaleString('ko-KR')+'명');
    assert.equal(await page.locator('#trend-table-body > tr').count(),latestTrend.series.length);
    assert((await page.locator('#trend-table-body > tr').last().textContent()).includes(stamp(graphLast.observedAt)));
    assert((await page.locator('#trend-rank-chart-readout').innerText()).includes('예상 '+graphLast.forecastRank+'위'));
    await page.locator('[data-trend-mode="pace"]').click();
    await page.locator('#trend-growth-chart svg').press('Home');
    await page.locator('#trend-growth-chart svg').press('End');
    assert.equal(await page.locator('#trend-target-rate').innerText(),graphLast.targetDaily===null?'—':Math.round(graphLast.targetDaily).toLocaleString('ko-KR')+'명');
    assert.equal(await page.locator('#trend-rival-rate').innerText(),graphLast.rivalDaily===null?'—':Math.round(graphLast.rivalDaily).toLocaleString('ko-KR')+'명');
    await page.locator('[data-trend-mode="total"]').click();
    for(const width of [1440,1024,768,390,320]) {
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,'Home overflow at ' + width);
      const cards = await page.locator('.goal-scenarios > article').all();
      const boxes = await Promise.all(cards.map(card=>card.boundingBox()));
      assert.equal(boxes.length,3);
      assert(boxes.every(box=>Math.abs(box.y-boxes[0].y)<1),'Scenario cards must remain horizontal at ' + width);
      assert(boxes[0].x<boxes[1].x&&boxes[1].x<boxes[2].x);
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
    for(const model of ['rank','percentile','ratio','minmax','log']) {
      await page.locator(`[data-model="${model}"]`).click();
      assert.equal(await page.locator('#ranking-rows > tr[data-id]').count(),100);
      assert.match(await page.locator('#cutoff-name').innerText(),/\S/);
    }
    assert.match(await page.locator('#model-description').innerText(),/로그 정규화/);
    const projectedLogScore = await page.locator('tr[data-id="singgyul"] .score-value').innerText();
    await page.locator('[data-filter="boundary"]').click();
    await page.locator('#search').fill('띵귤');
    assert.equal(await page.locator('tr[data-id="singgyul"] .score-value').innerText(),projectedLogScore);
    await page.locator('#search').fill('');
    await page.locator('[data-filter="all"]').click();
    await page.locator('#method-inline').click();
    assert.match(await page.locator('#method-dialog').innerText(),/ln\(1\+x\)/);
    await page.locator('#method-dialog [data-close]').click();
    await page.locator('[data-basis="actual"]').click();
    assert.match(await page.locator('#basis-note').innerText(),/마지막 확인값/);
    await page.locator('#search').fill('띵귤');
    assert.equal(await page.locator('#ranking-rows > tr[data-id]').count(),1);
    await page.locator('#search').fill('');
    for(const width of [1440,768,390,320]) {
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,'Ranking overflow at ' + width);
      if(process.env.SCREENSHOT_DIR && [1440,390].includes(width)) {
        await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`pages-ranking-${width}.png`),fullPage:true});
      }
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
