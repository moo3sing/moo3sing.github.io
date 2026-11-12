# 최근 추세 + 실제 증가 rolling forecast

> 2026-11-13 변경: 아래는 도입 당시 기록입니다. 현재는 오늘 남은 시간을 포함해 초 단위로 예측하며, 기존 추세의 평균도 실제 관측 간격을 사용합니다. [시간 계산 수정·검증 결과](calculation-audit-20261113.md)를 우선 참고하세요.

2026-10-02 KST 운영 적용. 기존 설계 확인, Trackify 월별/연간 의미 확인 후 구현했다. 기존 정규화 함수와 TOP70 binary search는 그대로 재사용하고 projected dataset을 만드는 함수를 주입한다. 유효 후보 98명 모두 동일한 계산을 적용하며, 비공개 후원 통계 2명은 기존대로 대기한다.

## 기존 production 공식

- Viewer: 현재 연간 actual + (보존된 9월 monthly viewer / 30) × 남은 날짜.
- Balloon: 현재 연간 actual + daily pace × 남은 날짜. 초기 daily pace는 9월 monthly balloon / 30. 7일 이상·6개 이상 일별 구간 확보 시 최근 최대 14일 robust daily pace 70% + 9월 pace 30%. 기존 robust 계산은 큰 증가를 max(기준 pace × 3, 중앙값 × 3)에서 제한했다.
- Donor: 현재 연간 고유 actual + 추정 신규 annual unique 증가. 초기 pace는 min(9월 monthly unique / 30, 9월 말 annual unique / 273). 충분한 daily history 이후 최근 pace 70% + 기존 pace 30%. 미래 날짜 i의 추가분은 pace / (1 + i/60)이며 합산 후 반올림.
- 기존 방식도 현재 actual은 이미 사용했다. 바뀐 부분은 모든 후보의 **미래 pace**다.

## 데이터 소스 및 의미

- 7/8/9월 viewer·balloon: Trackify `/ranking/summary?range=monthly&date=2026-MM&sortKey=uviewer&order=desc&page=1&size=200&ids=...`의 `uniqueViewers`, `balloon`. periodType/periodKey/중복 ID/정수 유효성을 확인한다. 월별 detail endpoint로 띵귤 표본을 교차 확인했다.
- 띵귤 월별 viewer / balloon: 7월 717,193 / 399,137, 8월 557,024 / 451,540, 9월 872,472 / 706,446.
- 현재 actual: `/streamer/{id}?granularity=month&period=2026`. viewer=`totalViewCountDelta`, donor=`monthDonors`, balloon=`monthBalloon`. `monthDonors`라는 이름만으로 월간이라고 판단하지 않고 요청 period에 따른 집계 의미를 사용한다.
- 월별 donor는 해당 월 unique이며, annual 요청은 해당 연도 unique다. 앞선 전체 donor ID 확인에서 월간 띵귤 717명, 연간 표본 두 계정 441/891명의 distinct ID와 집계가 맞았다. 평생 집계인 `cumulDonors`는 사용하지 않는다. 관련 기존 증거는 `docs/trackify-audit/`에 있다.
- 과거 7/8/9월의 **그해 최초 후원자 증가량**은 검증된 API 집계만으로 확보하지 못했다. 월간 unique를 더해 이를 만들지 않는다. Donor는 보수적 base와 검증된 annual unique actual 증가를 혼합하고 미래분을 estimated로 표시한다.
- viewer는 누적 시청 지표이며 연간 서로 다른 개인 수라고 표시하지 않는다.

## 새로운 계산

Viewer/balloon 기본 pace:

`JulyGain / 31 × .20 + AugustGain / 31 × .30 + SeptemberGain / 30 × .50`

10월 실제 증가 `current - immutable Sep30`, KST 달력 경과일 d를 사용한다.

`w = d / (d + 7)`

`actualDaily = max(0, actualGain / d)`

`futureDaily = baseDaily × (1-w) + actualDaily × w`

`projectedNov30 = current + round(futureDaily × remainingDays)`

오늘까지는 실제값만 사용한다. 미래는 내일부터 11/30까지이며, 오늘 남은 시간은 예측하지 않는다. 10/2에는 59일, actual weight 2/9, 10/15에는 15/22, 10/31에는 31/38이다. 수집되지 않은 오래된 actual을 새 관측처럼 날짜만 늘려 pace를 낮추지 않도록 `actualObservedAt`을 별도로 사용한다. 확인된 correction의 signed actual gain은 보존하고 음수 future growth만 0에서 제한한다.

Donor는 위 가중치에 기존 보수적 base를 넣고, 실제 증가로 annual unique 차이를 쓴다. 미래 중복을 고려한 기존 감소 가정 `Σ 1/(1+i/60)`도 유지한다. 월별 unique donor는 어느 단계에서도 더하지 않는다.

