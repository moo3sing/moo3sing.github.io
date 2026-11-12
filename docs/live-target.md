# Live TOP 70 target — 2026-10-01

> 2026-11-13 변경: 아래는 도입 당시 기록입니다. 현재는 오늘 남은 시간을 포함해 초 단위로 예측하며, 기존 추세의 평균도 실제 관측 간격을 사용합니다. [시간 계산 수정·검증 결과](calculation-audit-20261113.md)를 우선 참고하세요.

Main page uses assets/live-target.js, reusing existing support scoring, full-cohort viewer normalization, tie-breaking and integer threshold search. The ranking page and its scoring module are unchanged.

- Preserve production simulationBaseline and September forecast byte-equivalent JSON values.
- Fixed cohort: all 100 baseline accounts; 98 scoreable, 2 support-private accounts remain pending.
- Annual summary.uniqueViewers updates only cumulativeUsers. No September double addition. Missing summary accounts use annual overview.totalViewCountDelta with ID validation; missing values abort publication.
- Summary is fetched once per hour (:15 UTC/KST); complete summary needs no 100-account detail crawl. Existing 0.4 s pacing, 20 s timeout, three attempts and backoff retained.
- Unchanged viewers: no snapshot write, no rebuild. Poll attempts/unchanged results are recorded in the private collection log. Browser fetches the published JSON once a minute, never Trackify directly.
- Forecast: current annual actual + September monthly gain / 30 × future KST calendar days. Today is observed actual only; tomorrow through Nov 30 inclusive are forecast. On Oct 1 this is 60 days (30 October, 30 November).
- Current predicted rank includes the target's baseline future pace. Hero rank uses the model that defines the maximum required remaining target, explicitly labelled.
- Actual gain and remaining target are separate; no misleading moving-target progress percentage. Daily/delta statistics are not invented.
- Existing explicit fallback months for 4 accounts are preserved; not represented as verified September actuals.
- Final special poll Nov 30 23:58 KST, even unchanged data gets a finalObservationAt. All December network requests stop. Dec 1 browser switches to evaluation ended using current KST time, even with a November JSON. Annual endpoint cannot guarantee the exact 23:59:59 close; final observation is labelled honestly.

## Validation

62 unit tests: ranking 11, legacy simulation 20, live targets 11, Python collector/adapter 20. Exact threshold boundaries verified for each model; rank model can jump from 72 to 70 under preserved tie rules.

npm test / npm run lint / npm run typecheck / npm run build.
Browser: npm run test:simulation-browser and npm run test:browser. Runtime available under /tmp/node-v22.22.0-linux-x64/bin; browser dependencies use LD_LIBRARY_PATH=/tmp/ranking-libs/root/usr/lib/x86_64-linux-gnu and FONTCONFIG_FILE=/tmp/ranking-fonts.conf.

## Deployment

ops/live-release.py backs up changed files and cron, acquires the existing snapshot lock, asserts baseline/pace equality and snapshot ordering, installs collector/assets/JSON, then swaps index last. It verifies the four existing ranking files retain their hashes. No nginx configuration changes. docs/live-deployment.json records backup and release paths.

For rollback use the recorded backup manifest: restore each existing path from its numbered copy with original uid/gid/mode, and remove newly introduced paths while holding assets/data/ranking.lock. Preserve current viewer data if rolling back UI only.
