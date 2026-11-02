# Production 일일 수집 정책 — 2026-10-18 KST

최종 결과는 `/home/masuj/trackify-daily-recovery-20261018/completion-report.md` 및 verification.json에 기록했습니다.

현재 cron은 UTC `15 18 * * *` 하나이며 매일 03:15 KST입니다. 시스템 Etc/UTC, CRON_TZ 및 daemon timezone override 없음. 기존 hourly 및 11/30 추가 수집은 제거했습니다. 정상 CLI는 snapshot lock과 KST daily attempt gate를 사용하며 실패도 당일 재시도하지 않습니다. 429/Blocked IP에서 즉시 모든 요청을 중단하고 Retry-After를 영속 저장합니다.

이번 복구의 probe는 200이었으나 동일 수집의 84번째 요청에서 Blocked IP를 수신했습니다. Retry-After 604799초, blockedUntil 2026-10-25 04:07:48 KST입니다. 이후 Trackify 요청 없음. 차단 중 daily cron은 요청하지 않습니다. 현재 차단 만료 후 첫 일일 예약은 2026-10-26 03:15 KST입니다.

사용자 최종 보정: singgyul 10/17 -20000, 10/18 -20000, 총 -40000. 사용자 확인으로 Trackify 자체 정정은 없으며 두 보정을 누적 유지합니다. 원본 7422588에 대한 조정값은 7382588이지만 수집이 실패해 미게시입니다. donor 4895, balloon 4929477은 원본 그대로이며 이 값도 production에 게시되지 않았습니다. 오늘 누적 84818은 일간 참고값으로 보존합니다.

경쟁자 전원은 현재 Trackify 원본 actual을 쓰라는 사용자 지시를 source-observation-policy.json에 저장했습니다. 감소는 source_correction으로 따로 감사 기록하며 추가 확인 요청을 반복하지 않습니다. source correction과 suspected_viewbot_traffic을 구분합니다. schema/ID/정수/전체 후보/날짜/HTTP block 검증은 유지합니다. singgyul의 rawMetrics, viewerAdjustments, viewerAdjustmentTotal, adjustedMetrics는 분리되고 조정은 다음 수집에도 유지됩니다.

09:15 KST의 한 번뿐인 viewer-only timer는 full 수집/게시/후원 변경을 하지 않습니다. 현재 차단 중이므로 API 0회로 skipped_blocked를 기록합니다. 결과 예정 경로는 morning-viewer-check.json입니다.

Production ranking은 byte-for-byte 그대로이며 manual_partial입니다. 현재 viewer 7291517, donor 4817, balloon 4895360. 마지막 성공 전체 수집은 2026-10-04 00:15:43 KST입니다. backup은 /var/backups/soop-ranking/daily-recovery-20261017T185449Z입니다. Sep30 baseline과 공식/가중치/cohort/exclusions/ranking/nginx/TOTP는 유지했습니다. Python 테스트 100개 및 기존 JS 계산/정적 검사 통과.
