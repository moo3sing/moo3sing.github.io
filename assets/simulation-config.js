// Change these defaults to adjust the analysis window and initial identity visibility.
// The analysis window NEVER changes the full-cohort scoring formula or TOP 70 cutoff.
export const SIMULATION_CONFIG = Object.freeze({
  targetId: 'singgyul',
  cutoffRank: 70,
  competitionFrom: 50,
  competitionTo: 90,
  anonymousDefault: true,
  defaultModel: 'ratio',
  growthMultipliers: [1, 1.1, 1.2, 1.3],
  maxAdditionalUsers: 1_000_000_000_000,
});
