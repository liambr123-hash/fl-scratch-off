# How the data stays fresh

The site rebuilds itself nightly on **GitHub Actions** (`.github/workflows/refresh.yml`,
cron 09:20 UTC). `refresh.py` pulls games, odds, EV, deadlines, retailers and winners
from the Florida Lottery, regenerates `public/data.js` + `public/history.json` + the OG
share pages, commits, and pushes — which triggers Cloudflare to redeploy. No local
machine is involved.

## Why the winner-PDF fetch is defensive

The winner-PDF server (`files.floridalottery.com`) TLS-fingerprints its clients and once
rejected GitHub's runners with `SSLV3_ALERT_HANDSHAKE_FAILURE`. So `fetch_pdfs` tries a
3-rung ladder — `urllib` → TLS-1.2 browser ciphers → `curl` — and **curl currently gets
through** on CI. Each download must be a complete PDF (`%%EOF` trailer); a truncated or
blocked file is rejected and that game falls back to the committed **last-known-good
cache** at `pipeline/pdfcache/`. Successful live fetches refresh that cache, so it stays
current on its own.

Net effect: games/EV/deadlines refresh live every day; winners refresh live too while the
ladder works, and degrade gracefully to the cache (never to nothing) if the source blocks
or serves a broken file.

## Fail-safe behavior

If the whole upstream is degraded — empty games list, winner coverage collapse, retailer
census collapse — the publish guards abort with a nonzero exit. The commit step is skipped,
**nothing is pushed, and the live site keeps serving yesterday's data.** A failed run never
replaces good data with bad.

## If a run ever fails

Open the repo on github.com → **Actions** → the failed run → the "Rebuild data" step. The
log is self-diagnosing (unbuffered, with `PDF failures ×N: <reason>` summaries). The most
likely future failure is the PDF server tightening its block so all three rungs fail — in
that case the run stays green on the cache but the log will say
`PDF source unreachable for N games`. Turn on **Settings → Notifications → email on failed
workflow runs** to hear about aborts without watching.
