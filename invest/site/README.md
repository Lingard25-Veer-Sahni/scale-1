# SCALE India Investment

A self-updating tracker and learning simulator for **Indian unlisted startups**.

Live site: <https://scaleindiainvestment.github.io/>

## What it does

- Tracks 32 Indian **unlisted** startups across sectors with simulated daily prices (unlisted companies have no live market price - moves are driven by real news signals plus a deterministic model).
- Posts Indian startup **news** automatically from public RSS feeds (Inc42, YourStory, ET Tech, TechCrunch India, Mint, Moneycontrol).
- **Removes a startup when it lists on NSE or BSE** - the updater checks the NSE listed-company master and the BSE daily bhavcopy every run; an exact exchange match graduates it to the IPO Alumni section. A news report of a listing only flags it for human review (data/review.json). See AUDIT.md for the full eligibility rule.
- Paper trading, watchlist and portfolio saved in the visitor's browser (no accounts, no backend).

The universe rules (who counts as an Indian unlisted startup, when a company is removed) are defined and audited in [AUDIT.md](AUDIT.md). Companies whose Indian domicile is unverified live in `data/pending.json` and are not tracked.

## How it updates itself

The live preview is kept current by the **Cloudflare data worker** (`worker/data-worker.js`,
deployed as `scale-startup-data.y84ikt.workers.dev`). It runs on a cron trigger four times a
day (00:15/06:15/12:15/18:15 UTC), pulls startup news from the RSS feeds, checks the NSE
listed-company master, NSE SME list and BSE daily bhavcopy, and serves the refreshed
`data/*.json` from KV storage. The site's front-end fetches data from the worker first and
falls back to the bundled static files if the worker is unreachable.

When the repo is connected to GitHub, `.github/workflows/update.yml` can run the equivalent
`scripts/update_data.py` four times a day
(03:00, 09:00, 15:00, 21:00 UTC) and on demand. The script (Python standard
library only, no API keys, no paid services) refreshes:

| File | Contents |
| --- | --- |
| `data/prices.json` | one new simulated close per trading day |
| `data/news.json` | latest startup news, tagged to tracked companies |
| `data/startups.json` | the tracked universe, with IPO-watch flags |
| `data/graduated.json` | alumni that listed, with evidence |
| `data/meta.json` | last-run metadata, including which exchange sources succeeded |
| `data/review.json` | news-flagged possible listings awaiting human verification |
| `data/pending.json` | unlisted companies excluded pending domicile verification |

The workflow commits any changes back to `main`, and GitHub Pages republishes
the static site automatically.

## Layout

- `index.html`, `assets/` - the static front-end (no build step)
- `data/` - generated JSON the front-end reads
- `scripts/update_data.py` - the updater
- `.github/workflows/update.yml` - the schedule (once the GitHub repo is connected)
- `worker/data-worker.js` - the Cloudflare worker that powers live auto-updates on the preview
- `frontend/`, `backend/`, `docker-compose.yml` - legacy full-stack NSE paper-trading app (superseded; kept for reference)

## Local development

The site is fully static - serve the repo root with any web server:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Run the updater locally the same way the Action does:

```bash
python3 scripts/update_data.py
```


## What changed from the old app, and why

The repo previously held a React + FastAPI + MongoDB paper-trading app for
NSE-listed stocks (`frontend/`, `backend/`). It was never deployed to this
Pages site - the live site was just the rendered README - and its frontend
config pointed at `localhost`, so no visitor could ever use it.

The new static site replaces it because it can actually run for free on
GitHub Pages with no servers. This is what changed for visitors:

| Old app feature | Status now |
| --- | --- |
| Live NSE listed-stock prices via WebSocket | Removed - the new site is about UNLISTED startups, which have no live market price; prices are simulated |
| User accounts, login, admin approval | Removed - portfolios now live in the visitor's browser only |
| Shared leaderboard across users | Removed - no backend means no cross-user features |
| Email notifications | Removed - no mail server on free tiers |
| Paper trading, charts, watchlist | Kept, rebuilt as static + browser storage |

If real accounts, shared leaderboards or live listed-stock data are wanted
later, the legacy backend can be revived on a free tier (e.g. a free
container host + free MongoDB tier) behind this static front-end. The
`frontend/`, `backend/` and `docker-compose.yml` files are kept in the repo
for that path.

## Honest limits


- Prices are **simulated for learning**, not market data. Nothing here is investment advice.
- Valuations are last publicly reported figures and may be stale.
- News coverage is best-effort from free feeds, not exhaustive.
- Portfolio and watchlist live in the browser's localStorage only.
