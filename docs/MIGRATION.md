# 운영 이전 기록

## 확인된 진행 상태 (2026-11-02)

- 웹 저장소 `moo3sing/moo3sing.github.io` public, Minecraft 저장소 `moo3sing/singgyul-minecraft` private, 모두 main branch로 생성·push 완료
- GitHub Pages Actions 배포 성공, custom domain 등록 전 기본 URL의 실제 Chromium 검증 성공
- production 공개 파일 32개와 GitHub Pages 응답 SHA256 모두 일치
- GitHub CI: Python 117개 및 기존 JavaScript·브라우저 검사 통과
- 실제 manual workflow dry-run 성공. raw 7,984,415 / 보정 -70,000 / adjusted 7,914,415를 확인했으며 게시하지 않음
- apply·실패 rollback·429 즉시 중단·100개 후보 중복 요청 없음·원격 gate 저장 실패 시 API 0회는 격리된 테스트로 검증
- 실제 collector workflow offline 실행 성공, API 0회. 자동 수집은 COLLECTOR_ENABLED=false 유지, 기존 GCP cron 유지
- Pages custom domain에 taehyeon-masu.xyz 등록 완료. 가비아 DNS와 GitHub 계정 TXT 검증은 사용자 적용 대기
- Minecraft는 사용하지 않는 프로젝트로 확인. 사용자 승인으로 게임 서비스만 중지하고, 소스 및 복구 archive를 별도 비공개 저장소에 보관
- Minecraft 약 750 MB archive를 업로드한 뒤 원격 다운로드 스트림의 전체 SHA256과 파일 718개 재검증. 실제 게임 복원·접속 테스트는 재개 시 필요

현재 GCP 종료 가능 여부는 **NO**입니다. 도메인의 Pages 전환·HTTPS와 실제 자동 수집 인계가 아직 완료되지 않았습니다.

## 원본 선택

2026-11-02 조사에서 public 32개 파일 중 staging과 다른 파일은 `assets/data/ranking.json` 및 `collection-status.json`이었습니다. 실제 서비스 중인 production 파일을 우선했습니다. 수집기·테스트는 기존 source를 사용합니다. 최종 공개 파일의 해시 대조 결과는 VM의 별도 audit 폴더에 보관합니다.

순위·예측 계산 모듈, 9/30 기준값, 80/10/10 가중치, 후보·제외 규칙, rolling forecast, source correction 및 기존 봇 보정 정책은 보존합니다. 원본 유저와 보정 유저를 구분하며 누적 -70,000을 재차 차감하지 않습니다. 단츄의 별풍선·후원자 고정 가정도 유지합니다.

GitHub 어댑터가 바꾸는 부분은 경로·입력·게시 방식입니다. 기존 수동 갱신기의 고정 `98명` 검증은 현재 점수 계산 대상 수를 계산하도록 바꿨습니다. 현재 단츄 가정을 포함한 점수 대상은 99명이고, 전체 후보는 100명입니다. 계산식은 바꾸지 않았습니다.

## 예정 저장소

- 웹: `moo3sing/moo3sing.github.io`, public. 사용자 사이트의 root URL을 사용해 `/assets/...` 절대 경로를 그대로 유지합니다. 기존 저장소가 있으면 덮어쓰지 않고 재검토합니다.
- Minecraft: `moo3sing/singgyul-minecraft`, private 우선. 별도 런처 원본 private 저장소가 있으면 확인 후 원본과 복구본을 비교합니다.

## 인계 순서

1. 비밀값 검사와 사전 보고 후 두 저장소의 clean initial commit을 생성·push합니다.
2. Pages를 GitHub Actions 방식으로 활성화하고 기본 `https://moo3sing.github.io/`에서 메인, `/ranking`, JSON, 그래프, 모델, 모바일, 콘솔을 검증합니다.
3. 자동 수집은 비활성 상태로 유지하며 collector offline 확인 및 manual dry-run을 실행합니다.
4. Pages에 `taehyeon-masu.xyz`를 먼저 등록합니다. 가능하면 계정의 Pages 도메인 TXT 검증을 완료합니다.
5. 아래 DNS 전환을 적용하고 HTTPS 인증서 발급 및 Enforce HTTPS를 확인합니다.
6. 운영의 최신 데이터·이력·gate 상태를 다시 동기화합니다. 성공 여부와 당일 시도를 확인한 뒤 GCP의 해당 cron만 중지하고 Actions 변수를 활성화합니다. 같은 KST 날짜에 전체 수집을 두 번 실행하지 않습니다.
7. 예약 실행과 실제 JSON 게시, 수동 apply, 실패·429 보존 동작을 확인합니다. 추가 호스트와 Minecraft runtime 이전까지 확인한 뒤 GCP 종료를 별도로 결정합니다.

현재는 웹 저장소·기본 Pages 검증·custom domain 사전 등록까지 완료했습니다. GCP 웹 서비스와 기존 DNS는 유지하며 Minecraft 서비스는 사용자 승인으로 중지했습니다.

## DNS 전환안과 복구

조사 시 `taehyeon-masu.xyz` A는 `34.50.18.179`, `www`는 apex를 가리키는 CNAME이고 AAAA는 없었습니다. 네임서버는 Gabia입니다. 적용 직전에 GitHub 공식 문서와 현재 DNS를 다시 확인합니다.

Pages 기본 URL 검증 및 custom domain 등록 후 apex A를 다음 네 값으로 전환합니다.

```text
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

`www` CNAME 대상은 `moo3sing.github.io`입니다. wildcard를 추가하지 않습니다. 기존 AAAA가 새로 생겼다면 충돌 여부를 먼저 검토합니다. `singdboo.xyz`, `launcher.singdboo.xyz`의 기존 레코드는 별도 승인 없이 삭제하지 않습니다. 계정 도메인 인증 TXT는 유지합니다.

문제가 생기면 apex A를 기존 `34.50.18.179`로, `www` CNAME을 `taehyeon-masu.xyz`로 복구합니다. GCP nginx와 기존 사이트를 유지해야 이 복구가 가능합니다. 수집 운영 복구는 Actions 변수를 false로 내린 후 최신 gate·데이터를 확인하고 기존 cron을 복구하는 순서입니다.

## 남아 있는 GCP 의존성

- Minecraft는 사용자 확인상 미사용 보관 대상. `oneblock-test` 등 월드와 재가동 자료의 외부 백업 필요
- `launcher.singdboo.xyz`의 distribution·EXE·모드 자료는 보관 대상. 현재 공개 서비스를 계속할 새 호스팅은 만들지 않음
- 구 도메인 `singdboo.xyz`의 HTTPS redirect
- 전환 검증 전 웹 nginx와 Python admin, 기존 collector cron

따라서 웹 Pages만 성공해도 즉시 GCP 종료가 가능한 것은 아닙니다. 종료 직전 일관된 Minecraft 월드 백업과 비밀값이 포함될 수 있는 운영 설정의 비공개 로컬 archive가 필요합니다. 이 archive는 Git에 넣지 않습니다.

## 공식 근거

- [Pages 요금제 및 공개 범위](https://docs.github.com/en/pages/getting-started-with-github-pages)
- [Actions schedule 및 timezone](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [Custom domain과 DNS](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [GITHUB_TOKEN과 workflow 재실행](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
