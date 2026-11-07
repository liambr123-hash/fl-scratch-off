# How the data stays fresh

GitHub Actions runs `pipeline/refresh.py` using the schedule in
`.github/workflows/refresh.yml`:

| Opportunity | UTC | Eastern Standard Time | Eastern Daylight Time |
| --- | --- | --- | --- |
| Primary refresh | 12:07 | 7:07 a.m. | 8:07 a.m. |
| Later safety net | 16:47 | 11:47 a.m. | 12:47 p.m. |

The primary slot stays after the historically observed overnight source-update
window, which finished around 6:20 a.m. Eastern, in either season. GitHub may delay
or skip scheduled dispatch, so these are refresh opportunities, not promised
publication times. The site shows the actual source build timestamp. Both
scheduled runs execute; the later run is not conditional on a previous failure.

## What a refresh rebuilds

`refresh.py` fetches the Florida Lottery's public game feed, prize tiers, winner
reports and supporting datasets. It applies data-quality and prize-identity
checks, writes the shared snapshot and history, and regenerates game/search
pages. It then calls `build_site(D)`, which rebuilds the HTML-first homepage,
`public/data.json`, `public/games.csv`, and the shared landing-page shell from that
same snapshot. Removed game pages are retained and labeled as archived snapshots.

The workflow stages **all of `public/` plus `pipeline/pdfcache/`**. That includes
`data.js`, history, homepage HTML, JSON/CSV downloads, game/search pages, share
cards, sitemap and robots files. Changed output is committed to `main`; the
existing Cloudflare Git deployment connection must use the same current source.
No local Mac is needed for scheduled data refreshes.

## Why winner-PDF fetching is defensive

The winner-PDF server has rejected some CI TLS clients in the past. The fetcher
tries stock `urllib`, a TLS 1.2 browser-cipher configuration, then `curl`. It checks
that each response is a complete PDF ending in `%%EOF`. Successful live downloads
refresh the committed last-known-good cache in `pipeline/pdfcache/`.

If a PDF cannot be fetched, that game's report can fall back to its cached copy.
That is not a fresh winner report: source limitations and stale report dates must
remain visible, and limited records are excluded from recommendations. A green
workflow is not proof that every upstream source was fresh or agreed.

## If a run fails

Major source-coverage checks abort the process with a nonzero exit. The workflow's
commit step is skipped, so the live site retains its last successful published
snapshot. It may be older than yesterday if failures continue.

Open the repository's Actions page, select the failed run, and inspect the
“Rebuild data from the Florida Lottery API” step. PDF fetch failures and fallback
counts appear in its log. Check the actual source snapshot date and visible
quality notes as well as job status. The owner may enable GitHub's normal failed
workflow notifications; no new email or notification automation is installed by
this project.

## Private sponsorship cleanup is separate

The published Worker has its own daily Cron Trigger for deleting inquiry rows
older than 30 days. This private D1 cleanup does not use the GitHub data-refresh
job and does not publish inquiry data. See `../DEPLOYMENT.md` for owner-only
review queries and publication details.
