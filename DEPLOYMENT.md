# Deployment and private sponsorship operations

## Published state — November 7, 2026

The redesigned site is **published at [flscratchstats.com](https://flscratchstats.com)** and synchronized with the existing [liambr123-hash/fl-scratch-off](https://github.com/liambr123-hash/fl-scratch-off) repository. The existing Cloudflare Worker is `fl-scratch-off`.

| Evidence | Verified result |
| --- | --- |
| [Release import run](https://github.com/liambr123-hash/fl-scratch-off/actions/runs/42387851431) | Successful rebuild and all 38 checks: 26 Python and 12 Worker checks |
| [Release commit `2dca9ba8`](https://github.com/liambr123-hash/fl-scratch-off/commit/2dca9ba8) | Complete reviewed source and generated site imported together |
| [Cleanup commit `4402b046`](https://github.com/liambr123-hash/fl-scratch-off/commit/4402b046) | One-time importer workflow and patch removed |
| [Compatibility commit `39dba4f4`](https://github.com/liambr123-hash/fl-scratch-off/commit/39dba4f4) | Cloudflare package installation supported by `packages: ["."]` in `pnpm-workspace.yaml` |
| [Normal refresh run](https://github.com/liambr123-hash/fl-scratch-off/actions/runs/42388201488) | Manually dispatched through the existing data-refresh workflow; real source retrieval and rebuild succeeded |
| [Data commit `eda3f070`](https://github.com/liambr123-hash/fl-scratch-off/commit/eda3f070) | Refreshed output published to production |

The live source snapshot is **November 7, 2026 at 15:50:30 UTC (10:50:30 a.m. EST)**, with 76 game records, 734 public winner records, 75 recommendation-eligible games and one quarantined record. A design rebuild did not manufacture this date: the normal refresh retrieved new source data.

Production HTTP/source QA passed all 18 checks. All 90 sitemap pages returned HTTP 200 with self-referencing canonicals, unique nonempty titles, meta descriptions and H1s. All 84 observed same-domain assets loaded, and all 101 JSON-LD blocks parsed. The homepage includes comparison content and game links in its initial HTML. Browser checks covered desktop and 390-pixel layouts, filters and inline details without horizontal page overflow. Game #1647 correctly shows 2 of 2 top prizes remaining; game #1384 is clearly quarantined and excluded from recommendations.

`GET /api/health` returned `200 {"ok":true,"storage":"ready"}`. `GET /api/sponsorship` returned 405 without inquiry data. No live test inquiry was submitted; durable submission and retention behavior passed the local Worker suite and a form submission to local D1. Production binding and Cron configuration were verified separately in Cloudflare. The future scheduled retention execution itself has not yet been observed.

## Current Cloudflare configuration

| Setting | Value |
| --- | --- |
| Account | `0e92980ea722e89ff7c2bc68b6bd74b9` |
| Worker | `fl-scratch-off` |
| Production source branch | `main` |
| Deployment command | `npx wrangler deploy` |
| Static asset directory / binding | `public` / `ASSETS` |
| Worker-first API routes | `/api`, `/api/*` |
| Unknown-page handling | `404-page` |
| D1 database / binding | `flscratchstats-sponsors` / `LEADS` |
| D1 UUID | `2f5bc061-c1a2-46ae-aa8a-aa8263f9ad29` |
| Private inquiry table | `sponsor_inquiries` |
| Schema | `migrations/0001_sponsor_inquiries.sql` |
| Daily retention Cron | `17 9 * * *` — 09:17 UTC |

The dedicated database was provisioned within the existing free limits. Its table and both named indexes were applied through the owner's D1 Console. Provisioning verification showed 0 inquiry rows and 2 expected indexes. No billing upgrade, expanded OAuth permission or new credential was required. The production `LEADS` binding and daily 09:17 UTC trigger are now present.

The existing apex, www and workers.dev routes remain in use. Nonproduction Git builds are also enabled, and their observed version command is `npx wrangler deploy`; do not assume that an incomplete branch push is isolated from production. Keep watched-branch updates complete and review their deployment behavior.

## Prepare a future release

Use the environment setup in [README.md](README.md). Run from this repository:

```sh
pnpm build
pnpm test:python
pnpm test:worker
pnpm exec wrangler deploy --dry-run
```

The Python checks cover prize identity, data quarantine, deadlines, snapshot preservation and canonical/archived page handling. Worker tests use real in-memory SQLite to verify bound SQL, validation, deduplication, private API behavior and retention. Browser verification should cover desktop and mobile comparisons, a canonical game page, price links, inline details, accessible controls and the optional sponsor form.

Review the generated diff. A rebuild must preserve source timestamps and historical claim data unless a real source refresh was run. CSV exports use LF line endings so strict whitespace checks pass on the Linux runner. Keep existing canonical pages and unique content. Private inquiry data must never enter public assets or downloads.

The one-time release importer has been removed. Normal future changes should use the owner's authorized GitHub workflow or normal Git credentials. Confirm that `origin` points to the existing repository, preserve concurrent bot data commits, and synchronize reviewed source and generated output with the production branch. A local commit or manual Worker deployment alone does not update the source used by later automatic builds.

## Publish the existing Worker

Cloudflare's Git connection deploys the synchronized source. When an authorized manual publication is needed:

```sh
pnpm exec wrangler whoami
pnpm deploy
```

Verify the intended Cloudflare account and existing `fl-scratch-off` Worker before publication. The existing D1 database and schema do not need to be recreated. Resolve any specific authorization or binding error through the owner's normal Cloudflare flow instead of creating duplicate infrastructure or extracting browser credentials.

This project uses a Worker with static assets and an API handler. Do not recreate it as Cloudflare Pages. Preserve existing custom-domain routing and the checked-in `LEADS`, `ASSETS` and retention-trigger configuration. The Worker configuration does not add a domain redirect; any www-to-apex change requires a separately verified supported configuration.

After a future deployment, verify:

1. The public homepage shows the intended interface and truthful source snapshot date.
2. Existing game and price URLs retain readable content and correct canonicals.
3. Styles, scripts and linked assets load; filters and inline details work; unknown routes return 404.
4. `/api/health` reports storage readiness without exposing inquiry data, and `GET /api/sponsorship` remains rejected. Do not insert a live lead merely to test publication.
5. The production Worker retains its intended `LEADS` binding and daily retention trigger.
6. A normal source refresh rebuilds the homepage, canonical pages and downloads from the same current code.

The November 7 manual dispatch of the normal refresh workflow has already demonstrated that this release survives a real source retrieval, bot commit and production deployment. Future scheduled runs still need normal operational monitoring.

## Review sponsorship inquiries privately

Open the [dedicated D1 Console](https://dash.cloudflare.com/0e92980ea722e89ff7c2bc68b6bd74b9/workers/d1/databases/2f5bc061-c1a2-46ae-aa8a-aa8263f9ad29/console) while signed in as the owner. For a quick count:

```sql
SELECT COUNT(*) AS inquiry_count
FROM sponsor_inquiries;
```

For private review:

```sql
SELECT id,
       datetime(created_at / 1000, 'unixepoch') AS submitted_utc,
       name,
       company,
       email,
       message,
       budget,
       consent_version
FROM sponsor_inquiries
ORDER BY created_at DESC
LIMIT 50;
```

These results contain private business contact details. Keep them in the owner's dashboard; do not commit exports, screenshots with real inquiries, or inquiry data into `public/`. There is no public dashboard or read API for this table. The public health endpoint returns readiness only.

The form stores a reference ID, millisecond submission timestamp, name, company/project, reply email, message, optional budget and consent version. It does not store the visitor's IP address, user agent or referrer in D1. Cloudflare's network services operate separately from this application table.

A successful submission means the inquiry was saved for private review. It does not send email to the owner or sender, reserve a sponsorship placement, or take payment. The owner must review the dashboard and handle replies separately. No email or notification automation has been configured. Sponsor agreements and placement publication remain separate owner decisions; sponsorship cannot alter ticket rankings or calculations.

Rows older than 30 days are removed by daily Cron cleanup and cleanup during new submissions. Review inquiries promptly. The daily 09:17 UTC trigger is configured; investigate failed cleanup runs rather than silently extending the site's stated retention behavior.

## Scheduled updates and search measurement

The source-data refresh remains in `.github/workflows/refresh.yml`, scheduled for **12:07 UTC** (7:07 a.m. EST / 8:07 a.m. EDT) and **16:47 UTC** (11:47 a.m. EST / 12:47 p.m. EDT). The primary slot stays after the historically observed overnight source-update window in both seasons. GitHub may delay dispatch. Check the actual run and source snapshot rather than assuming a local-clock promise. The rebuild calls `build_site(D)` after refreshing data, so homepage HTML, canonical pages and downloads stay aligned.

**Google Search Console ownership, sitemap submission and current ranking metrics have not been verified in this session.** Successful public crawlability does not establish Google indexing, position or traffic growth. The owner can verify/add the domain property and submit `https://flscratchstats.com/sitemap.xml`, then record an initial 28-day baseline for clicks, impressions, click-through rate, average position and indexed pages. Compare equivalent periods and separate branded from non-branded queries. Public search spot checks and Cloudflare edge uniques do not establish an exact ranking or count of human unique visitors.
