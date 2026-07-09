# How the data stays fresh (two independent layers)

The FL Lottery **winner-PDF server** (`files.floridalottery.com`) TLS-fingerprints its
clients and rejects GitHub Actions' datacenter IPs (`SSLV3_ALERT_HANDSHAKE_FAILURE`).
Everything else (games/odds/EV, deadlines, retailers) is reachable from anywhere.
So freshness comes from two layers that each fail safe:

### Layer 1 — GitHub Actions (always on), cron 09:20 UTC
`refresh.py` refreshes games, odds, EV, deadlines and retailers **live**. For winners it
tries a 3-rung fetch ladder (urllib → TLS-1.2 browser ciphers → curl); when all fail on
CI it falls back to the **committed PDF cache** at `pipeline/pdfcache/`. The run stays
green and the site updates daily. Winners are only as fresh as the last cache push.
If the *whole* upstream is degraded (empty games list, retailer census collapse, etc.),
the publish guards abort with a nonzero exit → **nothing commits, the live site keeps
yesterday's data.**

### Layer 2 — this Mac (when it's on), daily 06:40 local
`pipeline/nightly.sh` runs the same pipeline from your home IP, where the PDF server
answers normally. It refreshes winners **and** rewrites `pipeline/pdfcache/`, commits, and
pushes — which both redeploys the site and gives Layer 1 a fresh fallback cache.

Between the two: games/EV/deadlines refresh every day no matter what; winners refresh
whenever this Mac runs (top-prize claims are infrequent, so a little lag is harmless).

---

## The scheduled job (launchd)

Installed agent: `~/Library/LaunchAgents/com.flscratchstats.refresh.plist`
Runs: `pipeline/nightly.sh` daily at 06:40 local (fires on next wake if asleep).
Logs: `pipeline/nightly.log` (rolling), `pipeline/launchd.{out,err}.log`.

The push uses the `osxkeychain` credential helper GitHub Desktop already configured —
no token is stored in this repo. The job only pushes when data actually changed, rebases
onto any CI commit first, and never blocks on a prompt (`GIT_TERMINAL_PROMPT=0`).

### Manage it
```bash
# check it's loaded
launchctl print gui/$(id -u)/com.flscratchstats.refresh | grep -E 'state|program'

# run it right now (does a real refresh + push)
launchctl kickstart -k gui/$(id -u)/com.flscratchstats.refresh
tail -f pipeline/nightly.log

# stop / remove it
launchctl bootout gui/$(id -u)/com.flscratchstats.refresh

# reinstall after edits
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.flscratchstats.refresh.plist
```

### If you ever want CI to do winners too
If the PDF server later stops blocking datacenter IPs, nothing needs changing — the
ladder will just fetch live on CI and refresh the cache itself. Nothing to maintain.
