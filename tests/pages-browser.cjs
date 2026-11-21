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
    const {rankingView} = await import('../assets/ranking-view.js');
    const {rankLabel} = await import('../assets/ranking-exceptions.js');
    for(const model of ['rank','percentile','ratio','minmax','log']){
      const target=rankingView(sourceSnapshot,model,'actual',testTime).ranked.find(row=>row.soopId==='singgyul');
      assert.equal(await page.locator(`[data-current-model="${model}"] strong`).innerText(),rankLabel(target.rankRange,target.predictedRank)+'위');
    }
    assert.equal(await page.locator('#current-ranks-observed').getAttribute('datetime'),sourceSnapshot.updatedAt);
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
      await page.evaluate(()=>window.scrollTo(0,0));
      const rankPanel=await page.locator('.current-ranks').boundingBox();
      assert(rankPanel.y>=0&&rankPanel.y+rankPanel.height<=900,'Current ranks visible without scrolling at '+width);
      const cards = await page.locator('.goal-scenarios > article').all();
      const boxes = await Promise.all(cards.map(card=>card.boundingBox()));
      assert.equal(boxes.length,3);
      assert(boxes.every(box=>Math.abs(box.y-boxes[0].y)<1),'Scenario cards must remain horizontal at ' + width);
      assert(boxes[0].x<boxes[1].x&&boxes[1].x<boxes[2].x);
      if(process.env.SCREENSHOT_DIR && [1440,390].includes(width)) {
        fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`pages-home-${width}.png`)});
      }
    }
    await page.locator('#theme').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    assert.equal((await page.goto(base + '/ranking')).status(),200);
    await page.waitForSelector('#table-wrap:visible');
    assert.equal(await page.locator('#target-model-select option').allTextContents().then(items=>items.join(', ')),'순위형, 백분위, 1위 대비, Min-Max, Log · 실험');
    async function checkTargetSummary(snapshot,model){
      for(const basis of ['actual','forecast']){
        const target=rankingView(snapshot,model,basis,testTime).ranked.find(row=>row.soopId==='singgyul');
        assert.equal(await page.locator(`#target-${basis}-rank`).innerText(),rankLabel(target.rankRange,target.predictedRank)+'위');
      }
    }
    assert.equal(await page.locator('#ranking-rows > tr[data-id]').count(),100);
    for(const model of ['rank','percentile','ratio','minmax','log']) {
      await page.locator(`[data-model="${model}"]`).click();
      assert.equal(await page.locator('#ranking-rows > tr[data-id]').count(),100);
      assert.match(await page.locator('#cutoff-name').innerText(),/\S/);
      await checkTargetSummary(sourceSnapshot,model);
      assert.equal(await page.locator('#target-model-select').inputValue(),model);
      assert.equal(await page.locator('#target-forecast-card').getAttribute('data-active'),'true');
    }
    assert.match(await page.locator('#model-description').innerText(),/로그 정규화/);
    await page.locator('#target-model-select').selectOption('ratio');
    await checkTargetSummary(sourceSnapshot,'ratio');
    assert.equal(await page.locator('[data-model="ratio"]').getAttribute('aria-pressed'),'true');
    await page.locator('#target-model-select').selectOption('log');
    const projectedLogScore = await page.locator('tr[data-id="singgyul"] .score-value').innerText();
    await page.locator('#search').fill('띵귤');
    await checkTargetSummary(sourceSnapshot,'log');
    assert.equal(await page.locator('tr[data-id="singgyul"] .score-value').innerText(),projectedLogScore);
    await page.locator('#search').fill('');
    // The target can move outside the 60–80 boundary filter as new data arrives.
    const boundaryCandidate = rankingView(sourceSnapshot,'log','forecast',testTime).ranked.find(row=>row.predictedRank===70);
    assert(boundaryCandidate);
    const boundaryScore = page.locator(`tr[data-id="${boundaryCandidate.soopId}"] .score-value`);
    const fullCohortScore = await boundaryScore.innerText();
    await page.locator('[data-filter="boundary"]').click();
    await page.locator('#search').fill(boundaryCandidate.soopId);
    assert.equal(await boundaryScore.innerText(),fullCohortScore);
    await page.locator('#search').fill('');
    await page.locator('[data-filter="all"]').click();
    await page.locator('#method-inline').click();
    assert.match(await page.locator('#method-dialog').innerText(),/ln\(1\+x\)/);
    await page.locator('#method-dialog [data-close]').click();
    await page.locator('[data-basis="actual"]').click();
    for(const model of ['rank','percentile','ratio','minmax','log']){
      await page.locator(`[data-model="${model}"]`).click();
      await checkTargetSummary(sourceSnapshot,model);
      assert.equal(await page.locator('#target-actual-card').getAttribute('data-active'),'true');
    }
    assert.match(await page.locator('#basis-note').innerText(),/마지막 확인값/);
    await page.locator('#search').fill('띵귤');
    assert.equal(await page.locator('#ranking-rows > tr[data-id]').count(),1);
    await page.locator('#search').fill('');
    await page.locator('[data-filter="boundary"]').click();
    await page.locator('#search').fill('no-such-streamer');
    await checkTargetSummary(sourceSnapshot,'log');
    await page.locator('#target-detail').click();
    assert.match(await page.locator('#detail-dialog').innerText(),/띵귤/);
    await page.locator('#detail-dialog [data-close]').click();
    await page.locator('#search').fill('');
    await page.locator('[data-filter="all"]').click();
    const refreshed=structuredClone(sourceSnapshot);
    refreshed.streamers.find(row=>row.soopId==='singgyul').cumulativeUsers+=1000000;
    await page.route('**/assets/data/ranking.json',route=>route.fulfill({json:refreshed}));
    await page.locator('#refresh').click();
    await page.waitForFunction(expected=>document.querySelector('tr[data-id="singgyul"] .users-cell')?.textContent.includes(expected.toLocaleString('ko-KR')),refreshed.streamers.find(row=>row.soopId==='singgyul').cumulativeUsers);
    await checkTargetSummary(refreshed,'log');
    await page.unroute('**/assets/data/ranking.json');
    await page.locator('#refresh').click();
    await page.waitForFunction(expected=>document.querySelector('tr[data-id="singgyul"] .users-cell')?.textContent.includes(expected.toLocaleString('ko-KR')),sourceSnapshot.streamers.find(row=>row.soopId==='singgyul').cumulativeUsers);
    await checkTargetSummary(sourceSnapshot,'log');
    for(const width of [1440,768,390,320]) {
      await page.setViewportSize({width,height:900});
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,'Ranking overflow at ' + width);
      await page.evaluate(()=>window.scrollTo(0,0));
      const summary=await page.locator('#target-summary').boundingBox();
      assert(summary.y>=0&&summary.y+summary.height<=900,'Target summary visible without scrolling at '+width);
      if(process.env.SCREENSHOT_DIR && [1440,390].includes(width)) {
        await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,`pages-ranking-${width}.png`)});
      }
    }
    const actual = await (await context.request.get(base + '/assets/data/ranking.json')).json();
    await page.locator('#theme').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    await checkTargetSummary(sourceSnapshot,'log');
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'pages-ranking-dark.png')});
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
