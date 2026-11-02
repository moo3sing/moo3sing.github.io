# 띵귤 TOP 70 진입 시뮬레이션

- 메인: https://taehyeon-masu.xyz/
- 기존 전체 예상 랭킹: https://taehyeon-masu.xyz/ranking
- 운영 방식: 기존 정적 HTML/CSS/JS + Nginx. 새 서버 앱·유료 서비스 없음.

## 구현 파일

| 위치 | 역할 |
|---|---|
| `index.html` | 띵귤 중심 메인 대시보드·안내·접근성 구조 |
| `ranking.html` | 기존 전체 랭킹, 메인으로 돌아가는 링크 추가 |
| `assets/simulation.js` | 9월 말 고정 후원 점수·월간 추세 예측·최소 필요치 이진 탐색 |
| `assets/simulation-ui.js` | 모델 전환·목표 입력·SVG 차트·익명 표시·오류/로딩/다크 모드 |
| `assets/simulation.css` | 기존 스타일 토큰을 이용한 반응형 화면 |
| `assets/simulation-config.js` | 대상·경쟁 구간·익명 기본값·기본 모델 |
| `services/trackify.py` | 공개 월간 요약 및 누락 계정의 월간 상세 수집 |
| `scripts/collect.py` | `simulationBaseline`을 9월 종료 후 고정하고 월간 forecast를 정기 수집에 통합 |
| `nginx/https.conf`, `nginx/http.conf` | `/ranking`, `/ranking/`, `/ranking.html` 경로 |
| `ops/simulation-release.py` | 이전 파일 백업·수집 검증·배포·실패 시 복구 |

## 계산 방식

1. `simulationBaseline.rows`에 2026년 9월 30일 종료 시점의 스트리머별 누적 유저·후원자·별풍선 원시값을 보존합니다. 종료 전에는 최신 관측값을 잠정 표시하고, 한국시간 10월 1일 00:05 전용 수집에서 `locked`로 고정한 뒤 이후 연간 snapshot이 바뀌어도 덮어쓰지 않습니다.
2. 순위형은 baseline 후원자/별풍선 순위 점수, 1위 대비형은 baseline 최댓값 대비 점수, Min-Max는 baseline 최솟값·최댓값 기준 점수를 스트리머별로 한 번 계산합니다. 모든 스트리머에게 같은 상수를 넣지 않습니다.
3. 후보별 미래 누적 유저 = 9월 말 누적 유저 + 9월 월간 실적 × 2개월입니다. 후원자·별풍선 raw 값과 모델별 후원 점수는 10월·11월 동안 고정합니다.
4. 띵귤의 추가 누적 유저만 바꾸면서 **후보 전체**의 viewer 점수와 최종 순위를 다시 계산합니다. 후원 점수는 다시 정규화하지 않습니다.
5. 상한을 지수 탐색한 뒤 이진 탐색으로 `예상 순위 <= 70`인 최소 정수 추가 누적 유저를 찾습니다. 경계의 1명 차이와 기존 동률 정렬까지 반영합니다. 최대 탐색 범위는 1조 명이며 찾지 못하면 산정 범위 밖을 표시합니다.
6. 월평균 필요치는 최소 추가 유저 ÷ 남은 달 수, 필요 변화율은 (월평균 필요치 ÷ 최근 월 실적 − 1) × 100입니다. 기준 실적이 0이면 증가율은 계산하지 않습니다. 월별 정수 배분 합계는 최소 목표와 정확히 일치합니다.

순위형/1위 대비형/Min-Max를 같은 크기의 주 탭과 3열 비교 카드로 배치했습니다. 백분위형은 기존 전체 랭킹에서 계속 제공합니다. 현 추세·띵귤만 +10/20/30%·최소 목표·직접 입력을 지원합니다. 직접 입력에서도 경쟁자들은 9월 월간 추세를 유지합니다. 차트는 25개 표본의 추정 순위와 정확한 최소 목표/선택값을 표시하며, 확률을 산출하지 않습니다.

## 경쟁 구간과 익명 표시 설정

`assets/simulation-config.js`에서 다음을 수정한 뒤 빌드/배포합니다.

```js
competitionFrom: 50,
competitionTo: 90,
anonymousDefault: true,
defaultModel: 'ratio',
```

