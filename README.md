# Florida Scratch-Off Statistician

An independent Florida scratch-off comparison tool at [flscratchstats.com](https://flscratchstats.com). The homepage brings ticket comparisons, inline game details, new releases, reported claims, deadlines, sources and optional support into one page. Individual game and price pages remain readable search entry points with their own canonical URLs.

Published odds and prize counts are separated from modeled payout estimates. The site has no winning-ticket promises, paid ranking placements or required account. Support comes from optional [Ko-fi contributions](https://ko-fi.com/stuartmills) and clearly labeled sponsorships.

## How it works

| Area | Source |
| --- | --- |
| Live-data refresh and validation | `pipeline/refresh.py` |
| Repair a committed snapshot without inventing a new source date | `pipeline/snapshot.py` |
| HTML homepage and JSON/CSV downloads | `pipeline/build_site.py` |
| Shared search-page shell and archived-game preservation | `pipeline/discovery.py` |
| Homepage interactions and styling | `public/assets/site.js`, `public/assets/site.css` |
| Canonical pages and generated data | `public/` |
| Private sponsorship API and retention cleanup | `server/worker.mjs` |
| Private inquiry schema | `migrations/0001_sponsor_inquiries.sql` |
| Existing Cloudflare Worker and D1 binding | `wrangler.jsonc` |
| Scheduled source refresh | `.github/workflows/refresh.yml` |

The comparisons are generated as HTML, so useful content and game links exist before JavaScript runs. JavaScript adds filtering, inline details, comparison selection and sponsor-form submission. There is no Chart.js or D3 dependency in the new homepage.

A Cloudflare Worker serves static assets and accepts sponsorship inquiries at `POST /api/sponsorship`. Inquiries are saved in a private D1 database. There is no public inquiry-list API and no automatic email or notification service; the owner reviews inquiries in Cloudflare. Rows older than 30 days are removed by daily cleanup and cleanup during new submissions. Cloudflare also provides aggregate traffic and performance analytics.

## Local development

Use Python 3.12, Node.js 22.13 or newer, and pnpm. Node must be available on `PATH`; Worker tests use the built-in `node:sqlite` module.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r pipeline/requirements.txt
pnpm install --frozen-lockfile
pnpm build
pnpm test:python
pnpm test:worker
```

`pnpm build` uses the existing `public/data.js` snapshot. It repairs supported data-quality issues, regenerates game/search pages, builds the homepage and downloads, and applies the shared shell. It does not fetch new Lottery data or change the original source timestamp.

For a local preview with the sponsorship API:

```sh
pnpm exec wrangler d1 migrations apply flscratchstats-sponsors --local
pnpm dev
```

Open [localhost:8642](http://localhost:8642). Local D1 data is isolated from the production database. Use synthetic details for local form checks. Do not submit real or test inquiries to the live form during routine deployment verification.

A plain static server can preview the HTML, filters and styling, but cannot receive sponsorship inquiries:

```sh
python3 -m http.server 8642 --bind 127.0.0.1 --directory public
```

## Refreshing data

```sh
python3 pipeline/refresh.py
```

This fetches official Florida Lottery game data, public winner reports and supporting public datasets. It rebuilds the shared snapshot, history, game pages, sitemap, homepage and downloads together. Major source-coverage failures abort the refresh. Invalid or inconsistent records are labeled and excluded from recommendation lists rather than silently presented as verified comparisons.

Game headline counts use the same advertised prize tier as the official game table. Winner-report claims are matched by prize identity; a lower claimed tier is not promoted to the advertised jackpot. Removed game files are retained as clearly labeled archive snapshots rather than deleted just because they disappear from today's feed. A count correction is not described as a newly reported claim.

The existing GitHub Action schedules refreshes at **12:07 UTC and 16:47 UTC** (7:07/11:47 a.m. EST or 8:07 a.m./12:47 p.m. EDT) and commits generated files. The primary run stays after the historically observed overnight source-update window in both seasons; GitHub may dispatch it later. Cloudflare's existing Git deployment connection must use the same current source; publishing a local redesign without synchronizing GitHub can otherwise be replaced by a later automated deployment. See [DEPLOYMENT.md](DEPLOYMENT.md) for the verified database setup, publication steps and owner review query.

## Discovery and measurement

- Keep the homepage and existing game/price canonical URLs available. The homepage provides ordinary crawlable links to all current games and price lists.
- Submit `https://flscratchstats.com/sitemap.xml` in the owner's Google Search Console property after publication. Search Console verification is an owner action; no verification token has been invented or added.
- The refresh pipeline supports IndexNow for supporting search engines. IndexNow does not submit URLs to Google.
- Use Search Console clicks, impressions, click-through rate and average position for organic growth. Cloudflare request counts or edge uniques are not exact counts of human unique visitors.
- Keep source timestamps truthful. A site rebuild or interface change is not a fresh Lottery-data retrieval.

The project is not affiliated with, endorsed by or sponsored by the Florida Lottery or the State of Florida. Prize availability and deadlines should be verified with the official source. Every game has a house edge by design.
