# 실험적 Log 모델

각 지표의 점수는 `Math.log1p`로 계산한다.

```text
LogNorm(x) = (ln(1+x) - ln(1+min)) / (ln(1+max) - ln(1+min)) × 100
Final = Viewer × 0.8 + Donor × 0.1 + Balloon × 0.1
```

분모가 0이면 0점이다. 최솟값·최댓값은 기존 모델과 동일한 전체 유효 후보에서 구한다. 검색이나 TOP N 필터로 모집단을 바꾸지 않는다. 실제값/rolling 예상값, 보정 viewer, 비공개 후보와 고정 후원 예외 정책은 기존 경로를 그대로 사용한다.

- 전체 랭킹: 기존 모델 선택 옆에 `Log · 실험`을 추가했다. 기존 백분위 탭도 유지한다.
- 메인 시뮬레이션: 네 번째 비교 카드에 Log 순위/남은 목표/일평균을 표시한다.
- target: 기존 `minimumAdditional` solver를 재사용하며, 1명 단위 최소 경계를 확인한다.
- 기존 `models` 배열은 순위형/1위 대비/Min-Max 세 개를 유지한다. Log는 새 `experimentalModels` 배열에만 추가한다.
- SafeTarget과 대표 순위/일평균은 기존 세 모델로만 계산한다. `TARGET_MODEL_POLICY`는 향후 명시적 승인 후 정책을 바꿀 수 있는 확장 지점이며, 이번에는 Log를 SafeTarget에 포함하지 않는다.
- ranking.json, 원본 지표, baseline, 보정 policy와 기존 history를 갱신하지 않는다. 실험 결과는 화면에서 계산하므로 별도의 raw data pipeline이 없다.

검증은 `npm test`의 `tests/log-model.test.js`에 포함했다. Log의 extrema/0/동일값/단조성/가중치/solver 경계/종료일, 조정 viewer와 전체 모집단 사용을 검사한다. 기존 결과는 추가 전 캡처한 `legacy-model-regression.json`으로 7개 날짜의 전체 랭킹 및 fixed/dynamic/rolling 결과를 비교한다. 기존 소스 해시 검사의 기대값은 유지하며, 새 Log 연결 세 줄을 제외한 기존 계산 소스가 같은지도 검사한다. `npm run test:browser`는 Log 선택·필터·설명·실험 카드와 SafeTarget 분리를 확인한다.

다음 예시는 테스트/비교용이며 production 데이터에 넣지 않는다.

| 값 | Min-Max | Log (약) |
| ---: | ---: | ---: |
| 100 | 0 | 0 |
| 1,000 | 0.09 | 24.9 |
| 10,000 | 0.99 | 49.9 |
| 100,000 | 9.99 | 75.0 |
| 1,000,000 | 100 | 100 |
