# News feeds: what I checked, and what to put in the worker

Checked on **23 November 2026**. Every URL below was fetched, parsed with the
worker's own `parseFeed()`, and the item dates inspected. Feeds that failed are
listed with the reason — none of them are in the list to add.

## Use these twelve

Six are already in the worker. Six are new.

```js
const FEEDS = [
  // already deployed
  ["Inc42",                       "https://inc42.com/feed/"],
  ["YourStory",                   "https://yourstory.com/feed"],
  ["ET Tech",                     "https://economictimes.indiatimes.com/tech/rssfeeds/13357270.cms"],
  ["TechCrunch India",            "https://techcrunch.com/tag/india/feed/"],
  ["Mint Companies",              "https://www.livemint.com/rss/companies"],
  ["Moneycontrol",                "https://www.moneycontrol.com/rss/business.xml"],
  // new, verified 23 Nov 2026
  ["Entrackr",                    "https://entrackr.com/rss"],
  ["Business Standard Companies", "https://www.business-standard.com/rss/companies-101.rss"],
  ["Business Standard Tech",      "https://www.business-standard.com/rss/technology-108.rss"],
  ["BusinessLine Companies",      "https://www.thehindubusinessline.com/companies/feeder/default.rss"],
  ["BusinessLine Info-Tech",      "https://www.thehindubusinessline.com/info-tech/feeder/default.rss"],
  ["Mint Money",                  "https://www.livemint.com/rss/money"],
];
```

| Feed | HTTP | Items | Newest item | Notes |
| --- | --- | --- | --- | --- |
| Entrackr | 200 | 50 | 18 min old | Indian startup funding desk. `robots.txt` disallows only `/static/*`; the feed path is allowed. |
| Business Standard Companies | 200 | 35 | 2.3 h old | Feed carries `<copyright>Business Standard</copyright>`. See caveat below. |
| Business Standard Tech | 200 | 35 | fresh | Same publisher. |
| BusinessLine Companies | 200 | 60 | 54 min old | `robots.txt` read in full; nothing disallows the `/feeder/` paths. `<copyright>THG PUBLISHING PVT LTD</copyright>`. |
| BusinessLine Info-Tech | 200 | 60 | 24 min old | Same publisher. |
| Mint Money | 200 | 35 | 48 min old | Same publisher as the Mint feed already deployed. |

That takes the worker from 9 subrequests a run to 15, against the **50 per
invocation** cap on Workers Free. Room for a few more, not forty.

## Do not add these

| Feed | What happened |
| --- | --- |
| **Entrackr** `/feed/`, `/feed`, `/index.xml` | 404. The working path is `/rss` — the one in the brief was wrong. |
| **VCCircle** `/feed`, `/rss/news`, `/rss.xml`, `/rss/all` | 404 on every variant tried. No usable public RSS found. |
| **Financial Express** `/feed/` | 410 Gone. `/business/industry/feed/` and `/business/feed/` return **HTML, not RSS** (about 930 KB of page markup). Parsing those would yield nothing. |
| **ET Startups** `11993050.cms` | 200 and valid RSS, but **abandoned**. `lastBuildDate` is today while every item is from 2020–21 (newest: 14 Jul 2021). It would pour five-year-old stories into the news tab. This is the one that would have slipped through a simple "does it return RSS" check. |
| **NDTV Profit** `ndtvprofit.com/feed`, `/feed/rss` | **403** to automated requests. A FeedBurner mirror does answer, but routing around a site that has refused automated access is not something I will set up. Left out. |
| **Google News RSS** (per-sector queries) | The queries work and return 24–57 fresh items. But `news.google.com/robots.txt` is `Disallow: /` with an `Allow` list that does **not** cover `/rss/`. Fetching it on a schedule would be against their stated policy, so it is out. |

## The honest limits of my terms check

- I read `robots.txt` in full for Entrackr, The Hindu BusinessLine, Google News,
  Inc42 and YourStory, and checked the `<copyright>` line each feed carries.
- **Business Standard's `robots.txt` is behind an Akamai block** (403 to me), so
  I could not read their crawler policy. I have included the feed because they
  publish it at a documented public `/rss/` path and we store only headline,
  short extract and link — but you should be aware I could not verify it.
- **I did not read any publisher's full legal terms-of-use page.** robots.txt
  and the feed's own copyright notice are what I checked. If this goes in front
  of a wide audience, a human should look at the terms for Business Standard,
  The Hindu BusinessLine and Mint.

## Rules the worker must keep

- Store **headline, a short extract (240 chars, as now) and the link only**.
  Never the full article.
- Keep the existing dedupe and the "Indian startup news only" filter.
- Drop a feed that starts failing rather than leaving a dead entry in `FEEDS`.
- **Re-check the dates periodically.** The ET Startups case shows a feed can
  keep returning HTTP 200 and valid RSS long after anyone stopped publishing to
  it. A feed whose newest item is more than a few days old should be dropped.
