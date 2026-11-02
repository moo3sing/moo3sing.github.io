# 초기 구현 검증 기록 — 2026-09-30 KST

이 문서는 최초 구현 당시 기록입니다. 이후 실제 배포와 cron 등록을 완료했으며 최신 상태는 [운영 기록](operations.md)을 참고하세요.

## 기존 프로젝트

HTML/CSS/JavaScript 정적 사이트, Nginx, 수동 파일 배포. React/Next/Vite 및 기존 package manager/빌드/환경변수 설정 없음. 도메인 `singdboo.xyz`, public root `/var/www/singdboo-site/public`. 기존 자산과 개인정보 페이지 보존. 원본은 프로젝트 외부에 압축 백업.

## Trackify 실측

- 쿠키/Authorization 없이 공개 JSON HTTP 200 확인.
- Python 기본 User-Agent에는 HTTP 403 응답. 서비스 이름을 명시한 `StreamerIndex/1.0 (public-statistics; 6-hour-cache)` 요청으로 HTTP 200 확인. 쿠키나 세션 저장 없음.
- `/streamer/khm11903?granularity=month&period=2026`: `totalViewCountDelta=113705545`, `monthBalloon=11752539`, `monthDonors=42876`.
- Playwright로 실제 상세 화면의 ‘년별’ 버튼을 한 번 선택하여 화면의 세 숫자가 위 값과 모두 일치함을 확인. 100개 페이지를 클릭하는 수집 방식은 사용하지 않음.
- `/batch` overview의 `from/to`만 바꾼 두 요청에서 값이 동일했으므로 기간 조회에 사용하지 않음.
- Trackify 공개 UI 코드에서 연간 랭킹 갱신 안내가 ‘6시간’임을 확인.
- 연간 랭킹 후보 200명 → 명시적 제외 후 100명 선정 → 공개 통계 98명, 후원 비공개 2명(단츄♪ `danchu17`, 니니♥♥♥ `honeys2`).
- 비공개 두 계정의 후원 수치는 사용하지 않고 `null`로 저장. 화면에서 산정 대기로 표시.

## 현재 잠정 TOP 70

98명의 공개 데이터로 계산하며 비공개 두 계정이 포함된 실제 100명 전체 결과와 다를 수 있습니다. 이름과 컷은 하드코딩되지 않습니다.

| 모델 | TOP 70 생성 | 예상 70위 | 점수 | 71위와 차이 |
| --- | --- | --- | ---: | ---: |
| 순위형 | 70명 | 미오탱ㅋㅋ | 32.58 | 0.21 |
| 백분위 | 70명 | 미오탱ㅋㅋ | 32.58 | 0.21 |
| 1위 대비 | 70명 | 해기_ | 6.56 | 0.12 |
| Min-Max | 70명 | 해기_ | 2.50 | 0.11 |

전체 4×70개 목록은 `model-results.json`에 기록합니다. 원본 스냅샷을 갱신하면 `npm run report`로 다시 생성합니다.

## 품질 확인

- 계산 테스트 11개: 극값, 80/10/10 가중치, 입력 불변성, 평균 동점 순위, 백분위와 순위형 일치, 단독/빈 후보, 0 나눗셈, 누락·NaN·중복 ID 거부, 정확한 70/71번째 경계.
- Python 테스트 7개: 실측 필드, TOP 50 오인 방지, 제외 후 후보 선정, KST 및 12월 수집 방지, 비공개 값 보존, 일부 비공개 후보 유지, 최초/후속 수집 실패 처리.
- lint: JS 구문 검사, Python AST, HTML ID·로컬 자산 참조, 제외 목록·스냅샷 검사.
- typecheck: TypeScript checkJs로 새 계산/UI 모듈 확인.
- Chromium UI: 네 모델 TOP 70, 60–80위 경계, 이름/ID 검색, 빈 결과, Enter로 상세 열기, Escape/포커스 복귀, 비공개 상세, 방법론, light/dark, 320/390/768/850/1024px 가로 넘침, stale/unavailable/retry, JS/CSP 오류 없음.
- 실제 Nginx 라우팅 설정을 임시 경로/포트로 구성한 `nginx -t` 성공. 운영 설정은 변경하지 않음.
- 정적 production build 성공. 결과물 `dist/`.

## 배포 전 남은 운영 단계

운영 public root에 dist 반영, CSP/JSON 캐시 설정 반영, 서버 수집 cron 등록이 필요합니다. 이 작업에서는 변경 파일과 실행 가능한 설정 예시를 준비했으며 운영에 적용하지 않았습니다. 미리보기는 동일한 CSP 헤더로 테스트했습니다.

11월 30일 마감치 전체 확보는 아직 보장할 수 없습니다. 현재 API는 연간 범위이므로 12월 이후 수집을 차단합니다. 사이트에도 이 제한을 공개합니다.
