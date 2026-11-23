#!/usr/bin/env bash
# Every five minutes, from cron: lists the Magic streams live now (scripts/live.ts) and pushes them
# to the "live" branch, which the Live streams page reads. The branch holds a single commit,
# replaced each time, so that it does not grow.
#   bash scripts/live.sh <checkout of the live branch> <state file>
# Keys in the environment: TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET, YOUTUBE_API_KEY. NODE as in
# update.sh; a container must see the paths as they are here.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
out="$1"
state="$2"

# shellcheck disable=SC2086
${NODE:-node} "$repo/scripts/live.ts" --out "$out" --state "$state"

cd "$out"
git add -A
if git rev-parse -q --verify HEAD >/dev/null; then
  git commit -q --amend --no-edit
else
  git commit -q -m "Live streams: the list made every five minutes"
fi
git push -q -f origin HEAD:live
# The replaced commits are of no use here.
git reflog expire --expire=now --all
git gc -q --prune=now
