# 띵귤 웹 관리자 운영 절차

이 문서는 2026-10-05 KST에 운영 배포된 `/admin` 관리자 페이지의 등록과 사용 순서다. 관리자 백엔드는 Trackify를 호출하지 않고 운영 `ranking.json`만 읽는다. 최초 TOTP 등록은 아직 운영자가 직접 완료해야 한다.

## 운영 구성

- URL: `https://taehyeon-masu.xyz/admin` (`/admin/`으로 이동)
- Python 표준 라이브러리 백엔드: `127.0.0.1:8765`, `/opt/soop-ranking/admin/server.py`
- nginx: `ops/taehyeon-admin.nginx` 검증본을 `/etc/nginx/sites-available/taehyeon-masu.xyz`에 설치
- systemd: `soop-ranking-admin.service`, 계정 `masuj`, 자동 시작 및 장애 시 재시작
- TOTP 비밀: `/etc/soop-ranking/admin.env`, 소유자 `masuj`, 권한 `0600`
- 최초 등록 URI: `/etc/soop-ranking/admin-enrollment.txt`, root 전용 `0600` (등록 후 삭제)
- 작업 감사 기록: `/var/log/soop-ranking/admin-actions.log`, `0600`
- 운영 파일: `/var/www/singdboo-site/public/assets/data/ranking.json`
- 기존 잠금: `/var/www/singdboo-site/public/assets/data/ranking.lock`

현재 VM에는 Flask/FastAPI가 설치되지 않아 추가 의존성 없이 표준 라이브러리 HTTP 서버를 사용한다. 외부 접속은 nginx의 HTTPS 경로만 허용하고 백엔드는 loopback 이외 주소에서 시작하지 않는다. 세션은 서버 메모리에 있으며 재시작 시 모두 종료된다.

## 배포 기록과 최초 등록

1. 배포 전 전체 백업은 `/var/backups/soop-ranking/before-manual-admin-20261004T192330Z`, 수동 코어 릴리스 백업은 `/var/backups/soop-ranking/manual-release-20261004T192349Z`, 관리자 릴리스 백업은 `/var/backups/soop-ranking/admin-release-20261004T192416Z`에 있다. cron은 기존 매시 15분 그대로다.
2. root 전용 `/etc/soop-ranking/admin-enrollment.txt`가 생성돼 있다. 운영자가 안전한 SSH 세션에서 `sudo cat /etc/soop-ranking/admin-enrollment.txt`로 URI를 확인하여 인증 앱에 등록한다. URI의 `secret=` 뒤 값은 인증 앱의 수동 등록 키로도 사용할 수 있다. 등록 후 `sudo rm /etc/soop-ranking/admin-enrollment.txt`로 일회성 URI를 제거한다. **URI를 채팅, 브라우저, 공개 저장소, 로그 또는 production JSON에 붙여 넣지 않는다.**
3. `sudo systemctl status soop-ranking-admin.service`, `sudo nginx -t`, `curl -I https://taehyeon-masu.xyz/admin/`으로 확인한다. `/admin/api/state`에 로그인 없이 접근하면 `401`이어야 한다. `sudo ss -lntp | grep 8765`에는 `127.0.0.1:8765`만 보여야 한다.

## 평소 사용

1. `https://taehyeon-masu.xyz/admin`에 접속한다.
2. 인증 앱의 현재 6자리 코드를 입력한다. 로그인은 30분 뒤 만료되고, 5회 연속 실패하면 15분 동안 추가 시도가 제한된다.
3. 현재 띵귤의 세 누적값, 데이터 기준 시각, 예상 순위와 Safe target, 경쟁자 기준 시각을 확인한다.
4. 확인된 누적 유저·후원자·별풍선·KST 관측 시각을 입력하고 **미리보기**를 누른다. 세 지표의 이전값→입력값, 11/30 예측값, 세 모델 target, Safe target, 예상 순위를 확인한다. 이 단계는 운영 파일·backup·history를 만들지 않는다.
5. 값이 감소했다면 실제 정정이 맞는지 별도로 확인하고 **정정값으로 적용**을 체크한다. 감소하지 않았다면 체크가 필요 없다.
6. **적용**을 누른다. 서버는 세션·CSRF·미리보기 유효기간·운영 snapshot 해시를 다시 검사한다. 그 사이 자동 수집이나 다른 관리자가 게시했다면 적용이 거부되므로 새로 미리보기한다.
7. 성공 메시지의 백업 경로와 새 현재값을 확인한다. `ranking.json`, `collection-status.json`, 수동 history, `admin-actions.log`에 결과가 남는다. 9/30 baseline과 경쟁자 실제값은 보존된다.

## 보호와 장애 확인

- 브라우저의 코드·쿠키·CSRF token은 audit log에 기록하지 않는다. 세션 쿠키는 `Secure; HttpOnly; SameSite=Strict; Path=/admin`이며 API 쓰기 요청은 동일 출처 `Origin`, JSON content type, CSRF token이 필요하다.
- 실제 Apply는 기존 수동 갱신 함수를 호출한다. `ranking.lock`을 자동 수집과 공유하며, 미리 본 snapshot 해시가 달라지면 중단한다.
- 기존 `manualOverride` 정책은 그대로다. Trackify 자동 수집이 정상 복귀하면 자동 수집 로직이 수동 override를 제거한다.
- 관리자 서버 로그는 `sudo journalctl -u soop-ranking-admin.service -n 100 --no-pager`, 감사 로그는 `sudo tail -n 30 /var/log/soop-ranking/admin-actions.log`로 확인한다. 감사 로그에는 적용 시도·성공·실패와 입력값이 남고 TOTP 비밀은 남지 않는다.
- `robots.txt`의 `Disallow: /admin`은 검색 엔진 힌트일 뿐, 인증 대체 수단이 아니다.
