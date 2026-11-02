# Trackify 차단 중 띵귤 단독 수동 갱신

이 문서는 수동 기능의 구현 및 사용법을 설명한다. 실제 띵귤 값은 운영자가 직접 확인한 연간 누적 viewer, **연간 고유 donor**, 연간 누적 balloon을 사용한다. 월별 donor unique를 연간 값으로 입력하지 않는다. 수동 스크립트는 Trackify API를 호출하지 않는다.

## 실행

```sh
python3 /opt/soop-ranking/scripts/manual-update-singgyul.py \
  --viewer 6700000 --donor 4750 --balloon 4400000 \
  --observed-at "2026-10-05 15:30" --dry-run
```

출력된 actual/projected, 세 모델 target, Safe target을 확인한 뒤 **실제 확인값으로** `--dry-run`을 제외해 실행한다. `--observed-at`은 KST이며 생략하면 실행 당시 KST를 사용한다. 수치가 이전 수동·자동값보다 감소하면 중단하고 변경 내역을 보여준다. 실제 source correction을 확인했다면 `--allow-correction`을 붙여 실행하며 previous/current/delta와 `manual_correction` 사유가 history에 남는다. null·NaN·음수·0·소수·안전 정수 초과·지표별 과도한 값·오래된 관측 시각은 거부한다.

Script는 기존 정상 JSON을 읽어 띵귤 actual 세 값만 변경한 후보 집합을 만든 뒤 기존 Node simulation 계산기로 98명의 projected final, Rank·Max-relative·Min-Max, Safe target을 다시 계산한다. 계산과 검증 실패 시 JSON은 유지한다. 성공 시 `/var/backups/soop-ranking/manual/manual-YYYYMMDD-HHMMSS-ffffff/`에 직전 JSON과 status를 백업하고 같은 디렉터리의 temp 파일을 원자적으로 교체한다. 수동 입력 기록은 `/var/lib/soop-ranking/history/manual/`, correction은 `manual-corrections/`, 그날 전체 projected 기록은 `daily/YYYY-MM-DD.json`에 남는다.

## 데이터 기준

- `collectionMode=manual_partial`, `actualDataScope=singgyul_only`.
- `manualOverride.observedAt`: 띵귤 실제값 기준.
- `competitorDataAsOf`: 마지막 정상 **자동** 수집의 관측 시각. 반복 수동 갱신에서도 보존.
- `actualObservedAt`: 전체 후보의 마지막 자동 관측 시각으로 보존. 수동 모드 rolling 계산은 띵귤만 `manualOverride.observedAt`을 사용한다.
- 경쟁자 99명의 actual 값은 이전 정상 snapshot과 바이트/값이 같다. 후원 통계 비공개 2명은 계산에서 제외돼 valid 후보 98명이다.
- 메인 footer에 두 시각과 작은 수동 상태 안내를 표시한다. 오래된 자동 수집 안내는 수동 상태에서 띵귤 실제값이 멈춘 듯 보이지 않도록 대체한다.

## Trackify 차단과 자동 복귀

`/var/lib/soop-ranking/control/trackify-block.json`의 `blockedUntil` 이전에는 collector가 첫 API 요청 전에 종료한다. 차단 시작 응답의 `Retry-After`에 따라 초기 안전 종료 시각은 **2026-10-11 01:16 KST**다. 2026-10-05 운영 배포의 명시 승인 범위에 따라 cron은 기존 **매시 15분 KST**, `15 * * * *` UTC를 그대로 유지했다. 차단이 추가 연장되지 않는다면 첫 예정 재확인은 **2026-10-11 02:15 KST**다. 기존 11/30 23:58 KST 추가 관측 항목도 유지한다.

재개 후 429가 다시 발생하면 그 응답의 `Retry-After`를 저장하고 다음 API 요청을 막으며 기존 JSON을 보존한다. 429는 추가 재시도하지 않는다. 자동 수집 성공 시 수동 띵귤 값을 마지막 자동 actual로 되돌린 뒤 전체 Trackify actual로 갱신하고 `manualOverride`를 제거한다. 정정 검사는 수동값이 아닌 마지막 자동 기준값과 비교한다. `collectionMode=automatic`, `actualDataScope=all_candidates`, `competitorDataAsOf`를 새 성공 시각으로 설정한다.

기존 정상 snapshot에는 최근 7/8/9월 입력과 Sep30 support 기준이 저장돼 있다. 자동 collection의 일반 경로는 100명 각각 annual detail을 한 번 요청한다. monthly summary 재조회는 rolling 입력이 누락된 경우에만, yearly summary/detail 재확인은 source correction 또는 큰 증가를 감지한 경우에만 수행한다. 하루 1회와 429 즉시 중단으로 요청 증폭을 줄인다. `services/trackify.py`의 API 직접 호출 외에 proxy/우회 경로는 없다.

9/30 baseline, 80/10/10, rolling 공식, 세 모델, 제외 목록, 후보 집합, source correction 정책, `/ranking`, nginx root는 그대로 둔다.
