#!/bin/sh
set -eu
# This is called only from trusted default-branch workflows after input validation.
python3 scripts/install_scan_tool.py
.tools/gitleaks dir . --no-banner --redact=100 --max-target-megabytes 10
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add -- assets/data/ranking.json assets/data/collection-status.json data/viewer-adjustments.json history/ state/
if git diff --cached --quiet; then
  echo 'has_commit=false' >> "$GITHUB_OUTPUT"
else
  ranking_date=$(TZ=Asia/Seoul date +%F)
  git commit -m "chore(data): update ranking $ranking_date"
  git push origin "HEAD:$DEFAULT_BRANCH"
  echo 'has_commit=true' >> "$GITHUB_OUTPUT"
fi
