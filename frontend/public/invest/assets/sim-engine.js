/* India Investment: deterministic live price engine (dependency-free).
 *
 * Why this exists: unlisted startups have no real quote, and we have no
 * licensed real-time feed for them. This produces a SIMULATED price for any
 * instant, as a pure function of (company id, day, time). The browser and the
 * trading worker both call it, so everyone sees the same number and the worker
 * can price an order without any per-second polling.
 *
 * That property is the whole point. Cloudflare's Workers free plan allows
 * 100,000 requests/day; at 500+ students a 5-second poll would be millions of
 * requests. Here the browser computes the tick locally and only talks to the
 * worker when a human actually does something.
 *
 * Works in browsers and in a Cloudflare Worker / Node. NOT real market data.
 */
(function (root) {
  const IST_OFFSET_MS = 5.5 * 3600 * 1000;

  // The single source of truth for trading hours. Changing this changes the
  // browser countdown, the chart's x-axis and (once the worker patch is
  // applied) the server-side trade gate. 06:00 up to but not including 24:00
  // IST, every day of the week.
  const MARKET = {
    openMin: 6 * 60,
    closeMin: 24 * 60,
    openDays: [0, 1, 2, 3, 4, 5, 6],
    label: "6:00 am - 12:00 am IST, every day",
  };

  const STEP_MS = 5000;        // one simulated tick every 5 seconds
  const MINUTE_VOL = 0.0009;   // per-minute volatility (about 1.9% daily over 18h)
  const NEWS_HALFLIFE_MS = 30 * 60 * 1000;

  function istParts(ms) {
    const d = new Date(ms + IST_OFFSET_MS);
    return {
      y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay(),
      minOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(), sec: d.getUTCSeconds(),
      dayKey: d.toISOString().slice(0, 10),
    };
  }
  function istMidnightMs(ms) { const p = istParts(ms); return Date.UTC(p.y, p.mo, p.d) - IST_OFFSET_MS; }
  function openMsOfDay(ms) { return istMidnightMs(ms) + MARKET.openMin * 60000; }
  function closeMsOfDay(ms) { return istMidnightMs(ms) + MARKET.closeMin * 60000; }

  function marketStatus(nowMs) {
    const p = istParts(nowMs);
    const dayOpen = MARKET.openDays.includes(p.dow);
    const isOpen = dayOpen && p.minOfDay >= MARKET.openMin && p.minOfDay < MARKET.closeMin;
    if (isOpen) return { open: true, nextChangeMs: closeMsOfDay(nowMs), label: "closes" };
    let t = istMidnightMs(nowMs);
    for (let i = 0; i < 8; i++, t += 86400000) {
      const cand = t + MARKET.openMin * 60000;
      if (cand > nowMs && MARKET.openDays.includes(istParts(cand).dow)) {
        return { open: false, nextChangeMs: cand, label: "opens" };
      }
    }
    return { open: false, nextChangeMs: null, label: "opens" };
  }

  function countdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor(s % 3600 / 60)).padStart(2, "0");
    const x = String(s % 60).padStart(2, "0");
    return h + ":" + m + ":" + x;
  }

  // 32-bit string hash -> uniform [0,1)
  function hash01(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  function gauss(key) { // Box-Muller from two hashes
    const u = Math.max(1e-9, hash01(key + "|a")), v = hash01(key + "|b");
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* Which trading day a timestamp belongs to, and when that day opened.
   *
   * The market closes at 24:00, which is also the next IST date's 00:00, so a
   * timestamp exactly on the boundary is ambiguous. It is the close of the day
   * that just ended, not the start of the next one - otherwise asking for the
   * closing price lands before the next day's 06:00 open, clamps to zero
   * minutes elapsed, and hands back the opening price instead. */
  function dayContext(tMs) {
    const p = istParts(tMs);
    const onMidnight = p.minOfDay === 0 && p.sec === 0 && (tMs + IST_OFFSET_MS) % 60000 === 0;
    const ref = onMidnight ? tMs - 1 : tMs;
    return { dayKey: istParts(ref).dayKey, openMs: istMidnightMs(ref) + MARKET.openMin * 60000 };
  }

  const cache = new Map();
  // Log-return path anchored at market open, one value per minute, cached per
  // (id, day). path[0] is 0, so price at open == openPrice exactly.
  function minutePath(id, dayKey) {
    const k = id + "@" + dayKey;
    let p = cache.get(k);
    if (p) return p;
    const n = MARKET.closeMin - MARKET.openMin;
    p = new Float64Array(n + 1);
    const drift = (hash01(id + dayKey + "drift") - 0.5) * 0.01; // daily bias in [-0.5%, +0.5%]
    for (let i = 1; i <= n; i++) p[i] = p[i - 1] + gauss(id + "|" + dayKey + "|" + i) * MINUTE_VOL + drift / n;
    if (cache.size > 2000) cache.clear();
    cache.set(k, p);
    return p;
  }

  /* Simulated price at time tMs.
   *   openPrice     the previous daily close for that day
   *   newsImpulses  optional [{tMs, pct}], pct is +/- percent, 30-minute half life
   *
   * Outside market hours this clamps to the day's boundary, so the value at or
   * after 24:00 equals the engine's close exactly. The worker writes that same
   * number as the daily close, which is what keeps history and live agreeing.
   */
  function priceAt(id, openPrice, tMs, newsImpulses) {
    const ctx = dayContext(tMs);
    const n = MARKET.closeMin - MARKET.openMin;
    let m = (tMs - ctx.openMs) / 60000;                 // minutes since open
    m = Math.min(n, Math.max(0, m));
    const path = minutePath(id, ctx.dayKey);
    const i = Math.floor(m), f = m - i;
    const a = path[i], b = path[Math.min(n, i + 1)];
    // Linear interpolation plus a tiny seconds-level wobble so every 5s tick
    // visibly moves. Suppressed at the endpoints so open and close stay exact.
    const tick = Math.floor(tMs / STEP_MS);
    const wobble = gauss(id + "|w|" + tick) * MINUTE_VOL * 0.35;
    let lr = a + (b - a) * f + (m > 0 && m < n ? wobble : 0);
    if (newsImpulses) {
      for (const e of newsImpulses) {
        if (e.tMs <= tMs) lr += (e.pct / 100) * Math.pow(0.5, (tMs - e.tMs) / NEWS_HALFLIFE_MS);
      }
    }
    return Math.round(openPrice * Math.exp(lr) * 100) / 100;
  }

  /* The value the daily close should be written as for the day containing tMs. */
  function closeValue(id, openPrice, tMs, newsImpulses) {
    return priceAt(id, openPrice, closeMsOfDay(tMs), newsImpulses);
  }

  /* OHLC candles of bucketMin minutes, from the day's open up to tMs.
   * The final candle is marked forming: it is still being written. */
  function candles(id, openPrice, tMs, bucketMin, newsImpulses) {
    const start = openMsOfDay(tMs), end = Math.min(tMs, closeMsOfDay(tMs));
    const out = [], B = bucketMin * 60000;
    for (let t0 = start; t0 < end; t0 += B) {
      const t1 = Math.min(t0 + B, end);
      let o, h = -Infinity, l = Infinity, c;
      for (let t = t0; t <= t1; t += STEP_MS) {
        const px = priceAt(id, openPrice, Math.min(t, t1), newsImpulses);
        if (o === undefined) o = px;
        if (px > h) h = px;
        if (px < l) l = px;
        c = px;
      }
      out.push({ t: t0, o, h, l, c, forming: t0 + B > end });
    }
    return out;
  }

  const api = {
    MARKET, STEP_MS, NEWS_HALFLIFE_MS,
    marketStatus, countdown, priceAt, closeValue, candles,
    istParts, istMidnightMs, openMsOfDay, closeMsOfDay, dayContext,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SimEngine = api;
})(typeof self !== "undefined" ? self : this);
