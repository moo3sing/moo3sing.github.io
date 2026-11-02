# 띵귤 TOP 70 · GitHub Pages 이전본

운영 중인 `https://taehyeon-masu.xyz`의 정적 화면과 최신 공개 데이터를 보존하고, 수집·수동 갱신을 GitHub Actions로 옮기는 저장소입니다. 대상 계정은 **moo3sing**입니다.

현재 단계는 로컬 준비 및 검증입니다. 이 문서만으로 DNS 전환이나 GCP 종료가 완료되었다고 판단하지 마세요. 운영 인계 결과는 `docs/MIGRATION.md`에 기록합니다.

## 구성

- `index.html`, `ranking.html`, `privacy.html`, `assets/`: 실제 production 파일 기준 화면·데이터
- `services/`, `scripts/`: 기존 수집기와 계산 모듈, GitHub 실행 어댑터
- `data/`: 제외 목록, 원본 기준값, 보정 정책
- `history/`: 방송 지표의 관측·보정 이력. 접속 로그나 IP 분석 자료가 아닙니다.
- `state/`: 하루 1회 실행과 Retry-After 차단을 유지하는 최소 제어 상태
- `admin/index.html`: GitHub 수동 갱신 안내. 기존 Python 관리자 소스는 참고·테스트용이며 Pages에 배포하지 않습니다.

## 로컬 검증

Node.js 22와 Python 3.13을 사용합니다.

```sh
npm ci --ignore-scripts
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
python3 -m http.server 4173 --directory _site
```

`_site`만 Pages artifact로 배포합니다. `/ranking`은 `/ranking/index.html`로 이어지고 기존 `/ranking.html`도 유지합니다. 민감 설정·Python·이력·원문 입력 파일은 artifact에 포함하지 않습니다.

## 수동 갱신

Actions → **Manual ranking update** → Run workflow에서 먼저 `dry_run=true`로 계산 결과를 확인합니다. `false`이면 검증 후 관측 이력·JSON을 커밋하고 Pages 배포를 요청합니다. 저장소 쓰기 권한이 필요합니다.

- `viewer`: 봇 차감 전 **연간 누적 유저 원본**. 기존 누적 보정 `-70000`은 기본 유지됩니다.
- `donor`: 확인된 **연간 고유 후원자**. 비우면 값과 관측 시각을 유지합니다. 월별 고유 인원을 합산하지 않습니다.
- `balloon`: 연간 별풍선. 비우면 기존 값을 유지합니다.
- `observed_at`: `2026-11-02 23:22`처럼 KST로 입력합니다. 비우면 실행 시각입니다.
- `viewer_adjustment`: 새 피해량이 아닌 **누적 음수 보정 합계**. 비우면 기존 정책 유지. 더 차감하려면 근거를 `reason`에 적습니다. 기존 보정을 취소하는 작업은 별도 검토가 필요합니다.
- 연간 전체 표는 `annual_batch`와 `data/incoming/`의 텍스트 파일을 사용합니다. 월간 자료를 넣지 마세요.

미리보기는 JSON 수정이나 외부 API 호출을 하지 않습니다. 모델 공식·9월 기준값·단츄 후원 가정은 변경하지 않습니다.

## 자동 수집

**Daily collector**는 매일 03:15 KST로 예약합니다. GitHub 실행 지연 가능성이 있습니다. 저장소 변수 `COLLECTOR_ENABLED=true`가 되기 전에는 API를 호출하지 않습니다. GCP cron 인계를 마친 뒤에만 활성화합니다.

기존 수집기의 하루 1회 gate, 429 즉시 중단, Retry-After와 blockedUntil, source correction 검토, 원자적 JSON 교체를 재사용합니다. 실패 시 순위 JSON과 성공 이력은 원래 값으로 되돌리고 차단·시도 상태만 보존합니다. 불필요한 중복 요청은 하지 않으며, 기존 정책의 이상값 재확인은 유지합니다.

당일 gate는 첫 API 요청 전에 GitHub에 커밋합니다. 이 저장에 실패하면 API를 호출하지 않습니다. runner가 강제로 종료되어도 다음 실행은 같은 날의 기존 시도를 존중합니다. 수집 중 다른 코드 push가 있으면 일반 rebase로 처리하며 force-push하지 않습니다.

데이터 커밋은 `GITHUB_TOKEN`으로 수행하고 Pages workflow를 명시적으로 dispatch합니다. 토큰으로 push한 변경만으로 다른 workflow가 자동 실행된다고 가정하지 않습니다.

## 비밀값과 운영 경계

TOTP·세션·SSH·RCON·API 비밀값, `.env`, 개인 IP 분석, nginx 로그, 백업, 의존성 폴더를 Git에 넣지 않습니다. 현재 이 수집에는 새 GitHub repository secret이 필요하지 않습니다. GitHub가 실행 중 제공하는 `GITHUB_TOKEN`만 사용합니다.

Minecraft 소스와 운영 자료는 별도 저장소에 둡니다. Minecraft 게임 서버와 런처 다운로드를 Pages에서 실행할 수는 없습니다.
