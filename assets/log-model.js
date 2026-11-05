export const LOG_MODEL = Object.freeze({
  label: 'Log',
  description: '실험적 로그 정규화: 큰 수치의 영향력을 완화하기 위해 각 지표에 ln(1+x)를 적용한 뒤 0–100 범위로 정규화합니다. SafeTarget에는 포함하지 않습니다.',
});

/** Normalize one metric over the same complete valid cohort as the other models. */
export function logMetricScore(values, value) {
  if (!values.length) return 0;
  if (!Number.isFinite(value) || value < 0 || values.some(x => !Number.isFinite(x) || x < 0)) {
    throw new Error('불완전한 통계');
  }
  const logMin = Math.log1p(Math.min(...values));
  const logMax = Math.log1p(Math.max(...values));
  return logMax === logMin ? 0 : (Math.log1p(value) - logMin) / (logMax - logMin) * 100;
}
