# Florida Scratch-Off Statistician

An independent, free, non-commercial site for Florida scratch-off statistics — live odds, prizes remaining, expected value, winner maps, and a full retailer analysis. Fully static; **rebuilds itself from the Florida Lottery's public data every night.**

> Not affiliated with, endorsed by, or sponsored by the Florida Lottery or the State of Florida.

## What's here

```
public/            ← the website (this is what gets served)
  index.html  style.css  app.js  data.js  about.html
pipeline/
  refresh.py         ← pulls live data → rebuilds public/data.js (no database needed)
  requirements.txt   ← pdfplumber
  fl_feature.json    ← Florida outline for the maps
.github/workflows/
  refresh.yml        ← nightly GitHub Action that runs refresh.py and commits new data
```

The site is 100% static. `data.js` holds everything; the browser needs only Chart.js and D3 (loaded from a CDN). No server, no build step, no tracking.

## Run / refresh locally

```bash
pip install -r pipeline/requirements.txt
python3 pipeline/refresh.py          # ~2 min: fetches live data, rewrites public/data.js
python3 -m http.server -d public 8642 # then open http://localhost:8642
```

## Publish it: Cloudflare Pages + your own domain (free)

**1 — Put this folder on GitHub.** Create a free GitHub account, make a new repository (e.g. `fl-scratch-offs`), then from this folder:

```bash
git init && git add -A && git commit -m "initial"
git branch -M main
git remote add origin https://github.com/<you>/fl-scratch-offs.git
git push -u origin main
```

**2 — Connect Cloudflare Pages.** Sign up free at [pages.cloudflare.com](https://pages.cloudflare.com) → **Create a project** → **Connect to Git** → pick your repo. Build settings:

| Setting | Value |
|---|---|
| Framework preset | **None** |
| Build command | *(leave blank)* |
| Build output directory | **`public`** |

Click **Save and Deploy**. In ~30 seconds you get a live URL like `fl-scratch-offs.pages.dev`.

**3 — Add your custom domain.** Buy a domain (~$10/yr — Cloudflare Registrar is at-cost). In your Pages project → **Custom domains** → **Set up a domain** → type your domain → Cloudflare adds the DNS automatically if the domain is on Cloudflare. Done — HTTPS is automatic and free.

**4 — Turn on nightly auto-refresh.** The included Action (`.github/workflows/refresh.yml`) runs every morning, rebuilds `data.js` from the live API, and commits it — which triggers Cloudflare to redeploy. Enable it: GitHub repo → **Actions** tab → enable workflows. To test now: **Actions → Nightly data refresh → Run workflow**.

That's it — a free, auto-updating public site on your own domain.

## Notes

- **Data freshness:** the Florida Lottery updates its winner files overnight; the Action is scheduled for ~5:20am ET.
- **Costs:** GitHub (free), Cloudflare Pages (free, unlimited bandwidth), domain (~$10/yr, optional — the `.pages.dev` URL is free).
- **Editing the look:** all styling is in `public/style.css`; the app logic is `public/app.js`. Re-run `refresh.py` only when you want fresh data.

## Data & legal

Sources are the Florida Lottery's own public data feeds and public Top-Prize Winner reports (see `about.html`). All figures are referenced factually from public records. Play responsibly — **1-888-ADMIT-IT**.
