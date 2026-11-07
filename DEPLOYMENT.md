# Deployment and private sponsorship operations

## Current state — November 7, 2026

The redesign is prepared in this checkout. Production publication and GitHub synchronization are not yet verified complete. The repository is the existing [liambr123-hash/fl-scratch-off](https://github.com/liambr123-hash/fl-scratch-off), and the existing Cloudflare Worker is `fl-scratch-off`.

Cloudflare D1 setup is complete:

| Setting | Value |
| --- | --- |
| Account | `0e92980ea722e89ff7c2bc68b6bd74b9` |
| Database | `flscratchstats-sponsors` |
| Database UUID | `2f5bc061-c1a2-46ae-aa8a-aa8263f9ad29` |
| Worker binding | `LEADS` |
| Table | `sponsor_inquiries` |
| Migration | `migrations/0001_sponsor_inquiries.sql` |

The database was created through the signed-in Cloudflare Dashboard within the existing free limits. The migration table and both named indexes were created in its Console. Verification showed **0 inquiry rows and 2 expected indexes**. No billing upgrade, security change, expanded OAuth permission or live inquiry submission was required. Creating the database did not publish the Worker or change production routing.

The local Wrangler configuration now names this existing database and the `ASSETS` static-assets binding. It also declares a daily retention Cron Trigger. These bindings and the trigger take effect in production only after successful Worker publication.

Local release verification passed: 26 Python checks, 12 Worker checks, 90 canonical HTML pages and sitemap URLs, 101 valid JSON-LD blocks, and 76 PNG social cards with matching source fingerprints. Browser checks covered desktop and 390-pixel layouts, price/search/sort/top-prize filters, pagination, comparisons, corrected #1647 details, #1384 quarantine behavior and a successful sponsorship inquiry saved only to local D1. Unknown paths return 404, and the inquiry endpoint rejects public reads. The source snapshot remains November 6 at 21:07:54 UTC; a rebuild did not relabel it as newly fetched data.

Cloudflare's existing dashboard connection was verified: production branch `main`, deploy command `npx wrangler deploy`, existing apex/www custom domains and existing workers.dev address. No build, domain, security or billing setting was changed. GitHub is waiting for the owner's normal sign-in; the connected integration and existing CLI credentials do not currently provide write access to this repository. Publication is intentionally pending source synchronization so an automatic build cannot restore the old application.

## Prepare and verify the release

Use the environment setup in [README.md](README.md). Run from this repository:

```sh
pnpm build
pnpm test:python
pnpm test:worker
pnpm exec wrangler deploy --dry-run
```

The Python checks cover prize identity, data quarantine, deadlines, snapshot preservation and canonical/archived page handling. Worker tests use real in-memory SQLite to verify bound SQL, validation, deduplication, private API behavior and retention. Browser verification should cover desktop and mobile comparisons, a canonical game page, price links, inline details, accessible controls and the optional sponsor form.

Review the generated diff. A rebuild must preserve the source snapshot date unless a real source refresh was run. Keep all existing canonical pages; do not redirect every search entry to the homepage or convert the public dataset into private form data.

## Synchronize the owning repository

Confirm that `origin` points to the existing repository above. The connected GitHub identity in the current session did not match the repository owner, and a usable CLI/keychain push credential was not available. A successful GitHub push has not been established. Do not substitute another user's account, extract browser credentials, or treat a local commit as a remote synchronization.

Complete an authorized owner sign-in or use the owner's normal GitHub publishing flow, then push the reviewed branch and merge it into the production branch as appropriate. Preserve concurrent bot data commits when reconciling the branch.

This synchronization matters for persistence: the nightly GitHub Action and Cloudflare Git deployment connection must receive the new builder, Worker, schema/configuration and assets. A manual local deploy alone can be overwritten by the next deployment from old remote source.

## Publish the existing Worker

```sh
pnpm exec wrangler whoami
pnpm deploy
```

Verify the intended Cloudflare account and existing `fl-scratch-off` Worker before publication. The session's existing Wrangler authorization included Worker script write access but did not include D1 administration scope. The database schema is already provisioned; do not expand OAuth permissions just to repeat its creation. If publication reports a binding or authorization problem, resolve that specific problem through the owner's normal Cloudflare flow instead of creating a second database or Worker.

Do not recreate the project as Cloudflare Pages. The current deployment uses a Worker with static assets and an API handler. Keep the existing custom-domain routing. The Worker configuration does not create a new domain redirect. Cloudflare's static-asset `_redirects` format does not support domain-level host redirects, so www-to-apex behavior requires a separately verified supported configuration if the owner chooses to add it.

After a successful deployment, verify:

1. The public homepage shows the redesigned interface and the correct source snapshot date.
2. Existing game and price URLs return their own readable content and canonical tags.
3. Asset responses load, the homepage filters and inline details work, and unknown routes do not silently become the homepage.
4. `GET /api/sponsorship` is rejected without returning inquiry data. Do not insert a live lead merely to test publication.
5. The production Worker has the intended `LEADS` binding and daily retention trigger.
6. The next automated refresh rebuilds the homepage and canonical pages from the same new source instead of reverting the release.

A deployment URL or successful CLI status is evidence of publication. It is not evidence that GitHub synchronization, D1 binding or the next scheduled source refresh succeeded; verify those separately.

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

These results contain private business contact details. Keep them in the owner's dashboard; do not commit exports, screenshots with real inquiries, or inquiry data into `public/`. There is no public dashboard or read API for this table.

The form stores a reference ID, millisecond submission timestamp, name, company/project, reply email, message, optional budget and consent version. It does not store the visitor's IP address, user agent or referrer in D1. Cloudflare's network services operate separately from this application table.

A successful submission means the inquiry was saved for private review. It does not send email to the owner or to the sender, reserve an advertising placement, or take payment. The owner must review the dashboard and handle replies separately. No message or notification automation has been configured. Sponsor agreements and placement publication remain separate owner decisions; sponsorship cannot alter ticket rankings or calculations.

Rows older than 30 days are removed by daily Cron cleanup and cleanup during new submissions. Review inquiries promptly. If the retention Cron fails, investigate the failure; do not silently extend the site's stated retention behavior.

## Scheduled updates and search follow-through

The source-data refresh remains in `.github/workflows/refresh.yml`, scheduled for **12:07 UTC** (7:07 a.m. EST / 8:07 a.m. EDT) and **16:47 UTC** (11:47 a.m. EST / 12:47 p.m. EDT). The primary slot stays after the historically observed overnight source-update window in both seasons. GitHub may delay dispatch. Check the actual run and source snapshot rather than assuming a local-clock promise. The rebuild calls `build_site(D)` after refreshing data, so homepage HTML, canonical pages and downloads stay aligned.

After the release is live, the owner can verify/add the Google Search Console domain property and submit `https://flscratchstats.com/sitemap.xml`. Record an initial 28-day baseline for clicks, impressions, click-through rate, average position and indexed pages. Compare equivalent periods and separate branded from non-branded queries. Public search spot checks do not establish an exact ranking or unique-visitor count.
