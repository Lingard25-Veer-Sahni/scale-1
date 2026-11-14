# The investment simulator at scale-national.com/invest

Target URL: **https://www.scale-national.com/invest**

It is a path on the main site, the same way `/community` is, not a separate
site and not a separate Render service.

## How it ships

The whole simulator lives at `frontend/public/invest/`. Create React App copies
everything in `frontend/public/` into `build/` untouched, so a normal deploy of
the existing `scale-frontend` service puts real files at:

```
build/invest/index.html
build/invest/assets/app.js, styles.css, logo.png
build/invest/data/*.json
```

There is **nothing to create in the Render dashboard**. No second service, no
DNS record, no build command. It goes out with the next deploy of the main site.

> If you already created a `scale-invest` static site in Render, delete it. It
> is not used by this approach and its builds will keep failing.

## The one blocker: the `/*` catch-all

The frontend service currently has a single rewrite rule, `/*` -> `/index.html`.
On Render a rewrite rule **beats a real file on disk**. So while that rule is
there, `/invest` returns the React app's HTML instead of the simulator, and the
simulator never loads.

Verified on the live site on 14 November 2026: `/courses` and a made-up path
both returned the home page's HTML even though `build/courses/index.html` exists.

**Step 2 of `DEPLOY.md` is what removes that rule.** It has to be done before
`/invest` will work. That step also replaces the catch-all with four narrow
rewrites so that reloading an event or payment page keeps working.

Once it is done, no extra rule is needed for `/invest` - Render serves the real
files directly.

## What is in this folder now

| Path | What it is |
| --- | --- |
| `data-worker.js` | Source of the backend that feeds the site. **Not deployed and not served to visitors.** |
| `INTEGRATION-NOTES.md` | The original handoff notes from whoever built it. |
| `AUDIT.md` | How the tracker decides a company is an Indian unlisted startup, and when it removes one. |
| `APP-README.md` | The app's own README, as handed over. Out of date - see the note at the bottom of this file. |
| `DEPLOY-INVEST.md` | This file. |

Everything here is outside `frontend/public/` on purpose. Anything inside
`frontend/public/` is copied straight onto the public web, so internal notes and
the worker source are kept here instead.

The site itself is at `frontend/public/invest/`, which holds only `index.html`,
`assets/` and `data/`.

The live data comes from a Cloudflare Worker that already runs at
`scale-startup-data.y84ikt.workers.dev`. You do not need to deploy or configure
anything for it. Verified working on 14 November 2026: it answered in about one
second with data refreshed the same morning, tracking 33 startups. The JSON
files in `frontend/public/invest/data/` are offline fallbacks used only if the
worker does not answer within three seconds.

## Checking it after a deploy

1. Open `https://www.scale-national.com/invest`. You should get the dark
   "SCALE India Investment" page with a signup box over it.
2. Reload the page. It should still be there, not "Not Found".
3. Confirm the main site is untouched: the home page, logging in, event pages,
   payments and the courses all behave as before.
4. Confirm nothing links to it: there is no `/invest` entry in the navbar, the
   footer or the sitemap.

If step 1 shows the normal SCALE home page instead, the catch-all rewrite is
still in place - do `DEPLOY.md` Step 2.

## Keeping it out of Google

Three things do this, and none depends on the others:

- Nothing on scale-national.com links to `/invest`, so crawlers have no path to
  it in the first place.
- `frontend/public/invest/index.html` carries
  `<meta name="robots" content="noindex,nofollow">`.
- `render.yaml` sets `X-Robots-Tag: noindex, nofollow` on `/invest/*`, which
  also covers the JSON files, since they have no HTML head to put a tag in.
  (`render.yaml` only takes effect if the service is re-created from the
  Blueprint - see the note at the top of that file. The meta tag works either
  way.)

Note that *unlisted* is not the same as *private*. Anyone who has the URL can
open it and sign up. These settings keep it out of search results; they are not
a lock. Genuinely restricting it would need a password on the site itself,
which it does not currently have.

To make it findable later, delete the meta tag, delete the `X-Robots-Tag`
header, and add it to the sitemap.

## Things worth knowing about the app itself

- All money in it is virtual ("SimRupees"). Nothing real is bought or sold.
- It has its own signup with usernames and passwords, handled entirely by the
  Cloudflare Worker, which is **not** the main site's login system. A SCALE
  admin account will not work here, and an account here has no access to the
  main site. Being on the same domain does not join the two together.
- Email addresses are collected and stored but never verified and never
  emailed.
- Anyone removed by the admin can sign up again under a different username.
  The handoff notes flag this as a known limitation.
- `APP-README.md` is out of date: it says the app has no accounts and no
  backend, which was true of an earlier version. `INTEGRATION-NOTES.md` is the
  accurate one.
