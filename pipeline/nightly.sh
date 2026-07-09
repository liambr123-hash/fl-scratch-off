#!/bin/bash
# Nightly winner-data refresh, run on the owner's Mac (its home IP can reach the
# FL Lottery PDF server, which TLS-blocks GitHub's CI runners). Refreshes data +
# the committed PDF cache, then commits & pushes so Cloudflare redeploys and CI
# has a fresh fallback cache. Safe to run repeatedly; commits only on real change.
#
# Install once (see pipeline/README-automation.md):
#   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.flscratchstats.refresh.plist
#
set -uo pipefail

# launchd runs with a minimal environment — make tools findable and never block on a prompt
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin"
export GIT_TERMINAL_PROMPT=0          # fail fast instead of hanging if the keychain is locked

REPO="/Users/wb/Desktop/ticks/site-publish"
BRANCH="main"
LOG="$REPO/pipeline/nightly.log"
LOCK="$REPO/pipeline/.nightly.lock"

exec >>"$LOG" 2>&1
echo "───────── $(date '+%Y-%m-%d %H:%M:%S %Z') nightly refresh ─────────"

# single-instance guard (no overlap if a run is slow)
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "another run holds the lock ($LOCK) — skipping"; exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

cd "$REPO" || { echo "repo not found: $REPO"; exit 1; }

# only operate on a clean-ish tree on the right branch
CUR=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$CUR" != "$BRANCH" ]; then echo "not on $BRANCH (on $CUR) — skipping"; exit 0; fi

# get latest first so our commit rebases cleanly on any CI bot commit
git pull --rebase --autostash origin "$BRANCH" || { echo "pull --rebase failed — skipping this run"; exit 0; }

# run the pipeline; nonzero exit = guard tripped = do NOT publish (keep last good)
if ! /usr/bin/python3 pipeline/refresh.py; then
  echo "refresh.py exited nonzero (publish guard) — nothing committed, site unchanged"
  exit 0
fi

# commit only the generated artifacts, only if something actually changed
git add -A public/data.js public/history.json public/g public/og pipeline/pdfcache
if git diff --cached --quiet; then
  echo "no data changes — nothing to commit"
  exit 0
fi

git -c user.name="data-refresh-bot" -c user.email="actions@users.noreply.github.com" \
    commit -q -m "data: nightly refresh $(date -u +%Y-%m-%d) [mac]"

# push via the osxkeychain credential helper GitHub Desktop configured (no token handled here)
if git push origin "$BRANCH"; then
  echo "pushed $(git rev-parse --short HEAD) — Cloudflare will redeploy"
else
  echo "push failed (network or auth) — commit is local; will retry next run or push via GitHub Desktop"
fi
