> 2026-10-18 최신 운영: [daily-collection-recovery.md](daily-collection-recovery.md). 자동 예약은 03:15 KST 하루 1회입니다. 현재 Trackify IP 차단(10/25 04:07 KST까지)으로 새 데이터 게시를 보류합니다.

> 2026-10-01 최신 기능: [dynamic-support.md](dynamic-support.md). 연간 실제 후원 데이터와 미래 후원 추세를 반영하며 9/30 원본은 보존합니다.

> 2026-10-01 최신 운영: [live-target.md](live-target.md). 메인은 실제 누적 유저 기반 남은 안전 목표이며 매시간 :15에 수집합니다. 아래는 이전 운영 기록입니다.

> 최신 메인은 띵귤 시뮬레이션입니다. 이번 개편의 설정·배포·이전 랭킹으로 복구는 [simulation.md](simulation.md)를 참고하세요. 아래 초기 배포 복구 절차는 그보다 이전 팬 사이트로 돌아갑니다.

# Production 운영 기록

## 배포

- canonical URL: https://taehyeon-masu.xyz/
- 전체 랭킹: https://taehyeon-masu.xyz/ranking
- 이전 URL `https://singdboo.xyz/`은 경로와 쿼리를 보존해 canonical URL로 301 이동.
- 플랫폼: Google Compute Engine의 기존 자체 Debian 서버 / Nginx. `launcher.singdboo.xyz` 등 다른 virtual host 유지.
- 새 도메인 전환 완료: **2026-09-30 15:05 KST**. 루트 A 레코드는 `34.50.18.179`, `www`는 루트를 가리키는 CNAME이며 TTL은 각각 600초.
- `www.taehyeon-masu.xyz`는 경로와 쿼리를 보존해 루트 도메인으로 301 이동.
- Let's Encrypt 인증서는 루트와 `www`를 모두 포함하며 2026-12-29 04:48:14 UTC까지 유효. Certbot 자동 갱신 모의 실행 통과.
- 전환 직전 백업: `/var/backups/soop-ranking/domain-migration-20260930T054526Z`, 배포 백업: `/var/backups/soop-ranking/simulation-20260930T055225Z`.
- DNS, HTTP/HTTPS, 리디렉션, 운영 데이터, 메인·랭킹 Chromium 검증 결과는 `domain-migration.json`에 기록.
- 배포 완료: **2026-09-30 02:19:24 KST** (2026-09-29 17:19:24 UTC).
- Git 저장소/branch/CI/CD 없음. 배포 commit 없음.
- 릴리스 ID: `20260929T171843Z`
- 정적 산출물 manifest SHA-256: `9b459f224836f7b752a51be3a8a98daf559cd841609b27d220746448adc5e8f6`
- 파일별 해시와 실행 기록: `deployment-record.json`.
- 기존 자산과 `/privacy`는 보존. 새 랭킹 자산을 먼저 설치하고 index.html을 마지막에 원자적으로 교체. Nginx는 검증 후 reload.

## 자동 갱신

- 기존 서버 cron 사용. cron 서비스는 active이며 시스템 시작 시 실행.
- 실제 cron 데몬 실행 확인: **2026-09-30 02:36:01 KST**. 현재 6시간 수집 항목과 2026-10-01 00:05 KST 기준 스냅샷 고정 항목이 있습니다.
- 유일한 등록 파일: `/etc/cron.d/soop-ranking`
- 실행 계정: `masuj` (root로 데이터 수집하지 않음)
- 주기: `15 */6 * * *` (서버 UTC)
- 한국 시간: **03:15 / 09:15 / 15:15 / 21:15**, 매일 6시간 간격.
- 등록 직후 다음 예정: **2026-09-30 03:15 KST**.
- 실행 명령: `/opt/soop-ranking/scripts/refresh-production.sh`
- 스케줄러가 주기를 관리하므로 wrapper는 `--force`를 사용합니다. 이를 통해 cron의 초 단위 편차로 6시간 캐시가 다음 회차를 건너뛰는 일을 방지합니다. 페이지 방문은 원본 API 수집을 유발하지 않습니다.
- cron과 동일한 wrapper/실행 계정으로 수동 실행 성공: 2026-09-30 02:18:44–02:19:24 KST, **40.40초**, exit 0.
- 이전 스냅샷은 `/var/lib/soop-ranking/history/20260929T164920Z.json`에 보관됨.
- API 요청 간격 0.4초, 병렬 요청 없음, 20초 timeout, 최대 3회/지수 backoff. 파일 잠금과 원자적 snapshot 교체 사용.

## 현재 데이터 및 검증

수집 기준 2026-09-30 KST. snapshot `updatedAt`: **2026-09-30 02:18:44 KST**, 수집 완료 **02:19:24 KST**.

- 후보 100명 / 정상 산정 98명 / 산정 대기 2명.
- 단츄♪ (`danchu17`), 니니♥♥♥ (`honeys2`): 후원 통계 비공개. null 유지, 0점 변환 없음.
- 봉준, 미오탱ㅋㅋ, 해기_, 띵귤_의 세 숫자 필드 smoke test 성공.
- 설정된 제외 ID가 후보군에 포함되지 않았음을 검증. staging/production 제외 config SHA-256 동일.

