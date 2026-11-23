# Data worker: changes to apply by hand

**Read this before you touch the worker.** You told me you are not sure the
`data-worker.js` in the handoff matches what is actually deployed on Cloudflare,
so this is a list of edits to make against *whatever is live*, not a file to
paste over it. Nothing here has been run against your worker. I have not changed
any worker code, and I never saw any of your secrets.

Apply these in order. Each one is independent: if you stop halfway the site still
works, it just keeps the old behaviour for the parts you have not done.

---

## 0. Before anything: the free-plan ceiling you are about to hit

I re-checked Cloudflare's current limits rather than trusting the numbers in the
original brief. From
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
(page updated 19 Nov 2026) and
[KV limits](https://developers.cloudflare.com/kv/platform/limits/)
(updated 30 Oct 2026), the Workers **Free** plan gives:

| Limit | Free plan |
| --- | --- |
| Requests | 100,000 / day |
| CPU time per HTTP request | 10 ms |
| CPU time per Cron Trigger | 10 ms |
| Subrequests per invocation | 50 |
| KV writes to different keys | **1,000 / day** |
| KV reads | 100,000 / day |
| KV writes to the same key | 1 / second |
| Cron Triggers per account | 5 |

### Requests are fine. KV writes are not.

You said 500 or more students. Working it through:

**Requests** — a student's browser now computes prices locally from the engine,
so watching the market costs *zero* worker requests. A session costs roughly 5
data files + 1 leaderboard + 2 account calls + a handful of trades, call it 15.
At 1,500 sessions a day that is about **22,500 requests**, comfortably inside
100,000. This is the whole reason the price engine is a shared pure function
instead of a quote endpoint — polling every 5 seconds at 500 users would be
millions of requests a day and would have needed a paid plan.

**KV writes are the problem.** Every server trade writes that student's
portfolio: one KV write. The cap is 1,000 writes a day across the whole account,
shared with the data job. If the news job runs every 15 minutes (96 runs) and
each run writes all five JSON files, that is 480 writes a day before a single
student trades — leaving about 500 trades a day for 500+ students.

So:

- **Do step 4 the cheap way.** The 15-minute news job must write only
  `news.json`, and only when the content actually changed. That is 96 writes a
  day at worst, not 480.
- **Even then, trading is the ceiling.** About 900 trades a day across all
  students, under two each. A single busy lesson will blow through it, and when
  it does, KV writes start failing - which means a student's trade appears to
  succeed in their browser and is silently lost on the server.

**I have not changed anything about this, because fixing it properly costs
money or a migration.** Your options, for you to pick:

1. **Keep the 4x/day news job** and accept ~980 trades/day. Cheapest, changes
   nothing, but the trade ceiling is still there.
2. **Move portfolios from KV to D1** (Cloudflare's SQL database). D1's free tier
   allows far more writes per day than KV's 1,000, and portfolios are exactly
   the sort of small row-based data it suits. This is a real migration of the
   `PORTFOLIO_STORE` code and needs care not to lose anyone's holdings. Free.
3. **Workers Paid, $5/month**, which removes the KV write cap. Costs money, so I
   am not doing it and not recommending it without your say-so.

My suggestion is **2**, done as its own piece of work, with 1 in the meantime.
Do not do 3 just to make this go away.

### The 10 ms CPU worry

A Cron Trigger gets **10 ms of CPU** on Free. The existing job parses the NSE
master (about 180 KB) and the BSE bhavcopy (about 900 KB) on every run. Fetch
time is I/O and does not count, but the CSV parsing does, and 900 KB of CSV is
very likely more than 10 ms of CPU. Your `meta.json` says the checks are
succeeding, so either it fits or Cloudflare is being lenient. **Watch the cron
invocation logs after you change the schedule.** If you see CPU-exceeded errors,
split the job: run the listing check once a day on its own trigger and let the
15-minute trigger do news only.

---

## 1. Drop the price engine in, unchanged

Copy `frontend/public/invest/assets/sim-engine.js` into the worker, at the top,
as-is. It is written to work in both a browser and a Worker (it exports via
`module.exports` if present, otherwise onto the global).

In a Worker module you will want it as a plain import or pasted inline, then:

```js
const SimEngine = (typeof module !== "undefined" && module.exports) ? module.exports : self.SimEngine;
```

**Do not edit the numbers in it.** The browser and the worker must run the exact
same engine or an order will fill at a price the student never saw. If you ever
change `MARKET`, `STEP_MS` or `MINUTE_VOL`, change it in the shipped file and
re-copy.

Verify with `node invest/test-sim-engine.js` — 79 checks, and it covers the
24:00 boundary case that the original reference engine got wrong.

## 2. Replace the market-hours gate

Find `marketOpenIST()` (around line 671 in the handoff copy) and the line in the
trade handler that uses it (around line 700):

```js
if (!marketOpenIST()) return jres({ error: "market_closed", detail: "Trading is disabled. NSE is currently closed." }, 400);
```

Replace the function body with the engine, so hours live in one place:

```js
function marketOpenIST() {
  return SimEngine.marketStatus(Date.now()).open;
}
```

and update the message, because it is no longer NSE's hours:

```js
if (!marketOpenIST()) {
  const st = SimEngine.marketStatus(Date.now());
  return jres({
    error: "market_closed",
    detail: "The market is closed. It opens in " +
            SimEngine.countdown(st.nextChangeMs - Date.now()) +
            " (" + SimEngine.MARKET.label + ")."
  }, 400);
}
```

This is now **06:00 to 24:00 IST, every day including weekends**, which is what
you chose. The gate must stay server-side: the browser shows a countdown from a
server-time offset, but it is only cosmetic and a student can change their own
clock.

Also search the worker for the import-disabled message (around line 717), which
says "during NSE market hours", and reword it.

## 3. Price trades with the engine and return the fill

In the trade handler, wherever the order is currently priced off the latest
daily close, price it from the engine at the server's own clock instead:

```js
const anchor = previousCloseFor(id);        // last stored close from a finished day
const impulses = newsImpulsesFor(id, news); // see step 3b - MUST match the browser
const price = SimEngine.priceAt(id, anchor, Date.now(), impulses);
```

Then **return that price in the response**:

```js
return jres({ ok: true, price, ... });
```

The front end already reads `d.price` and fills at it rather than at its own
computed number ([app.js](../frontend/public/invest/assets/app.js), in `trade()`),
so once the worker sends it, the two can never disagree.

`previousCloseFor(id)` must pick the last stored close from a day that has
**finished** — the same rule as `prevClose()` in app.js. If you hand it today's
own close the day starts from its own ending.

### 3b. News impulses must match the browser exactly

The engine takes `newsImpulses` and the browser builds them in `newsImpulses()`
in app.js. Port that function verbatim: same `RE_POS` / `RE_NEG` regexes, same
6-hour cutoff, same `1 + 3 * hashUnit(url || title)` magnitude, same 30-minute
half life. If the worker's impulse list differs by one story, the fill price
differs from the screen.

This is the single easiest thing to get wrong in this whole patch.

## 4. News every 15 minutes, and sectors

**Schedule.** In the dashboard or `wrangler.toml`:

```
*/15 * * * *
```

Cloudflare's docs note cron changes can take up to 15 minutes to propagate, so
do not panic if nothing happens immediately.

**Write only what changed.** Per step 0, the 15-minute run must touch
`news.json` alone, and skip the write entirely when the item list is unchanged:

```js
const next = JSON.stringify({ items, updated });
const prev = await env.SCALE_DATA.get("news.json");
if (prev !== next) await env.SCALE_DATA.put("news.json", next);
```

Keep the listing check, price history and `startups.json` on a **separate,
once-a-day trigger**. They do not need 15-minute freshness and they are what
costs CPU.

**Sector stamping.** Add a `sector` field to every news item. The front end
already classifies client-side as a fallback, but the worker should be
authoritative:

1. If the item is tagged to a tracked company, use that company's sector.
2. Otherwise run the keyword table — copy `SECTOR_HINTS` from app.js verbatim.
3. Otherwise `"General"`.

Once the worker stamps `sector`, the front end uses it as-is.

**More feeds.** Done and verified — see **[NEWS-FEEDS.md](NEWS-FEEDS.md)** for
the exact `FEEDS` array to paste, the evidence for each one, and the six
candidates I rejected.

Short version: six feeds added (Entrackr, Business Standard x2, The Hindu
BusinessLine x2, Mint Money), taking the worker from 6 to 12. VCCircle and
Financial Express publish no usable RSS, ET Startups is abandoned (serving
2020-21 items under a fresh `lastBuildDate`), NDTV Profit 403s automated
requests, and Google News RSS is disallowed by its own `robots.txt`.

That is 15 subrequests a run against the **50 per invocation** cap, so there is
room for a few more but not forty.

Keep the existing dedupe and the "Indian startup news only" filter exactly as
they are.

## 5. Write the daily close from the engine

At the end of each trading day the stored close must equal the engine's 24:00
value, or history and the live chart will disagree at the join.

```js
const close = SimEngine.closeValue(id, anchor, dayMs, impulses);
```

`closeValue` is exactly `priceAt` at 24:00 with the boundary handled — see the
`dayContext` comment in the engine for why that needed care.

**Stop regenerating history.** `buildSeries()` in the handoff copy rebuilds all
180 days from a seed on every run, with the window sliding forward each day. The
brief says past daily history must not be rewritten, and it currently is: the
whole path shifts as the start date moves. Change it to **append one close per
day to the stored series** and never recompute earlier days.

Also note `buildSeries` skips Saturdays and Sundays (`wd !== 0 && wd !== 6`).
With seven-day trading that filter has to go, or weekend days will be missing
from the charts.

## 6. Optional: `/api/time`

The browser takes the server clock from the `Date` header on the data responses,
which costs nothing extra. If you would rather be explicit, add:

```js
if (url.pathname === "/api/time") return jres({ now: Date.now() });
```

The front end will use the `Date` header regardless, so this is genuinely
optional.

---

## After you deploy

1. `node invest/test-sim-engine.js` passes.
2. Open the site while the market is open: the header counts down, prices move
   every 5 seconds, the last candle grows.
3. Place a trade. The confirmation should name an "executed price" and it should
   match what the server returned, not the browser's own guess.
4. Set your laptop clock to 3 am and try to trade. It must be refused by the
   server, not just by the page.
5. Check the cron invocation logs for CPU-exceeded errors (step 0).
6. Watch KV write counts for a day with real students on it. If they approach
   1,000, come back to the D1 option.
