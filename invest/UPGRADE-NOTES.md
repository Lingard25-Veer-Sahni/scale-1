# India Investment upgrade: what changed, what I tested, what I did not do

Done on 23 November 2026. The snapshot you sent matched your repo byte for byte,
so I worked directly in `frontend/public/invest/` — the folder the live site
actually ships from — and zipped that. Nothing is deployed; it goes out with your
next frontend deploy.

Your three answers shaped this: **market open every day**, **worker changes as a
patch** because you were not sure what is deployed, and **500+ students**, which
is what drove the request-load decisions.

---

## Files changed

| File | What happened |
| --- | --- |
| `frontend/public/invest/assets/sim-engine.js` | **New.** The live price engine, hours, candles. Also goes in the worker. |
| `frontend/public/invest/assets/app.js` | Rewired for live prices, live charts, the header clock, sector news, new wording. |
| `frontend/public/invest/assets/styles.css` | Appended: clock, live dot, tick flashes, timeframe row, sector chips, mobile rules. |
| `frontend/public/invest/index.html` | Title and description renamed; loads `sim-engine.js` before `app.js`. |
| `frontend/public/invest/data/startups.json` | 33 → **107** companies. |
| `frontend/public/invest/data/prices.json` | History for the 74 added companies. Existing 33 untouched. |
| `frontend/public/invest/data/graduated.json` | 19 → **44**: 25 companies have listed. |
| `frontend/public/invest/data/meta.json` | Counts refreshed. |
| `invest/test-sim-engine.js` | **New.** 79 checks, passing. |
| `invest/check_listings.py` | **New.** Live NSE/BSE listing check. |
| `invest/build_startups.py`, `invest/build_prices.py` | **New.** Rebuild the dataset. |
| `invest/inc42_unicorns_2026-08-15.tsv` | **New.** The cited source data, transcribed. |
| `invest/COMPANIES.md` | **New.** The company table with a source link per row. |
| `invest/WORKER-PATCH.md` | **New.** The worker changes, to apply by hand. |
| `.claude/launch.json` | Added a static server entry for local preview. |

Nothing outside `/invest` was touched. The main SCALE site, login, events,
payments, courses and admin are untouched.

## The seven requested changes

**1. Rename.** Done. "Unlisted Startup Exchange" is gone from the title, meta
description, header and everything else; `grep` finds it nowhere in the shipped
files. The Learn tab still explains that the companies are unlisted.

**2. Live prices.** Simulated, ticking every 5 seconds while open, labelled
"Simulated live price" next to every quote and "simulated" throughout. Nothing is
presented as a real quote. **I did not find a free licensed real feed and did not
use one.** The day starts at the previous stored close, news pushes the price
with a 30-minute half life, and the price freezes at the close when the market
shuts. Green/red flash on each tick, day change, and a LIVE dot that greys out.

**3. Live charts.** Line and candlestick are both live. Intraday 1m/5m/15m are
built from the engine with the right-hand candle forming (drawn hollow so it
reads as provisional); 1M/3M/6M come from stored history. Redrawn on
`requestAnimationFrame`, backed by device pixels so it stays sharp on retina.
Sparklines on the cards now show today's path and repaint on every tick.

**4. Hours and timer.** 06:00–24:00 IST, **every day**, in one constant
(`SimEngine.MARKET`). Header counts down every second off a server-time offset
taken from the `Date` header of the data responses, so a wrong laptop clock
cannot mislead. Every "9:15–15:30" and "NSE market hours" string is replaced.
Trades are refused when closed — and the worker must enforce this against its own
clock, which is step 2 of the patch.

**5. News by sector.** Sector chips with counts are now the primary filter;
source is a secondary dropdown and still printed on every story. Each item shows
a sector tag. The worker should stamp `sector`; until that patch lands the front
end classifies from the tagged company, then a keyword table, then "General".
Verified: clicking "AI" narrows 60 stories to 10 and all 10 carry that tag.

**6. More news sources.** **Not done — see below.**

**7. 100+ companies.** 107 tracked, from 33. See `invest/COMPANIES.md`.

## The company list

