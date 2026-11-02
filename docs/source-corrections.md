# Source correction handling

Only collector validation and audit/status recording change. September baseline, prior archived snapshots, scoring/forecast formulas, weights, candidate cohort, exclusion config, ranking UI, cron and nginx stay unchanged.

Detection remains mandatory for viewers, annual unique donors and balloons. A decrease is auto-confirmable only if the corrected value is positive, the relative decrease is <=5%, and the absolute decrease is <=1,000,000 viewers / 1,000 donors / 1,000,000 balloons. These are conservative operational limits, not a guarantee of source correctness.

For a bounded decrease: initial annual detail plus two fresh annual detail requests, separated by two seconds. The affected metric must match exactly in all three. Any newly decreasing other metric, schema/ID mismatch, null, non-integer, error/timeout or unstable response aborts the batch. Yearly summary must also match viewers/balloons, with explicit yearly/2026 period and unique ID checks. No annual donor aggregate exists in summary, so donor corrections use three detail confirmations and record that cross-check limitation. Existing request throttling/retry remains.

The whole cohort is collected and the unchanged JS engine recalculates all models before publication. No account is dropped and no old value is silently substituted. Other-candidate failure cancels the batch even after a local confirmation. Existing history preserves the prior snapshot; successful snapshot includes sourceCorrections. Immutable confirmation records are written under /var/lib/soop-ranking/history/corrections/{UTC timestamp}.json and successful application is logged as source_correction. Each record includes identity, metric, previous/current/delta, detection/confirmation timestamps, endpoint, three observations, cross-check evidence, reason and limits.

/var/www/singdboo-site/public/assets/data/collection-status.json independently records lastCollectionAttempt, lastSuccessfulCollection, lastDataChange, collectionStatus (updated, metrics_unchanged, source_correction, anomaly). Unchanged/error runs do not rewrite ranking.json. Failure preserves last successful time and last data change; status stores the reason. Consumers should fetch status with cache:no-store, as it lives under existing asset caching rules.

Confirmation means the source repeatedly reports a stable correction; it does not claim Trackify issued an explicit correction notice. Larger or unstable corrections still need manual review. The current value may legitimately end up below Sep30 baseline; baseline is not rebased and signed actual gain is retained.

Regression tests include exact 2,318,049 -> 2,290,254, zero/null/large drop, changing values/rebound, schema/error/timeout, summary disagreement, all three metrics, entire-cohort recalculation with audit and prior snapshot preservation, status transitions, and cancellation when another candidate fails.
