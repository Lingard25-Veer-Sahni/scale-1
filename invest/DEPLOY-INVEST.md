# Putting the investment simulator on its own subdomain

Target URL: **https://invest.scale-national.com**

This is a separate site from scale-national.com. Nothing on the main site links
to it, and the main site is not touched by any of the steps below. If you stop
halfway through, the main site is unaffected.

## What is in this folder

| Path | What it is |
| --- | --- |
| `site/` | The whole website. Plain HTML, CSS and JavaScript. No build step. **This is the folder Render publishes.** |
| `site/data/*.json` | Offline fallback copies of the startup data. The live site normally ignores these and reads fresh data from the worker. |
| `data-worker.js` | Source of the backend that feeds the site. **Not deployed by these steps** and not served to visitors. Kept only so the backend can be self-hosted later. |
| `INTEGRATION-NOTES.md` | The original handoff notes from whoever built it. |

The site gets its live data from a Cloudflare Worker that already runs at
`scale-startup-data.y84ikt.workers.dev`. You do not need to deploy or configure
anything for that. Verified working on 14 November 2026: it answered in about
one second with data refreshed the same morning, tracking 33 startups.

## Step 1. Create the Render service

1. In the Render dashboard click **New +** then **Static Site**.
2. Pick the same repository the main site uses.
3. Fill in:
   - **Name:** `scale-invest`
   - **Branch:** whichever branch you deploy from
   - **Root Directory:** `invest/site`
   - **Build Command:** leave it **empty**
   - **Publish Directory:** `.` (a single dot)
4. Click **Create Static Site** and wait for the first deploy to finish.

It will give you a URL like `scale-invest.onrender.com`. Open it and check the
page loads before going on.

> Leave the Build Command empty. There is nothing to compile, and a build
> command would fail and block the deploy.

## Step 2. Point the subdomain at it

In **Render**, open the `scale-invest` service, go to **Settings → Custom
Domains**, and add `invest.scale-national.com`. Render will show you a CNAME
value, something like `scale-invest.onrender.com`.

Then in **GoDaddy**, open the DNS records for `scale-national.com` and add:

| Field | Value |
| --- | --- |
| Type | `CNAME` |
| Name | `invest` |
| Value | the hostname Render showed you |
| TTL | leave the default |

Save. DNS usually takes a few minutes, occasionally up to an hour. Render shows
a green tick on the custom domain once it has worked, and issues the HTTPS
certificate automatically.

Only add the `invest` record. Do not change the existing records for `@` or
`www`, which are what keep the main site working.

## Step 3. Check it

Open `https://invest.scale-national.com`. You should get the dark
"SCALE India Investment" page with a signup box over it.

Then confirm it stayed separate from the main site:

- `https://www.scale-national.com` still loads normally
- Logging in, event pages and the courses still work
- There is no link to the simulator anywhere in the main site's menus

## Keeping it out of Google

Two things do this, and neither depends on the other:

- `site/index.html` carries `<meta name="robots" content="noindex,nofollow">`
- `render.yaml` sets an `X-Robots-Tag: noindex, nofollow` header on everything,
  which also covers the JSON files that have no HTML to put a tag in

Note that *unlisted* is not the same as *private*. Anyone who has the URL can
open it and sign up. These settings keep it out of search results; they are not
a lock. If it needs to be genuinely restricted, that needs a password on the
site itself, which it does not currently have.

To make it findable later, delete the meta tag and the `X-Robots-Tag` header.

## If you would rather have scale-national.com/invest instead

That is a path on the main site rather than a subdomain, and it is a different
and riskier job: it needs a rewrite rule ordered ahead of the main site's own
routing, plus a `/invest` to `/invest/` redirect, because the app loads its
files using relative paths. Getting the order wrong can break existing pages.
The subdomain above avoids all of that. Ask before switching approaches.

## Things worth knowing about the app itself

- All money in it is virtual ("SimRupees"). Nothing real is bought or sold.
- It has its own signup with usernames and passwords, handled entirely by the
  Cloudflare Worker, which is **not** the main site's login system. A SCALE
  admin account will not work here, and an account here has no access to the
  main site.
- Email addresses are collected and stored but never verified and never
  emailed.
- Anyone removed by the admin can sign up again under a different username.
  The handoff notes flag this as a known limitation.
- `site/README.md` is out of date: it says the app has no accounts and no
  backend, which was true of an earlier version. `INTEGRATION-NOTES.md` is the
  accurate one.