Source: the [Inc42 Indian Unicorn Tracker](https://inc42.com/features/indian-unicorn-tracker-funding-investors-revenue-and-more/),
page last updated 15 August 2026, transcribed verbatim into
`invest/inc42_unicorns_2026-08-15.tsv`. **No company and no number is invented.**
97 companies carry a cited valuation; the rest show no valuation and start at a
neutral Sim₹250, marked `price_basis: "default"`.

Every candidate was checked **live on 23 November 2026** against the NSE
main-board master (2,637 companies), the NSE SME master and that day's BSE
bhavcopy (5,011 scrips). This mattered more than expected: **25 of the companies
on that August list have since listed** — Lenskart, Meesho, Pine Labs, Physics
Wallah, Urban Company, Shiprocket, Money View, Zetwerk, BlackBuck, Ather Energy,
Swiggy, Delhivery and others. They went to `graduated.json`, not the tracked
list. Seven more were excluded by hand (Dubai or US headquarters, a NASDAQ
listing, a shutdown, and Blinkit as a subsidiary of listed Eternal).

**None of your existing 33 have listed.** All 33 keep their id, display name and
base price exactly, so no portfolio breaks. New prices land between Sim₹100 and
Sim₹730.

## What I tested in a browser

Served the real folder and drove it in a real browser, market open (20:40 IST).

- **Prices move.** Flipkart went Sim₹489.15 → 488.94 → 488.75 across screenshots
  about 15 and 55 seconds apart, and the forming candle's low extended 489.18 →
  488.40. Both the price and the last candle changed, as you asked.
- **Timer counts down.** 03:19:41 → 03:19:17 between the two screenshots.
- Candlestick and line both render; all six timeframes work.
- **Closed-market rejection works**: with the engine reporting closed, a buy is
  refused with "The market is closed. It opens in 03:00:00 (6:00 am – 12:00 am
  IST, every day)" and neither cash nor holdings move. The header flips to
  "Market closed" and the dot greys.
- A local practice buy fills and reports "executed price".
- 107 cards render, no zero or NaN prices; a full tick across all 107 costs 36 ms,
  well inside the 5-second budget.
- **No console errors at any point.**
- Mobile (375×812): layout stacks, no horizontal scroll, the clock collapses to a
  "Live" pill.
- `node invest/test-sim-engine.js` — 79 checks pass.
- No secrets in any shipped file (checked; the only password strings are the
  login form posting what the user typed).

## What I did NOT do, and what I could not verify

**The new news feeds (request 6) are not done.** The brief lists Entrackr,
VCCircle, ET Startups, Business Standard, Financial Express, BusinessLine, NDTV
Profit and Google News RSS, and says to check each one returns valid RSS and to
read its terms. I have not fetched or read the terms of any of them, so I have
added none. Adding a feed is a worker change anyway, and worker changes are a
patch you apply — step 4 of `WORKER-PATCH.md` has the procedure and the
subrequest ceiling. **This is the main piece of the brief left undone.**

**No worker code was changed.** You said you are not sure what is deployed, so
`WORKER-PATCH.md` is a list of edits against whatever is live, not a replacement
file. I have not run any of it.

**Server-side behaviour is unverified.** Everything about trade pricing, the
server market gate and the daily close is specified in the patch but has not been
executed anywhere. Until step 3 is applied, a logged-in student's order is still
priced by the old server logic and may not match the screen.

**Foreign listings are not machine-checked.** Freshworks, MakeMyTrip and ReNew
Power were excluded by hand because I know they trade on NASDAQ. Nothing catches
the next one automatically.

**The NSE SME master is served nearly empty** — one row. SME listings are
effectively unchecked. That is unchanged from your AUDIT.md, and it is why I left
the degraded/stale warning banners in place even after removing the all-clear one.

**Valuations are as of 15 August 2026** and may be stale; several of these
companies have raised or re-rated since.

**I did not test with a real logged-in account**, the leaderboard, or the admin
console, because that needs real credentials against your live worker.

## The thing you need to decide

**Workers Free gives 1,000 KV writes a day, and every trade is one write.** At
500+ students that is the ceiling you will hit first — not the request limit,
which the engine design keeps at roughly 22,500/day. A 15-minute news job makes
it worse unless it writes only `news.json`.

I have changed nothing about this and I am not recommending the paid plan.
Section 0 of `WORKER-PATCH.md` lays out the arithmetic and three options; the
free one is moving portfolios from KV to D1, as a separate piece of work.

Also: a Cron Trigger gets **10 ms of CPU** on Free, and the job parses a ~900 KB
BSE file. Watch the invocation logs after changing the schedule.

## One deliberate test change

Your `reference/test.js` asserts the market is shut on Saturday and reopens
Monday. You chose seven-day trading, so that assertion is now wrong by your own
decision. `invest/test-sim-engine.js` replaces it and asserts the opposite, plus
64 further checks.

While writing it I found a real bug in the reference engine: at exactly 24:00 the
IST date rolls to the next day, so asking for the closing price landed before the
*next* day's 06:00 open, clamped to zero minutes elapsed, and returned the
**opening** price instead of the close. Your daily closes would have been written
as the day's open. Fixed via `dayContext()`; there is a test for it.