- 예: 55~85위를 보려면 `competitionFrom: 55`, `competitionTo: 85`.
- 처음부터 이름을 표시하려면 `anonymousDefault: false`.
- 경쟁 구간은 **선택 모델의 현재 예상 순위**로 정합니다. 띵귤 행은 별도로 항상 표시합니다.
- 구간은 비교 테이블 범위만 바꿉니다. 전체 정규화/최종 TOP 70 계산 모집단은 줄이지 않습니다.
- 기본 익명이며 행별 눈 버튼/전체 공개·전체 숨김 버튼을 제공합니다. 네이티브 버튼, `aria-pressed`, Enter/Space 조작 및 행 재렌더링 뒤 초점 복귀를 지원합니다.
- 익명화는 화면 표시 기능이며 공개 snapshot 자체의 데이터를 감추는 기능은 아닙니다.

## 데이터 한계와 오류 처리

월간 summary의 `uniqueViewers`를 사용하고, 누락된 계정은 월간 overview(`granularity=day&period=YYYY-MM`)의 `totalViewCountDelta`를 확인합니다. 기준 월도 없으면 최대 3개월 전까지 실제 공개 월을 조회하며 `referenceMonth`/`fallback`을 저장합니다. 대체 월은 상단 안내 및 해당 행에 표시합니다. 과거 활동이 최근 활동을 대표하지 못할 수 있습니다.

배포 시점에는 100명 중 4명이 6~8월 실적으로 대체되었습니다. 띵귤의 9월 실적은 872,472명입니다. 후원 통계 비공개 2명은 기존과 동일하게 산정 대기이며, 공개값을 보유한 98명 기준 잠정 계산입니다. 누락을 0으로 채우지 않습니다. 9월 30일 종료 전에는 `simulationBaseline.status=provisional`이며, 종료 후 최초 정상 수집에서 `locked`가 됩니다.

월간 자료를 확보하지 못하면 메인 계산을 중단하고 전체 랭킹 링크를 제공합니다. 월간 수집 실패가 기존 연간 랭킹 수집을 중단시키지 않습니다. 연간 수집 실패의 마지막 성공 snapshot 보존, 6시간 캐시, 중복 방지 파일 잠금, 12월 이후 API 중단 정책은 유지했습니다.

## 검증

- 단위 테스트 46개: 기존 랭킹 11 + 시뮬레이션 20 + Python 수집/월간 15.
- `npm run lint`, `npm run typecheck`, `npm run build` 통과.
- 기존 브라우저 회귀: 4개 모델, 경계, 검색, 다이얼로그/키보드, 비공개 통계, 5개 화면 폭, 다크 모드, stale/오류/재시도, CSP.
- 새 메인 브라우저: 동등한 핵심 3개 모델, 고정 후원 점수 표, 최소치/1명 미달 경계, 행별·전체 익명 공개, 키보드, 수동 입력, 320~1440px, 다크 모드, 월간 누락/빈 데이터/기간 종료/서버 오류와 재시도, `/ranking` 이동, CSP.
- 기존 `assets/ranking.js` SHA-256 유지: `8539dec19c2c206bf3160271afc4c5ab1ac35e6b1e7fda63baa05303324fb95e`.
- `data/excluded-streamers.json` 운영 파일과 바이트 일치 확인.
- 스크린샷: `docs/simulation-previews/`, 운영 실측: `docs/simulation-results.json`.

## 운영과 복구

최신 배포와 백업 경로는 `docs/simulation-deployment.json`에 기록합니다. 기존 cron 파일 하나에서 6시간마다 연간+월간 데이터를 수집하고, 2026-10-01 00:05 KST에 9월 말 기준을 고정하는 날짜 지정 실행을 한 번 추가했습니다. 같은 항목은 2027년 이후 수집 기간 검증에서 네트워크 없이 종료됩니다. 이번 배포의 되돌리기는 직전 메인과 수집기를 복원하며 cron은 별도 백업본으로 되돌릴 수 있습니다.

```sh
sudo python3 ops/simulation-release.py --rollback <simulation-deployment.json의 backup 경로>
```

복구 도구는 변경 전 파일·소유자·권한을 복원하고 이번에만 추가한 파일을 제거합니다. 정상 운영 상태를 되돌리는 실제 rollback은 실행하지 않았습니다. 초기 팬 사이트까지 돌아가는 과거 배포의 복구 절차와 구분해야 합니다.
