#!/usr/bin/env bash
# The hourly update, run by cron on a machine of the owner's (GitHub drops most hourly scheduled
# runs): reads the feeds, commits the new videos and pushes them; the push publishes the page.
#   YOUTUBE_API_KEY=… bash scripts/update.sh
# Needs git with push access and Node 22.18 or later (the TypeScript runs as is). Set NODE to run
# Node another way, in a container for instance. In the 06 UTC hour it reads sets and cards too.
set -euo pipefail
cd "$(dirname "$0")/.."

# Word splitting on purpose: NODE may be a whole command line.
# shellcheck disable=SC2086
run() { ${NODE:-node} "$@"; }

git pull -q --rebase
if [ "$(date -u +%H)" = "06" ]; then
  run scripts/sets.ts || echo "Scryfall unavailable: the sets stay as they were"
  run scripts/cards.ts || echo "Scryfall unavailable: the cards stay as they were"
fi
run scripts/sync.ts
run scripts/views.ts

git add data
if git diff --cached --quiet; then
  echo "nothing new"
  exit 0
fi
git commit -q -m "Data: videos of $(date -u '+%F %H:%M') UTC"
if ! git pull -q --rebase; then
  # The same lines changed on GitHub meanwhile: drop this run, the next one reads the feeds again.
  git rebase --abort || true
  git reset -q --hard '@{u}'
  echo "conflict with GitHub: run dropped"
  exit 1
fi
git push -q
echo "pushed"
