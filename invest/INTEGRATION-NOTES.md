# SCALE India Investment - Unlisted Startup Exchange

Handoff package, 14 November 2026. This is the complete source of the system
as it runs live today.

## What is in this zip

- `site/` - the entire frontend (static files: index.html, assets/, data/).
  No build step; serve the folder as-is.
- `data-worker.js` - the source of the live backend (a Cloudflare Worker).
  You do NOT need to deploy this to put the site at /invest; the frontend
  already talks to the running worker. It is included so the backend can be
  self-hosted later if wanted.
- This file.

Nothing secret is in this package. The worker reads its passwords and keys
from Cloudflare's secret store, not from source. An older unused Python
backend exists in the development repo and is deliberately not included - it
is not part of the live system.

## Live system today

- Frontend: https://scale-startup-preview.onrender.com
- Backend API: https://scale-startup-data.y84ikt.workers.dev
  (Cloudflare Worker + KV + Durable Object; refreshes startup data, news and
  listing checks from public RSS/NSE/BSE sources four times a day.)

## Putting it at scale-national.com/invest

The main website currently returns the same SPA shell for EVERY path,
including /invest (verified 14 Nov: /, /invest and a nonsense path return
byte-identical HTML). So /invest is not taken by real content, but the SPA
catch-all will swallow it unless the host adds a route first.

Steps for whoever controls the main site's hosting, in this order:

1. Redirect `/invest` to `/invest/` (trailing slash). This matters: the app
   references `assets/app.js`, `assets/styles.css` and `data/...` with
   RELATIVE paths. On `/invest/` the browser resolves them to
   `/invest/assets/...`; on `/invest` (no slash) it resolves them to
   `/assets/...` at the domain root, where they do not exist.
2. Route `/invest/*` (the page, its `/invest/assets/*` and `/invest/data/*`
   files) to this package's `site/` folder, BEFORE the SPA fallback. On
   Render this is a rewrite rule on the same web service that serves the
   main site (a separate static site has its own domain and would not place
   the app at scale-national.com/invest). Other hosts have an equivalent
   path-based rule.
3. The backend needs no change and no credentials: `site/assets/app.js`
   calls the live worker at
   `const DATA_WORKER = "https://scale-startup-data.y84ikt.workers.dev"`
   and the worker allows cross-origin calls from any site.

## Self-hosting the backend later (optional)

Only needed if you want to stop using the managed worker. Deploy
`data-worker.js` as a Cloudflare Worker with:

- A KV namespace bound as `SCALE_DATA`
  (`wrangler kv namespace create SCALE_DATA`, put the id in wrangler.toml).
- A Durable Object binding: name `PORTFOLIO_STORE`, class_name
  `PortfolioStore`, plus a migration in wrangler.toml:
  `[[migrations]] tag = "v1" new_sqlite_classes = ["PortfolioStore"]`.
  SQLite-backed Durable Objects are the kind available on Cloudflare's
  free plan; the live worker uses exactly this.
- Three secrets (`wrangler secret put <NAME>`):
  - `ADMIN_PASSWORD` - the creator/admin login password. The admin account
    is created from this on first deploy; changing it later rotates it.
  - `AUTH_SECRET` - signs login session tokens.
  - `RUN_KEY` - shared secret that protects the data-refresh endpoint
    (callers must send it as the `x-run-key` header).
- A cron trigger for the data refresh, e.g. `[triggers] crons = ["15 */6 * * *"]`
  (the managed worker uses that schedule: four times a day, UTC).
- Then point `DATA_WORKER` in `site/assets/app.js` at the new worker URL.

The seed data files under `site/data/` (startups, prices, news) are only the
fallback snapshot the site shows when the worker is unreachable; the worker
keeps its own live copies in KV.

## How accounts work (as of 14 Nov)

- Signup creates an active account immediately - no approval step.
- The admin (creator) can remove any account from the Account tab console.
  A removed account cannot log in, trade, or appear on the leaderboard, and
  cannot restore itself by signing up again with the same username. Only the
  admin can restore it (Approve).
- No emails are sent to anyone, ever. Email is collected only as a record.
- Known limit: a removed person can register again under a NEW different
  username. Account-level removal cannot prevent that without identity
  verification.
- Known cosmetic issue being fixed separately: the signup gate overlay can
  reappear on a fresh page load for an already-logged-in user until they
  tap "Log in from the Account tab" (it dismisses; the session is fine).

## Honest functional limits

- All prices and balances are SimRupees (virtual). Nothing is real money.
- Trades count only during NSE market hours (Mon-Fri 9:15-15:30 IST).
- Simulated prices update once a day; news and listing checks four times a
  day. If the data worker is unreachable or data is over 26h old, trading
  pauses and the site shows cached data with a banner.
- "Unlisted" status is best-effort: it is checked against the NSE master,
  NSE SME master and BSE daily trades. Suspended BSE-only scrips and foreign
  listings can be missed (see site/AUDIT.md).
- The leaderboard is computed from server-side portfolios only; nobody can
  submit a score.
