# Dynamic support extension — 2026-10-01

Field verification was completed before implementation. See trackify-audit/meaning.md and its aggregate-only comparison records. No monthly unique donors are added to annual donors. Annual overview data for every baseline candidate is fetched at the existing :15 hourly cron. Since summary has no donor aggregate, a summary equality check cannot safely skip annual details: a donor-only change must be detected. Existing 0.4 s pacing, 20 s timeout, three attempts, no parallel API flood.

## Preservation and actuals

simulationBaseline is never overwritten. Its donor, balloon, viewer values remain the reference for all actual gains. Existing September viewer forecast remains unchanged; a separate immutable supportBaseline captures requested-month donor/balloon stats with explicit existing fallback months for four inactive accounts. Private-support accounts remain pending, never zero-filled. Lifetime cumulDonors/cumulBalloon are not used.

## Forecast scenario

Viewer retains current actual + Sep viewer gain/30 × future calendar days. Support uses the same actual/future boundary: today is actual, tomorrow through Nov 30 inclusive is forecast.

Before 7 observed days: September balloon daily pace. Initial new-to-year donor daily pace is min(monthly unique donors/30, locked annual unique donors/273). This is a deliberately conservative estimate, NOT observed September new annual donors. It avoids assuming every monthly donor is new to the year. Sept monthly unique counts are never added to annual actuals.

After at least 7 observed days and 6 suitable daily intervals: recent maximum 14-day robust actual increment average × 70% + September baseline × 30%. Gaps over 2.1 days and intervals under 0.5 days are excluded. Recent increments above max(3×baseline daily, 3×median observed daily) are clipped for forecasting ONLY; actuals are untouched. This prevents one large donation day from dominating the two-month forecast while allowing sustained growth. Weights are transparent scenario defaults, not statistically fitted claims: Oct 1 has no multi-day actual distribution to validate such fitting.

Annual unique donor future increments additionally decay by 1/(1+futureDay/60). This expresses diminishing new-donor arrivals, rather than adding recurring monthly donors linearly. It is an estimated scenario assumption, not a known audience saturation law. Projected rows are marked valueKind=forecast, donorEstimated=true; actual rows donorEstimated=false. Both are labelled separately in the UI.

Each model normalizes the full projected donor and balloon dataset before viewer threshold search. Rank ties and ordering reuse existing logic. Each minimum is verified at n-1/n. Development compareModes returns fixed, dynamic, and dynamic-minus-fixed for the same actual viewer snapshot and date.

## History and faults

/var/lib/soop-ranking/history/daily/YYYY-MM-DD.json stores date, observation timestamp, source timestamp, 100 candidate viewer/donor/balloon values, each model target, safe target, fixed target and difference. Latest valid observation replaces today's file on changes. Quiet days still get one private daily record with honest source time; public JSON remains byte-identical. The latest 15 prior daily records feed forecast history. No past history is invented.

Any cumulative decrease (including zeros after positive values), invalid/null fields, ID mismatch, missing support, or API error blocks publication of the entire batch. Last good public JSON stays byte-identical; private last-error.json and existing log explain the rejected data for review. Corrections require explicit verified reconciliation, never automatic silent acceptance.

Target results are computed by the same JS engine in the collector before snapshot publication. The server uses a durable local Node runtime under /opt/soop-ranking/runtime/node. The site is static Nginx; data-only changes need no build/deployment. On no-change polls only private history may be written. Browser recalculates by current KST calendar date so midnight/end status does not depend on a changed JSON.

Nov 30 23:58 KST final poll remains. Per-account checks and post-collection date guards prevent December values from publication. Dec 1 ends all forecasting and viewer threshold calculation; no claim that the last observation equals 23:59:59 settlement is made.

## Release

ops/dynamic-release.py backs up replaced paths under /var/backups/soop-ranking, preserves the four ranking file hashes and existing cron, installs runtime, calculation dependencies, collector and UI under the existing snapshot lock, then swaps index last. docs/dynamic-deployment.json records paths and validation. Stored original snapshots remain in docs/dynamic-before and production backup.
