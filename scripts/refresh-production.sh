#!/bin/sh
set -eu
umask 027
if [ "${1-}" = "--daily" ] && [ "$(TZ=Asia/Seoul date +%F)" = "2026-11-30" ]; then
  echo 'Final day uses its 23:58 KST observation; 03:15 collection skipped.'
  exit 0
fi
exec /usr/bin/python3 /opt/soop-ranking/scripts/collect.py --force \
  --output /var/www/singdboo-site/public/assets/data/ranking.json \
  --history-dir /var/lib/soop-ranking/history
