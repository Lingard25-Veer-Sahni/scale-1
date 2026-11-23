/* Tests for the live price engine.
 *
 *   node invest/test-sim-engine.js
 *
 * The engine ships to the browser at frontend/public/invest/assets/sim-engine.js
 * and the same file is meant to be pasted into the data worker, so this is the
 * one place both sides get checked.
 *
 * Market is open 06:00-24:00 IST EVERY day (openDays [0..6]). The older
 * reference test asserted Monday-Friday; that assertion is deliberately gone.
 */
const E = require("../frontend/public/invest/assets/sim-engine.js");
const assert = require("assert");

let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };

/* ---------------------------------------------------------------- hours -- */
// Tue 2026-11-24 10:00 IST = 04:30 UTC
const t = Date.UTC(2026, 10, 24, 4, 30, 0);
ok(E.marketStatus(t).open, "Tue 10:00 IST should be open");
ok(!E.marketStatus(Date.UTC(2026, 10, 24, 0, 29, 0)).open, "05:59 IST should be closed");
ok(E.marketStatus(Date.UTC(2026, 10, 24, 0, 30, 0)).open, "06:00 IST should be open");
ok(!E.marketStatus(Date.UTC(2026, 10, 24, 18, 30, 0)).open, "00:00 IST should be closed");

// Weekends are now trading days.
const sat = E.marketStatus(Date.UTC(2026, 10, 21, 6, 0, 0));   // Sat 11:30 IST
ok(sat.open, "Saturday 11:30 IST should be open now that openDays is all seven");
const sun = E.marketStatus(Date.UTC(2026, 10, 22, 6, 0, 0));   // Sun 11:30 IST
ok(sun.open, "Sunday 11:30 IST should be open");

// Closed just before 06:00 on a Sunday -> next open is 06:00 the same day.
const preSun = Date.UTC(2026, 10, 22, 0, 0, 0);                 // Sun 05:30 IST
const ns = E.marketStatus(preSun);
ok(!ns.open && E.istParts(ns.nextChangeMs).dow === 0, "Sun 05:30 should reopen the same Sunday");
ok(ns.nextChangeMs - preSun === 30 * 60000, "and that should be 30 minutes away");

/* --------------------------------------------------------- determinism -- */
const a = E.priceAt("flipkart", 488.23, t), b = E.priceAt("flipkart", 488.23, t);
assert.strictEqual(a, b, "same inputs must give the same price");
checks++;

let moved = 0, prev = a;
for (let i = 1; i <= 20; i++) {
  const p = E.priceAt("flipkart", 488.23, t + i * 5000);
  if (p !== prev) moved++;
  prev = p;
}
ok(moved >= 15, "price should move on nearly every 5s tick, moved on " + moved + "/20");

// Different companies must not move in lockstep.
const p1 = E.priceAt("flipkart", 500, t), p2 = E.priceAt("zepto", 500, t);
ok(p1 !== p2, "two companies at the same base must not have identical prices");

/* ------------------------------------------------------ open and close -- */
const openMs = E.openMsOfDay(t), closeMs = E.closeMsOfDay(t);
assert.strictEqual(E.priceAt("flipkart", 488.23, openMs), 488.23, "price at open must equal the previous close");
checks++;

// The close must be stable: no wobble at the boundary, and asking after
// midnight must give the same answer as asking exactly at it.
const c1 = E.priceAt("flipkart", 488.23, closeMs);
const c2 = E.closeValue("flipkart", 488.23, t);
assert.strictEqual(c1, c2, "closeValue must equal priceAt(close)");
checks++;
assert.strictEqual(E.priceAt("flipkart", 488.23, closeMs), c1, "the close must be stable across calls");
checks++;
ok(c1 !== 488.23, "the close must not collapse back to the open (the 24:00 date-rollover bug)");
// Continuous into the boundary: the last second before midnight carries the
// seconds-level wobble, so it is near the close rather than identical to it.
ok(Math.abs(E.priceAt("flipkart", 488.23, closeMs - 1000) / c1 - 1) < 0.005, "price should be continuous into the close");
// One minute past midnight is the NEXT trading day, pre-open, so it anchors to
// that day's opening price instead.
assert.strictEqual(E.priceAt("flipkart", 488.23, closeMs + 60000), 488.23, "after midnight the next day anchors at its own open");
checks++;

/* --------------------------------------------------------------- news --- */
const base = E.priceAt("flipkart", 488.23, t);
const withNews = E.priceAt("flipkart", 488.23, t, [{ tMs: t - 60000, pct: 5 }]);
ok(withNews > base, "a +5% impulse one minute old should lift the price");
const decayed = E.priceAt("flipkart", 488.23, t, [{ tMs: t - 6 * 3600 * 1000, pct: 5 }]);
ok(Math.abs(decayed - base) < Math.abs(withNews - base), "a six-hour-old impulse should have faded");
const future = E.priceAt("flipkart", 488.23, t, [{ tMs: t + 60000, pct: 5 }]);
assert.strictEqual(future, base, "an impulse in the future must not apply yet");
checks++;

/* ------------------------------------------------------------ candles --- */
const cs = E.candles("flipkart", 488.23, t + 90000, 5);
ok(cs.length === 49, "06:00 to 10:01 in 5m buckets should be 49 candles, got " + cs.length);
ok(cs[cs.length - 1].forming, "the last candle should be marked forming");
ok(!cs[0].forming, "the first candle should be closed");
for (const c of cs) {
  ok(c.h >= c.o && c.h >= c.c && c.l <= c.o && c.l <= c.c, "each candle's high/low must bracket its open/close");
}
assert.strictEqual(cs[0].o, 488.23, "the first candle must open at the previous close");
checks++;

// Buckets must tile the same ground at every resolution.
for (const bucket of [1, 5, 15]) {
  const k = E.candles("flipkart", 488.23, t, bucket);
  ok(k.length === (t - openMs) / 60000 / bucket, bucket + "m candle count");
  ok(k[k.length - 1].c === E.priceAt("flipkart", 488.23, t), bucket + "m last close should equal the live price");
}

const lo = Math.min(...cs.map(c => c.l)), hi = Math.max(...cs.map(c => c.h));
console.log("range 06:00-10:00:", lo, hi, "| live", a, "| ticks that moved:", moved + "/20");
console.log("countdown to close:", E.countdown(E.marketStatus(t).nextChangeMs - t));
console.log(checks + " checks passed");