| 모델 | 현재 예상 70위 | 점수 |
| --- | --- | ---: |
| 순위형 | 미오탱ㅋㅋ | 32.58 |
| 백분위형 | 미오탱ㅋㅋ | 32.58 |
| 1위 대비 | 해리 | 6.61 |
| Min-Max | 해리 | 2.54 |

이는 공개 통계 98명 기준 잠정 순위입니다. 자동 수집 시 바뀔 수 있습니다. 전체 TOP 70은 배포 시점 실측 기록 `production-results.json`에 저장했습니다.

배포 직전 tests **20개**(JS 11/Python 9), lint, typecheck, production build 통과. 운영 보강 과정에서 이전 스냅샷 보존 및 12월 API 호출 차단 테스트 2개를 추가했습니다.

실제 production에서 HTTP 200, title/description/OpenGraph, 비공식 안내, 네 모델 TOP 70, 검색·상세, 숫자 포맷, light/dark, 키보드 포커스, 320/390/768/850/1024px 가로 넘침, 모바일 터치로 모델 전환·띵귤 검색·상세·70위 경계 검증 통과. JS/CSP 오류 없음. 스냅샷 HTTP 200, `/privacy` HTTP 200, `.lock` HTTP 404, `nginx -t` 성공.

## 경로 및 관리 명령

| 용도 | 경로 |
| --- | --- |
| 운영 웹 루트 | `/var/www/singdboo-site/public` |
| 운영 수집 코드 | `/opt/soop-ranking` |
| 운영 exclusion config | `/opt/soop-ranking/data/excluded-streamers.json` |
| 수정 원본 exclusion config | `/home/masuj/singdboo-site-staging/data/excluded-streamers.json` |
| 현재 snapshot | `/var/www/singdboo-site/public/assets/data/ranking.json` |
| 이전 snapshot | `/var/lib/soop-ranking/history/` |
| 수집 log | `/var/log/soop-ranking/collect.log` |
| 로그 순환 | `/etc/logrotate.d/soop-ranking` (매일, 14개, 압축) |
| cron | `/etc/cron.d/soop-ranking` |

제외 목록을 수정할 때:

```sh
# staging config 수정 후, production config에 같은 파일 반영
sudo install -o root -g root -m 0644 \
  /home/masuj/singdboo-site-staging/data/excluded-streamers.json \
  /opt/soop-ranking/data/excluded-streamers.json

# 운영 계정으로 즉시 갱신 (일반적으로 cron에 맡기면 됨)
sudo -u masuj /opt/soop-ranking/scripts/refresh-production.sh \
  >> /var/log/soop-ranking/collect.log 2>&1

tail -n 20 /var/log/soop-ranking/collect.log
```

정상 완료 로그는 `snapshot_published`, 부분 실패 로그는 `streamer_failed`(ID/원인 포함), 전체 실패는 `collection_failed`입니다. 실패 시 마지막 성공 데이터와 원래 updatedAt을 보존하고 stale 표시만 추가합니다. 성공 시 이전 데이터는 history에 보존합니다.

## Rollback

운영 이전 버전 백업:
`/var/backups/soop-ranking/20260929T171843Z/`

- `public.tar.gz`: 배포 전 운영 사이트 전체
- `nginx-site.conf`, `nginx-headers.conf`: 배포 전 운영 Nginx 설정
- `rollback.py`: 이번 프로젝트 cron만 해제하고 백업 사이트·설정을 복원하는 스크립트
- `release-source.tar.gz`, `deployment-record.json`: 릴리스 소스 및 기록

백업 검증(서비스 변경 없음):

```sh
sudo python3 /var/backups/soop-ranking/20260929T171843Z/rollback.py \
  /var/backups/soop-ranking/20260929T171843Z --check
```

실제 복구가 필요할 때:

```sh
sudo python3 /var/backups/soop-ranking/20260929T171843Z/rollback.py \
  /var/backups/soop-ranking/20260929T171843Z
```

다른 사이트·스케줄러는 건드리지 않습니다. 수집 중이라면 파일 잠금이 해제될 때까지 기다립니다. 새로 생긴 랭킹 자산·수집 로그·history는 삭제하지 않습니다. 이번 작업에서는 백업 읽기와 archive 무결성만 검증했으며 정상 운영 중인 사이트를 실제로 이전 화면으로 되돌리지는 않았습니다.

## 남은 데이터 한계

**11월 30일 최종 마감 snapshot은 별도 검증 필요.**

현재 연간 API는 임의 종료일을 지원하지 않습니다. 2026-12-01 KST 이후 wrapper가 실행되더라도 수집기는 네트워크 요청을 전혀 하지 않고 `collection_stopped`를 로그에 남기며 마지막 snapshot을 바이트 그대로 보존합니다. 2026-11-30의 마지막 정기 실행 예정은 21:15 KST이므로 당일 24:00 최종 마감치라고 주장하지 않습니다. 마지막 실제 수집 timestamp는 snapshot과 history/log에 남습니다.