10월에는 그 시점 October rolling pace를 11월 예측에도 사용한다. 11월에는 보존된 마지막 October rolling pace와 `current - Oct31 observation`을 같은 경과일 가중치로 혼합한다. 10/31에는 값이 같아도 성공한 정기 관측을 게시해 마지막 관측을 남긴다. 이는 **정확한 자정 마감 baseline이 아니다**. 10/31 관측이 없으면 마지막 October trend만 사용하며 November actual 증가를 추정해 만들지 않는다. cron 추가/변경은 하지 않았다.

11/30 future days=0. 12/1 KST 이후 예측/목표 계산을 종료하고 마지막 actual을 보존한다. API는 12월 요청을 차단하므로 11/30 23:59:59 최종 확정치라고 주장하지 않는다.

## Fallback과 안전장치

- 세 달 존재: 20/30/50. 8/9월만: 40/60. 9월만: 100. 최근 월 부족: 기존 안전한 대체 pace.
- 이번 운영: 91명 세 달, 3명 8/9월, 4명 기존 fallback. 월별 부재는 0으로 채우지 않는다. 각 ID/metric/이유는 collection log 및 rollingForecast metadata에 저장한다.
- 8/9월 fallback: rud9281, 120510, seokwngud.
- 기존 fallback: y1026, yuambo, kiss281004, pookygamja.
- 기존 `source_corrections.py`는 바이트 그대로 보존. null/0 급락/큰 감소/불안정/오류를 차단하며, 작고 안정된 감소는 3회 detail 및 가능한 yearly summary 확인 후 current에만 반영한다. sccha21 2,318,049 → 2,290,254 회귀 테스트도 통과했다.
- 큰 양의 spike: 이전값의 25%, floor(viewer 250,000 / donor 250 / balloon 250,000), 기준 daily pace × 경과일 × 10 중 가장 큰 값을 넘는 증가를 추가 검증한다. detail 3회 전체 metric 일치와 가능한 yearly summary 일치 후 **원값 그대로** 사용한다. 불안정·timeout·교차 불일치면 전체 게시를 차단한다. donor yearly summary가 없어 detail 확인만 가능하다.
- 이전 정상 snapshot과 Sep30/support baseline을 수정하지 않는다. 일부 후보를 누락시켜 정규화하지 않는다.

## 기록 및 운영

- `rollingForecast`: 월별 실제 입력, 사용 월/가중치, fallback, donor 제한.
- `targetResults.dynamic.projectedRows[].forecast.metrics`: actual gain/pace, base pace, 실제 가중치, 미래 pace, 남은 예측.
- `actualObservedAt`, `forecastAsOf`: 검증된 관측 및 계산 기준일. 원본 값이 같아도 KST 날짜가 바뀌면 가중치/목표를 다시 계산해 게시한다.
- `collection-status.json`: 시도/성공/실제 수치 변경 시간을 구분한다. 같은 날 실제값도 같으면 `metrics_unchanged`, 새 forecast를 게시하면 `updated`이며 `lastDataChange`는 그대로다.
- `/var/lib/soop-ranking/history/daily/YYYY-MM-DD.json`: 그날 최신 게시 시점의 전체 actual/projected, metadata, 3개 target, safe. 과거 날짜 파일은 보존한다.
- correction history: `/var/lib/soop-ranking/history/corrections/`.
- 이번 코드/JSON backup: `/var/backups/soop-ranking/rolling-20261001T195143Z/`.
- 배포 파일/보호 해시: [rolling-deployment.json](rolling-deployment.json).
- 실제 collect 로그: [rolling-production-collect.log](rolling-production-collect.log).
- 같은 데이터·같은 날짜의 모든 모델/후보 비교: [rolling-comparison.md](rolling-comparison.md), [원시 비교 JSON](rolling-comparison.json).
- HTTPS 파일 일치/실제 화면/시각 검증: [rolling-verification.json](rolling-verification.json).

검증: JS 68개 + Python 56개 = 124개 통과. lint/typecheck/build 통과. 운영 main과 /ranking의 데스크톱/모바일·다크·오류·종료 상태/CSP 브라우저 검증 통과. baseline, 80/10/10 점수 코드, normalization/solver, 후보/제외, /ranking, cron, nginx 설정 해시 동일.

운영 수집 성공 2026-10-02 04:52:27 KST, 파일 mtime 동일. 원본 값의 마지막 변경은 04:24:55, 화면은 `데이터 기준 2026.10.02 04:24 KST`. 실제 수치가 같으므로 이전 시각 유지가 정상이며, 새로운 forecast는 게시됐다. 브라우저가 표시한 safe=2,667,964, 대표 순위=77, actual weight=22.2%.
