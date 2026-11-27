/* SCALE India Investment
   Static front-end. Company, news and listing data come from data/*.json,
   refreshed by the Cloudflare data worker (see data/meta.json).

   Prices are SIMULATED and computed in the browser by sim-engine.js, as a pure
   function of (company, time). The worker runs the same engine, so the price a
   student sees is the price their order fills at - without the site polling for
   quotes, which at 500+ users would blow straight through Cloudflare's free
   request allowance.

   Paper trading state lives in this browser only (localStorage when available);
   logged-in accounts trade against the server instead. */

const SHELL_HTML = `
<header class="topbar">
  <div class="brand">
    <img class="logo-img" src="/invest/assets/logo.png" alt="SCALE logo" width="36" height="36">
    <div>
      <div class="brand-name">SCALE India Investment</div>
      <div class="brand-sub">Learning simulator &middot; simulated prices, real news</div>
    </div>
  </div>
  <div class="market-clock" id="marketClock" title="Trading hours">
    <span class="live-dot" id="liveDot"></span>
    <span class="clock-text" id="clockText">-</span>
  </div>
  <div class="index-pill" id="indexPill" title="Equal-weight index of all tracked startups">
    <span class="pill-label">SCALE INDEX</span>
    <span class="pill-value" id="indexValue">-</span>
    <span class="pill-change" id="indexChange">-</span>
  </div>
  <nav class="tabs" id="tabs">
    <button data-tab="market" class="active">Market</button>
    <button data-tab="news">News <span class="count" id="newsCount"></span></button>
    <button data-tab="portfolio">Portfolio</button>
    <button data-tab="watchlist">Watchlist</button>
    <button data-tab="leaderboard">Leaderboard</button>
    <button data-tab="account">Account</button>
    <button data-tab="learn">Learn</button>
  </nav>
</header>
<div class="notice">
  <span class="dot"></span>
  <span class="notice-text">Every price here is <strong>simulated</strong> and shown in <strong>SimRupees (Sim₹)</strong>, a virtual currency for learning. These companies are unlisted, so they have no real market price and nothing on this page is a real quote. No real money is involved.
  Company news and listing status refresh automatically from our data worker. Nothing here is investment advice.</span>
</div>
<main id="main"></main>
<footer>
  <span id="footerMeta">Loading...</span>
  <span class="sep">&middot;</span>
  <span>Built for SCALE students. Data: public RSS feeds + NSE listed-company master.</span>
</footer>`;

function startScale(rootEl, injected) {
  rootEl.innerHTML = SHELL_HTML;
  wireChrome();
  if (injected) {
    applyData(injected.su, injected.pr, injected.ne, injected.gr, injected.me);
  } else {
    load();
  }
}

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const store = (() => {
  try {
    const t = "__scale_probe";
    localStorage.setItem(t, "1");
    localStorage.removeItem(t);
    return localStorage;
  } catch (e) {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  }
})();

const state = {
  tab: "market",
  sector: "All",
  search: "",
  sort: "name",
  openId: null,
  tradeMsg: null,
  startups: [],
  prices: {},
  news: [],
  graduated: [],
  meta: {},
  watch: JSON.parse(store.getItem("scale_watch") || "[]"),
  portfolio: JSON.parse(store.getItem("scale_portfolio") || "null"),
  newsFilter: { sector: "All", src: "All", q: "" },
  chartMode: "line",
  timeframe: "5m",
  timeOffsetMs: 0,
  dataSource: "cached",
  lb: { status: "idle", rows: [], error: null, joined: false },
  profile: JSON.parse(store.getItem("scale_profile") || "null"),
  acct: {
    token: store.getItem("scale_acct_token") || "",
    username: "", isAdmin: false, approvedUntil: null,
    serverTrades: null, msg: null, status: null,
    admin: null, restoring: false,
  },
};

const START_CASH = 1000000; // Sim₹10,00,000 virtual SimRupees

if (!state.portfolio) {
  state.portfolio = { cash: START_CASH, holdings: {}, txns: [] };
}

function saveLocal() {
  store.setItem("scale_watch", JSON.stringify(state.watch));
  store.setItem("scale_portfolio", JSON.stringify(state.portfolio));
}

/* ------------------------------------------------------------ helpers ---- */
// All amounts are SimRupees ("Sim₹"), a virtual learning currency - not real rupees.
const inr = (n, d = 2) =>
  "Sim₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const inr0 = (n) => "Sim₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });

function usd(n) {
  if (!n) return "n/a";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1).replace(/\.0$/, "") + " Bn";
  return "$" + Math.round(n / 1e6) + " Mn";
}
function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function series(id) { return state.prices[id] || []; }

/* ----------------------------------------------------- live simulation ---
 * Nothing below is a real quote. SimEngine turns (company, time) into a price,
 * anchored to the company's last stored daily close.
 */

// Server clock, not the device clock. A student with a wrong system time would
// otherwise see a nonsense countdown and a price from the wrong point in the
// day. Cosmetic only: the worker enforces hours against its own clock.
const now = () => Date.now() + (state.timeOffsetMs || 0);

/* The anchor for today's path: the most recent stored close from a day that
 * has already finished. If the worker has already written today's close we
 * must not use it as today's opening price, or the day would start from its
 * own ending. */
function prevClose(id) {
  const s = series(id);
  if (!s.length) return 0;
  const today = SimEngine.istParts(now()).dayKey;
  for (let i = s.length - 1; i >= 0; i--) if (s[i].d < today) return s[i].c;
  return s[0].c;
}

/* When the market is shut the price must sit still at the last close rather
 * than drifting. With 06:00-24:00 every day the only closed window is
 * 00:00-06:00 IST, and the close that applies is that day's 00:00. */
function effectiveNow() {
  const n = now();
  return SimEngine.marketStatus(n).open ? n : SimEngine.istMidnightMs(n);
}

/* News impulses: real headlines move the simulated price, which is what the
 * site has always claimed. Positive stories nudge up, negative down, decaying
 * with a 30-minute half life.
 *
 * KEEP IN SYNC WITH THE WORKER. The worker prices orders with the same engine,
 * and if its impulse list differs the fill will not match what was on screen.
 * See invest/WORKER-PATCH.md. */
const RE_POS = /raises|raised|funding|valuation|profit|profitable|growth|expands|launch|partnership|acquires|record|surge|wins|unicorn|hires|milestone|crosses/i;
const RE_NEG = /loss|layoff|lays off|shuts|shutdown|probe|fraud|fine|penalty|delays|defers|on hold|shelve|crash|falls|drops|\bcut\b|exits|resigns|\bban\b|downround|down round/i;

function newsImpulses(id) {
  const cutoff = now() - 6 * 3600 * 1000;   // older than this has decayed to nothing
  const out = [];
  for (const n of state.news) {
    if (!(n.startups || []).includes(id)) continue;
    const tMs = Date.parse(n.date);
    if (!isFinite(tMs) || tMs < cutoff) continue;
    const text = (n.title || "") + " " + (n.summary || "");
    const pos = RE_POS.test(text), neg = RE_NEG.test(text);
    if (!pos && !neg) continue;
    // Size is a function of the headline itself, so every client agrees.
    const mag = 1 + 3 * hashUnit(n.url || n.title);
    out.push({ tMs, pct: (neg && !pos ? -mag : mag) });
  }
  return out;
}

// Same 32-bit hash the engine uses, so impulse sizes are stable everywhere.
function hashUnit(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/* The live simulated price. This is what every screen shows and what a local
 * practice trade fills at. */
function px(id) {
  const anchor = prevClose(id);
  if (!anchor) return 0;
  return SimEngine.priceAt(id, anchor, effectiveNow(), newsImpulses(id));
}

function dayChange(id) {
  const anchor = prevClose(id);
  if (!anchor) return 0;
  return (px(id) / anchor - 1) * 100;
}

const chgCls = (v) => (v >= 0 ? "up" : "down");
const chgTxt = (v) => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";

/* Today's simulated path, sampled every stepMin minutes from the day's open to
 * now. Sampled rather than built from candles() on purpose: candles walk every
 * 5-second tick, which across 100+ cards every 5 seconds would be millions of
 * evaluations a minute. Sampling gives the same shape for a sparkline. */
function intradayPoints(id, stepMin) {
  const anchor = prevClose(id);
  if (!anchor) return [];
  const t = effectiveNow();
  const ctx = SimEngine.dayContext(t);
  if (t <= ctx.openMs) return [];
  const imp = newsImpulses(id);
  const step = (stepMin || 15) * 60000;
  const pts = [anchor];
  for (let x = ctx.openMs + step; x < t; x += step) pts.push(SimEngine.priceAt(id, anchor, x, imp));
  pts.push(SimEngine.priceAt(id, anchor, t, imp));
  return pts;
}

function sparkPolyline(vals, w, h) {
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) =>
    `${(i / (vals.length - 1) * w).toFixed(1)},${(h - 3 - (v - min) / span * (h - 6)).toFixed(1)}`
  ).join(" ");
  return { pts, up: vals[vals.length - 1] >= vals[0] };
}

/* Intraday while there is a day to show, otherwise the daily history. Carries
 * data-spark so the tick loop can repaint it without a full re-render. */
function sparkline(id, w = 260, h = 44) {
  let vals = intradayPoints(id);
  if (vals.length < 2) vals = series(id).slice(-60).map(p => p.c);
  const line = sparkPolyline(vals, w, h);
  if (!line) return `<svg class="spark" data-spark="${id}" width="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"></svg>`;
  return `<svg class="spark" data-spark="${id}" width="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${line.pts}" fill="none" stroke="${line.up ? "#2fbf71" : "#e5534b"}" stroke-width="1.8"/></svg>`;
}

/* Repaint one sparkline in place. */
function refreshSpark(el) {
  const id = el.dataset.spark;
  const w = 260, h = 44;
  let vals = intradayPoints(id);
  if (vals.length < 2) vals = series(id).slice(-60).map(p => p.c);
  const line = sparkPolyline(vals, w, h);
  if (!line) return;
  el.innerHTML = `<polyline points="${line.pts}" fill="none" stroke="${line.up ? "#2fbf71" : "#e5534b"}" stroke-width="1.8"/>`;
}

/* Chart timeframes. The three intraday ones are built live from the engine and
 * keep updating; the daily ones come from stored history, which the engine
 * never rewrites. */
const TIMEFRAMES = [
  { key: "1m", label: "1m", bucket: 1, title: "Today, 1-minute candles" },
  { key: "5m", label: "5m", bucket: 5, title: "Today, 5-minute candles" },
  { key: "15m", label: "15m", bucket: 15, title: "Today, 15-minute candles" },
  { key: "1M", label: "1M", days: 22, title: "About one month of daily closes" },
  { key: "3M", label: "3M", days: 66, title: "About three months of daily closes" },
  { key: "6M", label: "6M", days: 180, title: "About six months of daily closes" },
];
const tfOf = (key) => TIMEFRAMES.find(t => t.key === key) || TIMEFRAMES[1];
const isIntraday = (key) => !!tfOf(key).bucket;

function badges(s) {
  const out = [];
  if (s.ipo_watch) out.push('<span class="badge ipo">IPO WATCH</span>');
  if ((s.valuation_usd || 0) >= 1e9) out.push('<span class="badge unicorn">UNICORN</span>');
  if (!s.funding_usd) out.push('<span class="badge bootstrap">BOOTSTRAPPED</span>');
  return out.length ? `<div class="badges">${out.join("")}</div>` : "";
}

/* ------------------------------------------------------------- market ---- */
function sectors() {
  return ["All", ...new Set(state.startups.map(s => s.sector))].sort((a, b) =>
    a === "All" ? -1 : b === "All" ? 1 : a.localeCompare(b));
}

function filteredStartups() {
  let list = state.startups.filter(s =>
    (state.sector === "All" || s.sector === state.sector) &&
    (!state.search || (s.name + " " + s.sector + " " + (s.hq || "")).toLowerCase().includes(state.search)));
  const by = {
    name: (a, b) => a.name.localeCompare(b.name),
    valuation: (a, b) => (b.valuation_usd || 0) - (a.valuation_usd || 0),
    gainers: (a, b) => dayChange(b.id) - dayChange(a.id),
    losers: (a, b) => dayChange(a.id) - dayChange(b.id),
    price: (a, b) => px(b.id) - px(a.id),
  };
  return list.sort(by[state.sort] || by.name);
}

function cardHtml(s) {
  const c = px(s.id), ch = dayChange(s.id);
  const watched = state.watch.includes(s.id);
  return `<div class="card" data-open="${s.id}">
    <div class="card-head">
      <div>
        <div class="card-name">${esc(s.name)}</div>
        <div class="card-sector">${esc(s.sector)} &middot; ${esc(s.hq || "")}</div>
      </div>
      <button class="watch-btn ${watched ? "on" : ""}" data-watch="${s.id}" title="Watchlist">${watched ? "★" : "☆"}</button>
    </div>
    ${badges(s)}
    <div class="price-row">
      <span class="price" data-px="${s.id}">${inr(c)}</span>
      <span class="change ${chgCls(ch)}" data-chg="${s.id}">${chgTxt(ch)}</span>
    </div>
    ${sparkline(s.id)}
    <div class="meta-row">
      <span>Valuation <span class="valuation">${usd(s.valuation_usd)}</span></span>
      <span>Founded ${s.founded || "?"}</span>
    </div>
  </div>`;
}

/* Inline detail drawer: expands full-width right after the open card, so it
   always appears where the user clicked (works inside any viewer). */
function drawerHtml(id) {
  const s = state.startups.find(x => x.id === id);
  if (!s) return "";
  const c = px(id), ch = dayChange(id);
  const sNews = state.news.filter(n => (n.startups || []).includes(id)).slice(0, 5);
  const h = state.portfolio.holdings[id];
  const msg = state.tradeMsg && state.tradeMsg.id === id ? state.tradeMsg : null;
  return `<div class="drawer" id="drawer">
    <div class="drawer-head">
      <div>
        <span class="drawer-title">${esc(s.name)}</span>
        ${s.ipo_watch ? '<span class="badge ipo">IPO WATCH</span>' : ""}
        <div style="color:var(--muted);font-size:13px">${esc(s.sector)} &middot; ${esc(s.hq || "")} &middot; founded ${s.founded || "?"}</div>
      </div>
      <button class="close" data-close>&times;</button>
    </div>
    <div class="price-row">
      <span class="price" style="font-size:26px" data-px="${id}">${inr(c)}</span>
      <span class="change ${chgCls(ch)}" data-chg="${id}">${chgTxt(ch)} today</span>
      <span class="sim-tag">Simulated live price</span>
    </div>
    <div class="chart-toggle">
      <button class="chip ${state.chartMode !== "candle" ? "on" : ""}" data-chartmode="line">Line</button>
      <button class="chip ${state.chartMode === "candle" ? "on" : ""}" data-chartmode="candle">Candlestick</button>
      <span class="tf-sep"></span>
      ${TIMEFRAMES.map(tf =>
        `<button class="chip ${state.timeframe === tf.key ? "on" : ""}" data-tf="${tf.key}" title="${esc(tf.title)}">${esc(tf.label)}</button>`).join("")}
    </div>
    <canvas id="chart" width="680" height="220"></canvas>
    <div class="kv">
      <div class="cell"><div class="k">Valuation (reported)</div><div class="v">${usd(s.valuation_usd)}</div></div>
      <div class="cell"><div class="k">Total funding</div><div class="v">${s.funding_usd ? usd(s.funding_usd) : "Bootstrapped"}</div></div>
      <div class="cell"><div class="k">Investors</div><div class="v">${esc((s.investors || []).slice(0, 3).join(", "))}</div></div>
      <div class="cell"><div class="k">You hold</div><div class="v" id="youHold">${h ? h.qty + " @ " + inr(h.avg) : "-"}</div></div>
    </div>
    <div class="blurb">${esc(s.blurb || "")}</div>
    <div class="trade-box">
      <input type="number" id="qty" min="1" step="1" value="10" aria-label="Quantity">
      <button class="btn" data-buy="${id}">Buy</button>
      <button class="btn sell" data-sell="${id}" ${h ? "" : "disabled"}>Sell</button>
      <span style="color:var(--muted);font-size:12px">Cash: <span id="cashLeft">${inr0(state.portfolio.cash)}</span></span>
    </div>
    <div class="trade-msg ${msg ? msg.cls : ""}" id="tradeMsg">${msg ? esc(msg.text) : ""}</div>
    ${sNews.length ? `<div class="modal-news"><h3 style="font-size:14px;margin-bottom:6px">Latest news</h3>
      ${sNews.map(n => `<div style="margin-bottom:6px"><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>
        <span style="color:var(--muted);font-size:12px"> &middot; ${esc(n.source)}, ${ago(n.date)}</span></div>`).join("")}</div>` : ""}
  </div>`;
}

function verifyChipHtml() {
  const ec = (state.meta && state.meta.exchange_check) || {};
  if (!state.meta.updated) return "";
  const checked = new Date(state.meta.updated).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
  const ageDays = (Date.now() - new Date(state.meta.updated).getTime()) / 86400000;
  const failed = [["NSE", ec.nse_master_ok], ["NSE SME", ec.nse_sme_ok], ["BSE", ec.bse_bhavcopy_ok]]
    .filter(([, ok]) => ok === false).map(([n]) => n);
  if (failed.length) {
    return `<div class="verify-chip warn">Listing check degraded (${failed.join(", ")} unreachable). Companies stay tracked; unlisted status is not fully checked right now.</div>`;
  }
  if (ageDays > 3) {
    return `<div class="verify-chip warn">Listing check stale (last run ${checked}). Unlisted status is not freshly verified.</div>`;
  }
  // Checks passed: say nothing. The long "coverage is partial" banner used to
  // sit here on every page load, which made the normal case look like a
  // warning. The caveats now live in the Learn tab instead, and this chip is
  // reserved for the cases that genuinely need attention above.
  return "";
}

function renderMarket() {
  const list = filteredStartups();
  const cards = list.map(s => cardHtml(s) + (state.openId === s.id ? drawerHtml(s.id) : ""));
  return `
    <div class="section-title">Market <span style="color:var(--muted);font-size:13px;font-weight:400">${state.startups.length} unlisted startups tracked</span></div>
    <div class="section-sub">Simulated prices move every 5 seconds while the market is open. Click any company for its live chart, story and trading desk.</div>
    ${verifyChipHtml()}
    <div class="toolbar">
      <input class="search" id="search" placeholder="Search name, sector, city..." value="${esc(state.search)}">
      <select class="sort" id="sort">
        <option value="name">Sort: Name</option>
        <option value="gainers">Sort: Top gainers</option>
        <option value="losers">Sort: Top losers</option>
        <option value="valuation">Sort: Valuation</option>
        <option value="price">Sort: Price</option>
      </select>
      <div class="chips">${sectors().map(sec =>
        `<button class="chip ${sec === state.sector ? "active" : ""}" data-sector="${esc(sec)}">${esc(sec)}</button>`).join("")}
      </div>
    </div>
    <div class="grid">${cards.join("") || '<div class="empty">No startups match.</div>'}</div>`;
}

/* --------------------------------------------------------------- news ---
 * Sector is the primary filter. The worker is meant to stamp each item with a
 * `sector`; until that patch is deployed this classifies client-side from the
 * tagged company, then from keywords, so the chips work either way.
 */

// Keyword fallbacks, checked only when no tagged company settles the sector.
const SECTOR_HINTS = [
  ["Fintech", /fintech|\bupi\b|payments?|lending|neobank|insurance tech|wealthtech|\bnbfc\b|credit card|\bloan/i],
  ["Edtech", /edtech|ed-?tech|learning app|tutor|upskilling|test prep|coaching/i],
  ["SaaS", /\bsaas\b|enterprise software|\bapi\b platform|developer tool|\bcrm\b|\berp\b|cloud software/i],
  ["Quick commerce", /quick ?commerce|10-?minute|instant delivery|dark store|\bq-?comm/i],
  ["E-commerce", /e-?commerce|online marketplace|\bd2c\b|direct to consumer|online retail/i],
  ["Mobility", /mobility|ride ?hailing|cab\b|scooter|electric vehicle|\bev\b|bike taxi|charging/i],
  ["Healthtech", /healthtech|health-?tech|telemedicine|diagnostics|pharmacy|hospital|medtech|wellness/i],
  ["Logistics", /logistics|supply chain|warehous|freight|last ?mile|shipping|courier/i],
  ["Gaming", /gaming|esports|\bgame\b|fantasy sports/i],
  ["AI", /\bai\b|artificial intelligence|machine learning|\bllm\b|foundation model|generative/i],
  ["Agritech", /agritech|agri-?tech|farmer|agriculture|farm/i],
  ["Spacetech", /spacetech|space-?tech|satellite|launch vehicle|rocket/i],
];

function newsSector(item) {
  if (item.sector) return item.sector;                    // worker-stamped, preferred
  for (const id of item.startups || []) {
    const st = state.startups.find(s => s.id === id);
    if (st && st.sector) return st.sector;
  }
  const text = (item.title || "") + " " + (item.summary || "");
  for (const [name, re] of SECTOR_HINTS) if (re.test(text)) return name;
  return "General";
}

function newsSectors() {
  const counts = new Map();
  for (const i of state.news) {
    const s = newsSector(i);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  // Busiest sectors first; "General" always last so it never leads.
  const names = [...counts.keys()].sort((a, b) =>
    a === "General" ? 1 : b === "General" ? -1 : (counts.get(b) - counts.get(a)) || a.localeCompare(b));
  return { names, counts };
}

function renderNews() {
  const f = state.newsFilter;
  const { names, counts } = newsSectors();
  const sources = ["All", ...new Set(state.news.map(i => i.source).filter(Boolean))].sort((a, b) =>
    a === "All" ? -1 : b === "All" ? 1 : a.localeCompare(b));
  const q = (f.q || "").toLowerCase();
  const items = state.news.filter(i =>
    (f.sector === "All" || newsSector(i) === f.sector) &&
    (f.src === "All" || i.source === f.src) &&
    (!q || (i.title || "").toLowerCase().includes(q) || (i.summary || "").toLowerCase().includes(q)));
  return `
    <div class="section-title">Startup News</div>
    <div class="section-sub">Headlines and short extracts from public feeds, filtered to Indian startups. Links open the original publisher - full articles are never copied here. Coverage is best-effort, not exhaustive.</div>
    <div class="news-filters">
      <button class="chip ${f.sector === "All" ? "on" : ""}" data-newssector="All">All sectors <span class="chip-n">${state.news.length}</span></button>
      ${names.map(s => `<button class="chip ${f.sector === s ? "on" : ""}" data-newssector="${esc(s)}">${esc(s)} <span class="chip-n">${counts.get(s)}</span></button>`).join("")}
    </div>
    <div class="news-filters sub">
      <label class="news-srclabel" for="newsSrc">Source</label>
      <select class="sort" id="newsSrc">
        ${sources.map(src => `<option value="${esc(src)}" ${f.src === src ? "selected" : ""}>${src === "All" ? "All sources" : esc(src)}</option>`).join("")}
      </select>
      <input type="search" id="newsSearch" placeholder="Filter by keyword..." value="${esc(f.q || "")}" aria-label="Filter news by keyword">
    </div>
    ${items.map(i => `
      <div class="news-item">
        <h3><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
        <div class="news-meta">
          <span class="sector-tag">${esc(newsSector(i))}</span>
          <span>${esc(i.source)}</span><span>&middot;</span><span>${ago(i.date)}</span>
          ${(i.startups || []).map(id => {
            const st = state.startups.find(s => s.id === id);
            return st ? `<span class="tag">${esc(st.name)}</span>` : "";
          }).join("")}
        </div>
        ${i.summary ? `<div class="news-summary">${esc(i.summary)}...</div>` : ""}
      </div>`).join("") || '<div class="empty">No stories match this filter.</div>'}`;
}

/* ---------------------------------------------------------- portfolio ---- */
function holdingValue() {
  return Object.entries(state.portfolio.holdings).reduce((v, [id, h]) => v + h.qty * px(id), 0);
}
function renderPortfolio() {
  const p = state.portfolio;
  const hv = holdingValue();
  const total = p.cash + hv;
  const pnl = total - START_CASH;
  const rows = Object.entries(p.holdings);
  return `
    <div class="section-title">My Portfolio</div>
    <div class="section-sub">Paper trading with ${inr0(START_CASH)} SimRupees of virtual cash. Saved in this browser only.</div>
    <div class="stat-row">
      <div class="stat"><div class="k">Total value</div><div class="v">${inr0(total)}</div></div>
      <div class="stat"><div class="k">Cash</div><div class="v">${inr0(p.cash)}</div></div>
      <div class="stat"><div class="k">Invested</div><div class="v">${inr0(hv)}</div></div>
      <div class="stat"><div class="k">P&amp;L</div><div class="v ${chgCls(pnl)}">${pnl >= 0 ? "+" : ""}${inr0(pnl)}</div></div>
    </div>
    <div class="panel">
      <h3>Allocation</h3>
      ${allocationPie(p)}
    </div>
    <div class="panel">
      <h3>Holdings</h3>
      ${rows.length ? `<table><thead><tr>
        <th>Startup</th><th class="num">Qty</th><th class="num">Avg cost</th><th class="num">Last</th><th class="num">Value</th><th class="num">P&amp;L</th><th></th>
      </tr></thead><tbody>
      ${rows.map(([id, h]) => {
        const st = state.startups.find(s => s.id === id);
        if (!st) return "";
        const last = px(id), val = h.qty * last, pl = val - h.qty * h.avg;
        return `<tr>
          <td><a href="#" data-open="${id}">${esc(st.name)}</a></td>
          <td class="num">${h.qty}</td>
          <td class="num">${inr(h.avg)}</td>
          <td class="num">${inr(last)}</td>
          <td class="num">${inr0(val)}</td>
          <td class="num ${chgCls(pl)}">${pl >= 0 ? "+" : ""}${inr0(pl)}</td>
          <td class="num"><button class="btn sm sell" data-sell="${id}">Sell</button></td>
        </tr>`;
      }).join("")}</tbody></table>` : '<div class="empty">No holdings yet. Buy something from the Market tab.</div>'}
    </div>
    <div class="panel">
      <h3>Transactions</h3>
      ${p.txns.length ? `<table><thead><tr>
        <th>When</th><th>Side</th><th>Startup</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th>
      </tr></thead><tbody>
      ${p.txns.slice().reverse().map(t => `<tr>
        <td>${new Date(t.ts).toLocaleString("en-IN")}</td>
        <td class="${t.side === "BUY" ? "up" : "down"}">${t.side}</td>
        <td>${esc(t.name)}</td>
        <td class="num">${t.qty}</td>
        <td class="num">${inr(t.price)}</td>
        <td class="num">${inr0(t.qty * t.price)}</td>
      </tr>`).join("")}</tbody></table>` : '<div class="empty">No transactions yet.</div>'}
    </div>
    <button class="btn danger" id="resetPortfolio">Reset portfolio</button>`;
}


/* ------------------------------------------------------ allocation pie ---- */
function allocationPie(p) {
  const parts = Object.entries(p.holdings).map(([id, h]) => {
    const st = state.startups.find(x => x.id === id);
    return st ? { name: st.name, v: h.qty * px(id) } : null;
  }).filter(x => x && x.v > 0);
  if (p.cash > 0) parts.push({ name: "Cash (uninvested)", v: p.cash });
  const total = parts.reduce((a, b) => a + b.v, 0);
  if (!total) return '<div class="empty">Nothing to allocate yet - buy a startup on the Market tab and the pie will show your mix of SimRupee holdings.</div>';
  const COLORS = ["#e5534b", "#2fbf71", "#4f8ef7", "#e2b93b", "#a06ef7", "#f77fb0", "#41c7c7", "#f7884f", "#8bd450", "#6b7ff7"];
  const CX = 90, CY = 90, R = 78, IR = 46;
  let a0 = -Math.PI / 2;
  const arcs = parts.map((pt, i) => {
    const frac = pt.v / total;
    const a1 = a0 + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const p = (a, r) => (CX + r * Math.cos(a)).toFixed(2) + "," + (CY + r * Math.sin(a)).toFixed(2);
    const d = frac >= 0.9999
      ? `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX - 0.01} ${CY - R} M ${CX} ${CY - IR} A ${IR} ${IR} 0 1 0 ${CX + 0.01} ${CY - IR}`
      : `M ${p(a0, IR)} L ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, IR)} A ${IR} ${IR} 0 ${large} 0 ${p(a0, IR)} Z`;
    const col = COLORS[i % COLORS.length];
    a0 = a1;
    return { d, col, name: pt.name, pct: (frac * 100).toFixed(1), v: pt.v };
  });
  return `<div class="pie-wrap">
    <svg viewBox="0 0 180 180" class="pie" role="img" aria-label="Portfolio allocation pie chart">
      ${arcs.map(a => `<path d="${a.d}" fill="${a.col}" fill-rule="evenodd"><title>${esc(a.name)}: ${a.pct}%</title></path>`).join("")}
    </svg>
    <div class="pie-legend">
      ${arcs.map(a => `<div class="pie-row"><span class="pie-dot" style="background:${a.col}"></span><span class="pie-name">${esc(a.name)}</span><span class="pie-pct">${a.pct}% &middot; ${inr0(a.v)}</span></div>`).join("")}
    </div>
  </div>`;
}

/* ---------------------------------------------------------- watchlist ---- */
function renderWatchlist() {
  const list = state.startups.filter(s => state.watch.includes(s.id));
  return `
    <div class="section-title">Watchlist</div>
    <div class="section-sub">Star companies on the Market tab to pin them here. Saved in this browser.</div>
    <div class="grid">
      ${list.map(s => cardHtml(s) + (state.openId === s.id ? drawerHtml(s.id) : "")).join("") || '<div class="empty">Nothing watched yet.</div>'}
    </div>`;
}


/* --------------------------------------------------------- leaderboard ---- */
function renderLeaderboard() {
  const lb = state.lb;
  const hasPortfolio = state.portfolio.txns.length > 0;
  let body;
  if (lb.status === "loading") body = '<div class="empty">Loading leaderboard...</div>';
  else if (lb.status === "error") body = `<div class="empty">The leaderboard is temporarily unavailable (${esc(lb.error || "connection failed")}). Your portfolio is safe in this browser.</div>`;
  else if (!lb.rows.length) body = '<div class="empty">No approved traders on the board yet.</div>';
  else body = `<table class="txn-table"><thead><tr><th>#</th><th>Trader</th><th class="num">Portfolio value</th><th class="num">Return</th></tr></thead><tbody>
    ${lb.rows.map((r, i) => `<tr class="${r.mine ? "mine" : ""}"><td>${i + 1}</td><td>${esc(r.name)}${r.mine ? " (you)" : ""}</td><td class="num">${inr0(r.value)}</td><td class="num ${r.ret >= 0 ? "up" : "down"}">${(r.ret >= 0 ? "+" : "") + r.ret.toFixed(2)}%</td></tr>`).join("")}
    </tbody></table>`;
  return `
    <div class="section-title">Leaderboard</div>
    <div class="section-sub">Ranked automatically from the server portfolios of approved accounts: our data worker records each trade when it happens at the current simulated price, only while the simulated market is open - backdated or self-reported trades are not accepted, and trades made while the worker is unreachable do not count. Starting capital is ${inr0(START_CASH)} SimRupees (virtual) for everyone.</div>
    ${body}
    <div class="lb-join">
      ${state.acct.token && state.acct.isAdmin ? `<div class="empty">The creator account is hidden from the board.</div>` :
        state.acct.token ? `<div class="empty">You are on the board as <strong>${esc(state.acct.username)}</strong> - your server portfolio is ranked automatically. Trades count only while the simulated market is open (${esc(SimEngine.MARKET.label)}).</div>` :
        (state.profile && !state.acct.token) ? `<div class="empty">Log in from the Account tab and your server portfolio is ranked automatically.</div>` :
        `<div class="empty">Sign up, get approved and log in to join the board - entries are server portfolios, not self-reported scores.</div>`}
    </div>`;
}

async function loadLeaderboard() {
  state.lb.status = "loading";
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(DATA_WORKER + "/lb?v=" + Date.now(), { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    const myId = state.acct.userId || "";
    state.lb.rows = (d.entries || []).map(e => ({ ...e, mine: myId && e.id === myId }));
    state.lb.status = "ok";
    state.lb.joined = state.lb.rows.some(e => e.mine);
  } catch (e) {
    state.lb.status = "error";
    state.lb.error = e.message || "unreachable";
  }
}

/* ------------------------------------------------------------- signup ---- */
function signupHtml() {
  const err = state.signupError ? `<div class="trade-msg down">${esc(state.signupError)}</div>` : "";
  return `
  <div class="signup-overlay" role="dialog" aria-modal="true" aria-label="Sign up">
    <div class="panel signup-card">
      <div class="section-title" style="margin-top:0">Sign up to start</div>
      <div class="section-sub">One quick signup before you trade.</div>
      <label class="signup-label" for="suUser">Username <span class="signup-hint">- shown on the public leaderboard, 3-20 letters/numbers/underscore</span></label>
      <input type="text" id="suUser" maxlength="20" placeholder="e.g. market_wizard" autocomplete="off">
      <label class="signup-label" for="suPass">Password <span class="signup-hint">- at least 6 characters, for your login</span></label>
      <input type="password" id="suPass" maxlength="72" placeholder="Your password" autocomplete="new-password">
      <label class="signup-label" for="suReal">Real name <span class="signup-hint">- used only for your certificate</span></label>
      <input type="text" id="suReal" maxlength="60" placeholder="Your full name" autocomplete="off">
      <label class="signup-label" for="suEmail">Email id <span class="signup-hint">- stored with your entry</span></label>
      <input type="email" id="suEmail" maxlength="120" placeholder="you@example.com" autocomplete="off">
      ${err}
      <button class="btn" id="suSubmit" style="margin-top:10px">Sign up</button>
      <div style="text-align:center;margin-top:10px"><a href="#" id="suDismiss" style="font-size:13px;color:var(--muted)">Already signed up? Log in from the Account tab</a></div>
      <div class="signup-fineprint">Only your username ever appears publicly. Your real name and email id stay private. Your account is <strong>active immediately</strong> after signup - log in from the Account tab and your ranked SimRupees portfolio starts at 10,00,000. The creator can remove accounts that misuse the platform. We do not verify your email and will not send you any emails.</div>
    </div>
  </div>`;
}

function mountSignup() {
  if (state.profile || state.signupDismissed || state.acct.token || $("#suSubmit")) return;  // logged-in users (incl. admin) never get the gate
  document.body.insertAdjacentHTML("beforeend", signupHtml());
  $("#suSubmit").onclick = submitSignup;
  $("#suDismiss").onclick = (e) => { e.preventDefault(); state.signupDismissed = true; const ov = $(".signup-overlay"); if (ov) ov.remove(); };
  $("#suEmail").addEventListener("keydown", (e) => { if (e.key === "Enter") submitSignup(); });
  setTimeout(() => { const u = $("#suUser"); if (u) u.focus({ preventScroll: true }); }, 50);
}

async function submitSignup() {
  const username = ($("#suUser").value || "").trim();
  const password = $("#suPass").value || "";
  const realName = ($("#suReal").value || "").trim();
  const email = ($("#suEmail").value || "").trim();
  const err = (t) => {
    state.signupError = t;
    const ov = $(".signup-overlay");
    if (ov) ov.remove();
    mountSignup();
  };
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return err("Username must be 3-20 characters: letters, numbers and underscore only.");
  if (password.length < 6) return err("Password must be at least 6 characters.");
  if (realName.length < 2) return err("Enter your real name - it goes on your certificate.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err("Enter a valid email id (e.g. you@example.com).");
  // Register the account on the server (active immediately under auto-approval).
  // If the worker is unreachable the signup still completes locally and the
  // account can be created later from the Account tab.
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(DATA_WORKER + "/api/auth/signup", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, email, real_name: realName }),
      signal: ctl.signal,
    });
    clearTimeout(t);
    const d = await r.json().catch(() => ({}));
    if (r.status === 409) return err("That username is already taken. If it is yours, log in from the Account tab.");
    if (!r.ok) return err(d.detail || "Could not create the account (" + (d.error || r.status) + "). Try again.");
    state.acct.status = "approved";
  } catch {
    // offline: continue locally; account creation can be retried from Account tab
  }
  const profile = { username, real_name: realName, email };
  store.setItem("scale_profile", JSON.stringify(profile));
  state.profile = profile;
  const ov = $(".signup-overlay");
  if (ov) ov.remove();
  if (state.tab === "leaderboard") loadLeaderboard().then(() => refreshBody());
}

/* ------------------------------------------------------------ account ---- */
// Server accounts: signup -> active immediately (auto-approval; the creator can kick) ->
// login. While logged in, the SERVER portfolio is authoritative and trades are
// gated to the simulated market's hours by the worker, against its own clock.
// Without an account, everything stays local in this browser.

function acctHeaders() {
  return { "content-type": "application/json", authorization: "Bearer " + state.acct.token };
}
async function acctApi(path, opts = {}) {
  const r = await fetch(DATA_WORKER + path, {
    method: opts.method || "GET",
    headers: acctHeaders(),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  return [r.status, d];
}
function acctSetMsg(text, cls) { state.acct.msg = text ? { text, cls: cls || "" } : null; }

// Mirror the server portfolio into the local state so every existing view
// (portfolio, drawer, leaderboard sync) keeps working unchanged.
function acctApplyServer(pf, txns) {
  const holdings = {};
  for (const h of pf.holdings || []) holdings[h.id] = { qty: h.qty, avg: h.avgBuyPrice };
  state.portfolio = {
    cash: pf.cash,
    holdings,
    txns: (txns || []).slice().reverse().map(t => {
      const st = state.startups.find(s => s.id === t.startup);
      return { ts: Date.parse(t.timestamp) || Date.now(), side: t.type, id: t.startup, name: st ? st.name : t.startup, qty: t.qty, price: t.price };
    }),
  };
  state.acct.serverTrades = pf.trades || 0;
  saveLocal();
}

async function acctRefreshPortfolio() {
  const [s1, pf] = await acctApi("/api/portfolio");
  if (s1 !== 200) return false;
  const [s2, tx] = await acctApi("/api/transactions");
  acctApplyServer(pf, s2 === 200 ? tx.transactions : []);
  return true;
}

// Restore a saved session on load.
async function acctRestore() {
  if (!state.acct.token) return;
  state.acct.restoring = true;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(DATA_WORKER + "/api/auth/me", { headers: acctHeaders(), signal: ctl.signal });
    clearTimeout(t);
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      state.acct.username = d.username;
      state.acct.isAdmin = !!d.isAdmin;
      state.acct.approvedUntil = d.approvedUntil || null;
      await acctRefreshPortfolio();
    } else if (r.status === 403) {
      state.acct.status = d.status || null;
      acctSetMsg(d.detail || "Your account is not active.", "down");
      state.acct.token = "";
      store.removeItem("scale_acct_token");
    } else {
      state.acct.token = "";
      store.removeItem("scale_acct_token");
    }
  } catch { /* offline: keep token, retry on next visit */ }
  state.acct.restoring = false;
}

async function acctLogin() {
  const u = ($("#acUser").value || "").trim();
  const p = $("#acPass").value || "";
  if (!u || !p) { acctSetMsg("Enter your username and password.", "down"); refreshBody(); return; }
  acctSetMsg("Logging in...", "");
  refreshBody();
  try {
    const r = await fetch(DATA_WORKER + "/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: u, password: p }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      state.acct.token = d.token;
      state.acct.username = d.username;
      state.acct.isAdmin = !!d.isAdmin;
      state.acct.approvedUntil = d.approvedUntil || null;
      state.acct.status = "approved";
      store.setItem("scale_acct_token", d.token);
      acctSetMsg(null);
      await acctRefreshPortfolio();
    } else if (r.status === 403) {
      state.acct.status = d.status || null;
      acctSetMsg(d.detail || "Your account is not active.", "down");
    } else {
      acctSetMsg(d.detail || "Invalid username or password.", "down");
    }
  } catch {
    acctSetMsg("Could not reach the account service. Try again later.", "down");
  }
  refreshBody();
}

async function acctReapply() {
  const u = ($("#acUser") && $("#acUser").value || "").trim();
  const p = ($("#acPass") && $("#acPass").value) || "";
  const reason = ($("#acReason").value || "").trim();
  if (reason.length < 10) { acctSetMsg("Please tell us why you would like access (min 10 characters).", "down"); refreshBody(); return; }
  try {
    const r = await fetch(DATA_WORKER + "/api/auth/reapply", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: u, password: p, reason }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { state.acct.status = d.approved ? "approved" : "pending"; acctSetMsg(d.message || "Done.", "up"); }
    else acctSetMsg(d.detail || "Could not submit (" + (d.error || r.status) + ").", "down");
  } catch { acctSetMsg("Could not reach the account service.", "down"); }
  refreshBody();
}

function acctLogout() {
  state.acct.token = "";
  state.acct.username = "";
  state.acct.isAdmin = false;
  state.acct.approvedUntil = null;
  state.acct.serverTrades = null;
  state.acct.admin = null;
  state.acct.status = null;
  store.removeItem("scale_acct_token");
  acctSetMsg("Logged out. This browser keeps a local copy of your last portfolio.", "");
  refreshBody();
}

async function acctChangePw() {
  const cur = $("#acCurPw").value || "";
  const nw = $("#acNewPw").value || "";
  const [s, d] = await acctApi("/api/auth/change-password", { method: "POST", body: { currentPassword: cur, newPassword: nw } });
  acctSetMsg(s === 200 ? (d.message || "Password updated.") : (d.detail || "Could not update password."), s === 200 ? "up" : "down");
  refreshBody();
}


/* ---- admin console ---- */
async function acctAdminLoad() {
  const [s, d] = await acctApi("/api/admin/applications");
  if (s === 200) state.acct.admin = d;
  else acctSetMsg(d.detail || "Could not load applications.", "down");
  refreshBody();
}
async function acctAdminAct(action, userId, extra) {
  const [s, d] = await acctApi("/api/admin/" + action, { method: "POST", body: { userId, ...(extra || {}) } });
  if (s !== 200) acctSetMsg(d.detail || "Action failed.", "down");
  await acctAdminLoad();
}
async function acctAdminBulk(action) {
  if (!confirm("Run bulk action: " + action + "?")) return;
  const [s, d] = await acctApi("/api/admin/bulk/" + action, { method: "POST", body: {} });
  if (s !== 200) acctSetMsg(d.detail || "Bulk action failed.", "down");
  await acctAdminLoad();
}

function adminRow(r, actions) {
  return `<tr>
    <td>${esc(r.username)}</td>
    <td>${esc(r.realName || "-")}</td>
    <td>${esc(r.email || "-")}</td>
    <td>${r.approvedUntil ? new Date(r.approvedUntil).toLocaleDateString("en-IN") : "-"}</td>
    <td>${r.leaderboardHidden ? "hidden" : "shown"}</td>
    <td class="num">${actions}</td>
  </tr>`;
}
function adminConsoleHtml() {
  const a = state.acct.admin;
  if (!a) return '<div class="empty">Loading applications...</div>';
  const btn = (act, id, label, cls) => `<button class="btn sm ${cls || ""}" data-admin-act="${act}" data-admin-uid="${id}">${label}</button>`;
  const pendRows = a.pending.map(r => adminRow(r, btn("approve", r.userId, "Approve") + " " + btn("reject", r.userId, "Reject", "sell"))).join("");
  const apprRows = a.approved.map(r => adminRow(r, btn("revoke", r.userId, "Revoke", "sell") + " " + btn("leaderboard-visibility", r.userId, r.leaderboardHidden ? "Show on board" : "Hide from board", ""))).join("");
  const rejRows = a.rejected.map(r => adminRow(r, btn("approve", r.userId, "Approve"))).join("");
  const tbl = rows => rows ? `<table class="txn-table"><thead><tr><th>Username</th><th>Real name</th><th>Email</th><th>Approved until</th><th>Board</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">None.</div>';
  return `
    <div class="panel">
      <h3>Creator console - applications</h3>
      <div class="section-sub">Approving restores a removed account; rejecting or revoking removes access immediately. Removed accounts cannot log in, trade, or appear on the leaderboard until approved again. No emails are sent.</div>
      <h3>Pending (${a.counts.pending})</h3>${tbl(pendRows)}
      <h3>Approved (${a.counts.approved})</h3>${tbl(apprRows)}
      <h3>Rejected (${a.counts.rejected})</h3>${tbl(rejRows)}
      <div style="margin-top:10px">
        <button class="btn sm sell" data-admin-bulk="reject-pending">Reject all pending</button>
        <button class="btn sm sell" data-admin-bulk="revoke-approved">Revoke all approved</button>
        <button class="btn sm" data-admin-bulk="leaderboard-hide-all">Hide all from board</button>
        <button class="btn sm" data-admin-bulk="leaderboard-show-all">Show all on board</button>
      </div>
    </div>`;
}

function renderAccount() {
  const a = state.acct;
  const msg = a.msg ? `<div class="trade-msg ${a.msg.cls}" style="margin-top:8px">${esc(a.msg.text)}</div>` : "";
  if (a.restoring) {
    return `<div class="section-title">Account</div><div class="empty">Restoring your session...</div>`;
  }
  if (!a.token) {
    const showReapply = a.status === "rejected" || (a.status === "approved" && a.msg && /expired/i.test(a.msg.text));
    return `
    <div class="section-title">Account</div>
    <div class="section-sub">Log in with the username and password you signed up with. New accounts are active right after signup.</div>
    <div class="panel" style="max-width:420px">
      <label class="signup-label" for="acUser">Username</label>
      <input type="text" id="acUser" maxlength="20" autocomplete="off" value="${esc(state.profile ? state.profile.username : "")}">
      <label class="signup-label" for="acPass">Password</label>
      <input type="password" id="acPass" maxlength="72" autocomplete="current-password">
      <button class="btn" id="acLogin" style="margin-top:10px">Log in</button>
      ${showReapply ? `
        <label class="signup-label" for="acReason" style="margin-top:12px">Re-apply: why would you like access? (min 10 characters)</label>
        <input type="text" id="acReason" maxlength="200">
        <button class="btn" id="acReapply" style="margin-top:8px">Submit new application</button>` : ""}
      ${msg}
    </div>
    <div class="panel" style="max-width:420px">
      <h3>No account yet?</h3>
      <div class="section-sub">Signed-up visitors get a server-kept portfolio that survives browsers and devices, and their trades count while the simulated market is open. Without an account you can still browse and practice-trade locally in this browser.</div>
    </div>`;
  }
  const until = a.isAdmin ? "creator account - never expires" : (a.approvedUntil ? "access until " + new Date(a.approvedUntil).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
  return `
    <div class="section-title">Account</div>
    <div class="section-sub">Logged in as <strong>${esc(a.username)}</strong>${a.isAdmin ? " (creator)" : ""} &middot; ${esc(until)}. Your portfolio is kept on the server and trades here count only while the simulated market is open (${esc(SimEngine.MARKET.label)}).</div>
    <div class="stat-row">
      <div class="stat"><div class="k">Server portfolio value</div><div class="v">${inr0(state.portfolio.cash + holdingValue())}</div></div>
      <div class="stat"><div class="k">Server trades</div><div class="v">${a.serverTrades === null ? "-" : a.serverTrades}</div></div>
    </div>
    <div class="panel" style="max-width:420px">
      <h3>Change password</h3>
      <label class="signup-label" for="acCurPw">Current password</label>
      <input type="password" id="acCurPw" maxlength="72" autocomplete="current-password">
      <label class="signup-label" for="acNewPw">New password (min 6 characters)</label>
      <input type="password" id="acNewPw" maxlength="72" autocomplete="new-password">
      <button class="btn" id="acChangePw" style="margin-top:8px">Update password</button>
    </div>
    <button class="btn sell" id="acLogout">Log out</button>
    ${msg}
    ${a.isAdmin ? adminConsoleHtml() : ""}`;
}

/* -------------------------------------------------------------- learn ---- */
function renderLearn() {
  return `
    <div class="section-title">How this works</div>
    <div class="section-sub">Read this before trading.</div>
    <div class="learn panel">
      <h3>Why "unlisted" startups?</h3>
      <p>Companies like Flipkart or Zepto do not trade on NSE or BSE yet. You cannot buy their shares on a stock exchange, so there is no live market price. That is what makes them interesting to study: their value moves with funding rounds, revenue, regulation and news - not with a ticker.</p>
      <h3>Where do the prices come from?</h3>
      <p>Every price here is <strong>simulated for learning</strong>. There is no real quote to show, and we have no licensed feed of real unlisted-share prices, so we do not pretend to have one. Each company starts the day at its previous simulated close and then moves on a model driven by (a) real news about that company - positive and negative headlines push the price, fading over about half an hour - and (b) a deterministic random component so the chart behaves like a market.</p>
      <p>"Deterministic" is the important word. The price is worked out from the company and the clock, so your screen, your friend's screen and our server all compute the same number at the same instant. That is why an order fills at the price you were looking at, and why nobody can get a better price by refreshing.</p>
      <h3>When is the market open?</h3>
      <p>${esc(SimEngine.MARKET.label)}. The header shows a countdown to the next open or close. Prices move every 5 seconds while it is open and sit still once it shuts. Orders are refused outside those hours - our server checks its own clock, so changing the time on your laptop does not help.</p>
      <h3>What updates automatically?</h3>
      <ul>
        <li><strong>News:</strong> our data worker pulls Indian startup news from public RSS feeds, tags stories to tracked companies and sorts them by sector. Non-startup and non-India stories are filtered out. You get the headline, a short extract and a link - the full article always stays with the publisher.</li>
        <li><strong>Listing status:</strong> the same job checks every tracked company against the NSE listed-company master, the NSE SME master and the BSE daily bhavcopy. An exact exchange match removes it from the tracked list. A news report of a listing never removes a company on its own - it is flagged for human review. IPO <em>plans</em> only add an "IPO Watch" badge.</li>
        <li><strong>Prices:</strong> at the end of each trading day the closing value is written to history. Past days are never rewritten.</li>
      </ul>
      <h3>Limits to know</h3>
      <ul>
        <li>Nothing on this page is a real market price. The companies are unlisted: you cannot actually buy them on an exchange.</li>
        <li>Valuations are last publicly reported figures and may be stale.</li>
        <li>The unlisted check is best-effort, not a guarantee. It matches company and legal-entity names against the NSE master, the NSE SME master and BSE daily trades, so a suspended BSE-only scrip or a listing on a foreign exchange can be missed. A banner appears above the market if the check goes stale or a source is unreachable.</li>
        <li>News coverage is best-effort from free public feeds, not exhaustive, and the sector label is our classification rather than the publisher's.</li>
        <li>Without an account, your portfolio and watchlist are stored only in this browser. With a free account (Account tab), your portfolio is kept on our server across devices and server trades count only while the simulated market is open.</li>
        <li>Nothing here is investment advice. It is a classroom simulator.</li>
      </ul>
    </div>`;
}

/* -------------------------------------------------------------- drawer ---- */
function openDrawer(id) {
  state.openId = id;
  state.tradeMsg = null;
  refreshBody();
  const d = $("#drawer");
  if (d) {
    drawChart(id);
    startChartLoop();
    d.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}
function closeDrawer() {
  state.openId = null;
  state.tradeMsg = null;
  stopChartLoop();
  refreshBody();
}

/* ------------------------------------------------------------- charts ----
 * Both the line and the candlestick view are live. Intraday timeframes build
 * OHLC straight from the engine, so the right-hand candle grows while you
 * watch it; daily timeframes read stored history, which never changes.
 */

const CHART = { up: "#2fbf71", down: "#e5534b", grid: "#262c36", axis: "#8b93a1" };

/* Candles for the chosen timeframe. Intraday comes from the engine; daily is
 * folded out of the stored closes (open = previous close). */
function chartCandles(id, key) {
  const tf = tfOf(key);
  if (tf.bucket) {
    const anchor = prevClose(id);
    if (!anchor) return { bars: [], intraday: true };
    const bars = SimEngine.candles(id, anchor, effectiveNow(), tf.bucket, newsImpulses(id));
    return { bars, intraday: true };
  }
  const s = series(id).slice(-tf.days);
  const bars = s.map((p, i) => {
    const o = i ? s[i - 1].c : p.c;
    return { t: Date.parse(p.d + "T00:00:00Z"), label: p.d, o, h: Math.max(o, p.c), l: Math.min(o, p.c), c: p.c, forming: false };
  });
  return { bars, intraday: false };
}

const hhmm = (ms) => {
  const p = SimEngine.istParts(ms);
  return String(Math.floor(p.minOfDay / 60)).padStart(2, "0") + ":" + String(p.minOfDay % 60).padStart(2, "0");
};

function drawChart(id) {
  const cv = $("#chart");
  if (!cv) return;
  const { bars, intraday } = chartCandles(id, state.timeframe);
  const ctx = cv.getContext("2d");

  // Keep it sharp on retina screens: back the canvas with device pixels and
  // draw in CSS pixels.
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 680, H = cv.clientHeight || 220;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = "11px sans-serif";
  ctx.textBaseline = "alphabetic";

  if (bars.length < 2) {
    ctx.fillStyle = CHART.axis;
    ctx.fillText(intraday ? "Waiting for the market to open." : "Not enough history yet.", 44, H / 2);
    return;
  }

  const padL = 46, padR = 10, padT = 14, padB = 22;
  let min = Infinity, max = -Infinity;
  for (const b of bars) { if (b.l < min) min = b.l; if (b.h > max) max = b.h; }
  const span = (max - min) || (max * 0.01) || 1;
  min -= span * 0.06; max += span * 0.06;
  const vspan = max - min;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const x = (i) => padL + (bars.length === 1 ? plotW / 2 : (i / (bars.length - 1)) * plotW);
  const y = (v) => padT + plotH - ((v - min) / vspan) * plotH;

  // Grid and price axis
  ctx.strokeStyle = CHART.grid; ctx.fillStyle = CHART.axis; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const gy = Math.round(padT + (g / 4) * plotH) + 0.5;
    ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
    ctx.fillText(inr(max - (g / 4) * vspan, 0), 2, gy + 4);
  }

  // The anchor line: where the day (or window) started.
  const anchorVal = bars[0].o;
  if (anchorVal >= min && anchorVal <= max) {
    ctx.save();
    ctx.setLineDash([3, 3]); ctx.strokeStyle = "#4a515c";
    const ay = Math.round(y(anchorVal)) + 0.5;
    ctx.beginPath(); ctx.moveTo(padL, ay); ctx.lineTo(W - padR, ay); ctx.stroke();
    ctx.restore();
  }

  const lastBar = bars[bars.length - 1];
  const rising = lastBar.c >= anchorVal;

  if (state.chartMode === "candle") {
    const cw = Math.max(1.5, Math.min(14, plotW / bars.length * 0.62));
    bars.forEach((b, i) => {
      const upBar = b.c >= b.o;
      const col = upBar ? CHART.up : CHART.down;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      const cx = Math.round(x(i)) + 0.5;
      ctx.beginPath(); ctx.moveTo(cx, y(b.h)); ctx.lineTo(cx, y(b.l)); ctx.stroke();
      const top = y(Math.max(b.o, b.c));
      const hgt = Math.max(1, Math.abs(y(b.o) - y(b.c)));
      if (b.forming) {
        // The candle still being written: hollow, so it reads as provisional.
        ctx.lineWidth = 1.4;
        ctx.strokeRect(cx - cw / 2, top, cw, hgt);
      } else {
        ctx.fillRect(cx - cw / 2, top, cw, hgt);
      }
    });
  } else {
    ctx.strokeStyle = rising ? CHART.up : CHART.down;
    ctx.lineWidth = 2; ctx.lineJoin = "round";
    ctx.beginPath();
    bars.forEach((b, i) => (i ? ctx.lineTo(x(i), y(b.c)) : ctx.moveTo(x(i), y(b.c))));
    ctx.stroke();
    // Soft fill under the line.
    ctx.lineTo(x(bars.length - 1), padT + plotH);
    ctx.lineTo(x(0), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = (rising ? "rgba(47,191,113," : "rgba(229,83,75,") + "0.10)";
    ctx.fill();
  }

  // The live marker, so the eye can find "now" immediately.
  const lx = x(bars.length - 1), ly = y(lastBar.c);
  ctx.fillStyle = rising ? CHART.up : CHART.down;
  ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2); ctx.fill();

  // Time axis
  ctx.fillStyle = CHART.axis;
  const first = intraday ? hhmm(bars[0].t) : bars[0].label;
  const last = intraday ? hhmm(lastBar.t) : lastBar.label;
  ctx.fillText(first, padL, H - 6);
  ctx.fillText(last, W - padR - ctx.measureText(last).width, H - 6);
  if (intraday) {
    const tag = SimEngine.marketStatus(now()).open ? "LIVE" : "CLOSED";
    ctx.fillStyle = SimEngine.marketStatus(now()).open ? CHART.up : CHART.axis;
    const tw = ctx.measureText(tag).width;
    ctx.fillText(tag, (W - tw) / 2, H - 6);
  }
}

/* One animation-frame loop drives the open chart. requestAnimationFrame rather
 * than a timer so the browser throttles it when the tab is hidden. */
let chartRaf = null;
function startChartLoop() {
  if (chartRaf) return;
  const frame = () => {
    chartRaf = null;
    if (state.openId && $("#chart")) {
      drawChart(state.openId);
      chartRaf = requestAnimationFrame(frame);
    }
  };
  chartRaf = requestAnimationFrame(frame);
}
function stopChartLoop() {
  if (chartRaf) cancelAnimationFrame(chartRaf);
  chartRaf = null;
}

/* -------------------------------------------------------------- trade ---- */
async function trade(id, side) {
  if (state.tradingHalted) {
    state.tradeMsg = { id, text: "Trading is paused: live listing data is unavailable or stale, so we cannot confirm every company is still unlisted. Read-only browsing continues.", cls: "down" };
    refreshBody(); drawChart(id); return;
  }
  const qtyInput = $("#qty");
  const qty = Math.max(0, Math.floor(Number(qtyInput && qtyInput.value) || 0));
  const setMsg = (text, cls) => { state.tradeMsg = { id, text, cls }; };
  if (!qty) { setMsg("Enter a quantity of 1 or more.", "down"); refreshBody(); drawChart(id); return; }

  // Closed means closed, for practice trades too. The worker checks its own
  // clock as well, so this is a courtesy message rather than the real gate.
  const st = SimEngine.marketStatus(now());
  if (!st.open) {
    const opens = st.nextChangeMs ? SimEngine.countdown(st.nextChangeMs - now()) : "soon";
    setMsg(`The market is closed. It opens in ${opens} (${SimEngine.MARKET.label}).`, "down");
    refreshBody(); drawChart(id); return;
  }

  let price = px(id);
  // Logged-in accounts trade on the server (authoritative): the worker prices
  // the order with the same engine at the server's own clock and enforces the
  // hours itself, so a failed server trade must NOT be applied locally. We fill
  // at whatever price the server reports back, not the one we just computed.
  if (state.acct.token) {
    setMsg("Sending order to the server...", "");
    refreshBody(); drawChart(id);
    try {
      const r = await fetch(DATA_WORKER + "/api/trade", {
        method: "POST", headers: acctHeaders(),
        body: JSON.stringify({ id, side, qty }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) {
        setMsg(d.detail || ("Order rejected (" + (d.error || r.status) + ")."), "down");
        refreshBody(); drawChart(id); return;
      }
      if (isFinite(Number(d.price)) && Number(d.price) > 0) price = Number(d.price);
    } catch {
      setMsg("Could not reach the trading server. No order was placed.", "down");
      refreshBody(); drawChart(id); return;
    }
    state.acct.serverTrades = (state.acct.serverTrades || 0) + 1;
  }
  const p = state.portfolio;
  const s = state.startups.find(x => x.id === id);
  if (side === "BUY") {
    const cost = qty * price;
    if (cost > p.cash) { setMsg("Not enough cash for that order.", "down"); refreshBody(); drawChart(id); return; }
    const h = p.holdings[id] || { qty: 0, avg: 0 };
    h.avg = (h.avg * h.qty + cost) / (h.qty + qty);
    h.qty += qty;
    p.holdings[id] = h;
    p.cash -= cost;
  } else {
    const h = p.holdings[id];
    if (!h || h.qty < qty) { setMsg("You do not hold that many shares.", "down"); refreshBody(); drawChart(id); return; }
    h.qty -= qty;
    p.cash += qty * price;
    if (!h.qty) delete p.holdings[id];
  }
  p.txns.push({ ts: now(), side, id, name: s.name, qty, price });
  saveLocal();
  setMsg(`${side === "BUY" ? "Bought" : "Sold"} ${qty} x ${s.name} at ${inr(price)} (executed price, simulated).`, "up");
  refreshBody();
  drawChart(id);
}

/* --------------------------------------------------------- live ticks ----
 * Prices are repainted in place every 5 seconds. A full re-render would throw
 * away input focus, the open drawer and any half-typed quantity, so the tick
 * only touches the elements that carry a price.
 */

const lastShown = new Map();   // id -> last price painted, for the flash direction

function tickPrices() {
  const open = SimEngine.marketStatus(now()).open;

  $$("[data-px]").forEach(el => {
    const id = el.dataset.px;
    const v = px(id);
    if (!v) return;
    const before = lastShown.get(id);
    const text = inr(v);
    if (el.textContent !== text) el.textContent = text;
    if (open && before !== undefined && v !== before) {
      // Flash green or red for one tick. Re-adding the class needs the old one
      // gone first or the animation will not restart.
      el.classList.remove("flash-up", "flash-down");
      void el.offsetWidth;
      el.classList.add(v > before ? "flash-up" : "flash-down");
    }
    lastShown.set(id, v);
  });

  $$("[data-chg]").forEach(el => {
    const id = el.dataset.chg;
    const ch = dayChange(id);
    const suffix = el.textContent.indexOf("today") >= 0 ? " today" : "";
    el.textContent = chgTxt(ch) + suffix;
    el.className = el.className.replace(/\b(up|down)\b/g, "").trim() + " " + chgCls(ch);
  });

  $$("[data-spark]").forEach(refreshSpark);
  renderIndexPill();
}

/* The header clock. Ticks every second; the countdown is driven by the server
 * clock offset so a wrong device time cannot show the wrong answer. */
function tickClock() {
  const txt = $("#clockText"), dot = $("#liveDot"), box = $("#marketClock");
  if (!txt || !dot || !box) return;
  const n = now();
  const st = SimEngine.marketStatus(n);
  const left = st.nextChangeMs ? SimEngine.countdown(st.nextChangeMs - n) : "--:--:--";
  txt.textContent = (st.open ? "Market open, closes in " : "Market closed, opens in ") + left;
  dot.classList.toggle("on", st.open);
  box.classList.toggle("closed", !st.open);
  box.title = "Simulated trading hours: " + SimEngine.MARKET.label;
}

let tickTimer = null, clockTimer = null;
function startLiveLoops() {
  if (!tickTimer) tickTimer = setInterval(tickPrices, SimEngine.STEP_MS);
  if (!clockTimer) clockTimer = setInterval(tickClock, 1000);
  tickClock();
}

/* -------------------------------------------------------------- index ---- */
function renderIndexPill() {
  const changes = state.startups.map(s => dayChange(s.id)).filter(v => isFinite(v));
  if (!changes.length) return;
  const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
  $("#indexValue").textContent = (100 * (1 + avg / 100)).toFixed(2);
  const el = $("#indexChange");
  el.textContent = chgTxt(avg);
  el.className = "pill-change " + chgCls(avg);
}

/* -------------------------------------------------------------- render ---- */
const views = { market: renderMarket, news: renderNews, portfolio: renderPortfolio, watchlist: renderWatchlist, leaderboard: renderLeaderboard, account: renderAccount, learn: renderLearn };

function render() {
  $("#main").innerHTML = views[state.tab]();
  mountSignup();
  $$("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === state.tab));
  $("#newsCount").textContent = state.news.length || "";
  bind();
  if (state.openId) { drawChart(state.openId); startChartLoop(); } else stopChartLoop();
}

function bind() {
  const search = $("#search");
  if (search) search.oninput = (e) => { state.search = e.target.value.toLowerCase(); refreshBody(); };
  const sort = $("#sort");
  if (sort) { sort.value = state.sort; sort.onchange = (e) => { state.sort = e.target.value; refreshBody(); }; }
  $$("[data-sector]").forEach(b => b.onclick = () => {
    state.sector = b.dataset.sector; state.openId = null; refreshBody();
  });
  $$("[data-open]").forEach(el => el.onclick = (e) => {
    if (e.target.closest("[data-watch]") || e.target.closest("[data-sell]") || e.target.closest("[data-buy]")) return;
    e.preventDefault();
    const id = el.dataset.open;
    if (state.tab !== "market" && state.tab !== "watchlist") {
      state.tab = "market";
    }
    state.openId === id ? closeDrawer() : openDrawer(id);
  });
  $$("[data-watch]").forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const id = b.dataset.watch;
    state.watch = state.watch.includes(id) ? state.watch.filter(w => w !== id) : [...state.watch, id];
    saveLocal(); refreshBody();
  });
  $$("[data-buy]").forEach(b => b.onclick = () => trade(b.dataset.buy, "BUY"));
  $$("[data-sell]").forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    const id = b.dataset.sell;
    if (state.portfolio.holdings[id] && (state.tab === "market" || state.tab === "watchlist") && state.openId === id) {
      trade(id, "SELL");
    } else if (state.portfolio.holdings[id]) {
      state.tab = "market";
      openDrawer(id);
    }
  });
  $$("[data-close]").forEach(b => b.onclick = () => closeDrawer());
  $$("[data-newssector]").forEach(b => b.onclick = () => { state.newsFilter.sector = b.dataset.newssector; refreshBody(); });
  const nsrc = $("#newsSrc");
  if (nsrc) nsrc.onchange = (e) => { state.newsFilter.src = e.target.value; refreshBody(); };
  const ns = $("#newsSearch");
  if (ns) ns.oninput = (e) => {
    state.newsFilter.q = e.target.value;
    clearTimeout(state._nsT);
    state._nsT = setTimeout(() => { refreshBody(); const el = $("#newsSearch"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 300);
  };
  $$("[data-chartmode]").forEach(b => b.onclick = () => {
    state.chartMode = b.dataset.chartmode; refreshBody();
    if (state.openId) { drawChart(state.openId); startChartLoop(); }
  });
  $$("[data-tf]").forEach(b => b.onclick = () => {
    state.timeframe = b.dataset.tf; refreshBody();
    if (state.openId) { drawChart(state.openId); startChartLoop(); }
  });
  const acLogin = $("#acLogin");
  if (acLogin) acLogin.onclick = () => acctLogin();
  const acPass = $("#acPass");
  if (acPass) acPass.addEventListener("keydown", (e) => { if (e.key === "Enter") acctLogin(); });
  const acReapply = $("#acReapply");
  if (acReapply) acReapply.onclick = () => acctReapply();
  const acLogout = $("#acLogout");
  if (acLogout) acLogout.onclick = () => acctLogout();
  const acChangePw = $("#acChangePw");
  if (acChangePw) acChangePw.onclick = () => acctChangePw();
  $$("[data-admin-act]").forEach(b => b.onclick = () => {
    const act = b.dataset.adminAct, uid = b.dataset.adminUid;
    if (act === "leaderboard-visibility") {
      const hide = /hide from board/i.test(b.textContent);
      acctAdminAct(act, uid, { hidden: hide });
    } else acctAdminAct(act, uid);
  });
  $$("[data-admin-bulk]").forEach(b => b.onclick = () => acctAdminBulk(b.dataset.adminBulk));
  const reset = $("#resetPortfolio");
  if (reset) reset.onclick = () => {
    if (confirm("Reset your virtual portfolio to Sim₹10,00,000 SimRupees?")) {
      state.portfolio = { cash: START_CASH, holdings: {}, txns: [] };
      saveLocal(); refreshBody();
    }
  };
}
function refreshBody() { $("#main").innerHTML = views[state.tab](); bind(); }

function wireChrome() {
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.tab = b.dataset.tab;
    if (state.tab !== "market" && state.tab !== "watchlist") state.openId = null;
    if (state.tab === "leaderboard" && state.lb.status === "idle") loadLeaderboard().then(() => refreshBody());
    if (state.tab === "account" && state.acct.token && state.acct.isAdmin && !state.acct.admin) acctAdminLoad();
    render();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
}

/* ---------------------------------------------------------------- load ---- */
function applyData(su, pr, ne, gr, me) {
  state.startups = su.startups || [];
  state.prices = pr.series || {};
  state.news = ne.items || [];
  state.graduated = gr.graduated || [];
  state.meta = me || {};
  const updated = me.updated ? new Date(me.updated).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST" : "unknown";
  const src = state.companySource ? ` - company list: ${state.companySource}` : "";
  $("#footerMeta").textContent = (state.dataSource === "live"
    ? `Live data from the SCALE data worker, refreshed ${updated}`
    : `Cached snapshot ${updated} - live updates temporarily unavailable`) + src;
  const notice = document.querySelector(".notice-text");
  if (notice && state.dataSource !== "live") {
    notice.innerHTML = `Showing <strong>cached data from ${updated}</strong> - the live update service is temporarily unreachable, so recently listed or removed companies may still appear. Prices are simulated for learning. Nothing here is investment advice.`;
  }
  renderIndexPill();
  render();
  startLiveLoops();
  if (state.acct.token && !state.acct.username) {
    acctRestore().then(() => { if (state.tab === "account") render(); });
  }
}

// Live data source: the Cloudflare data worker (scale-startup-data.y84ikt.workers.dev)
// refreshes data/*.json on a 4x/day schedule and serves them from KV. We try it
// first with a short timeout and fall back to the static files bundled with the
// site, so the page still works if the worker is unreachable.
const DATA_WORKER = "https://scale-startup-data.y84ikt.workers.dev";

/* Trust the server's clock, not the device's. Every worker response carries a
 * Date header, so the first successful data fetch gives us the offset for free
 * - no extra request, which matters at 500+ users. /api/time is used only as a
 * fallback if no Date header came through. */
function noteServerDate(res) {
  const h = res && res.headers && res.headers.get("date");
  if (!h) return;
  const t = Date.parse(h);
  if (!isFinite(t)) return;
  const off = t - Date.now();
  // Header resolution is one second, so ignore anything inside a couple of
  // seconds rather than jittering the countdown for no reason.
  state.timeOffsetMs = Math.abs(off) > 2000 ? off : 0;
}

async function load() {
  let liveHits = 0;
  const grab = async (name, fb) => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3000);
      const r = await fetch(DATA_WORKER + "/data/" + name + "?v=" + Date.now(), { signal: ctl.signal });
      clearTimeout(t);
      if (r.ok) { liveHits++; noteServerDate(r); return await r.json(); }
    } catch {}
    try { const r = await fetch("/invest/data/" + name + "?v=" + Date.now()); return await r.json(); }
    catch { return fb; }
  };
  // Fetch only from the bundled files, no worker. Used to compare the two.
  const local = async (name, fb) => {
    try { const r = await fetch("/invest/data/" + name + "?v=" + Date.now()); return await r.json(); }
    catch { return fb; }
  };

  const [su, pr, ne, gr, me] = await Promise.all([
    grab("startups.json", { startups: [] }),
    grab("prices.json", { series: {} }),
    grab("news.json", { items: [] }),
    grab("graduated.json", { graduated: [] }),
    grab("meta.json", {}),
  ]);

  /* The company list is whichever source knows about more companies.
   *
   * The worker rebuilds startups.json from its KV copy on every run and falls
   * back to a small list baked into its source when that copy is missing or
   * will not parse - then writes the small list back. So a worker that has
   * lost its data silently serves a fraction of the companies, and the bundled
   * file shipped with the site is the fuller one. Taking the larger list means
   * the site is right either way round, and it self-corrects the moment the
   * worker's own copy is restored.
   *
   * Prices are merged rather than replaced: the worker's series are the ones
   * still being extended each day, so they win for the companies it knows, and
   * the bundled history fills in the rest. */
  const localSu = await local("startups.json", { startups: [] });
  const liveCount = (su.startups || []).length;
  const localCount = (localSu.startups || []).length;
  let startupsDoc = su;
  if (localCount > liveCount) {
    startupsDoc = localSu;
    state.companySource = `bundled (${localCount} companies; the worker offered ${liveCount})`;
    const localPr = await local("prices.json", { series: {} });
    pr.series = Object.assign({}, localPr.series || {}, pr.series || {});
  } else {
    state.companySource = `worker (${liveCount} companies)`;
  }

  state.dataSource = liveHits >= 3 ? "live" : "cached";
  const ageMs = me && me.updated ? Date.now() - Date.parse(me.updated) : Infinity;
  state.tradingHalted = state.dataSource !== "live" || ageMs > 26 * 3600 * 1000;
  applyData(startupsDoc, pr, ne, gr, me);
}

if (typeof window !== "undefined") {
  window.startScale = startScale;
  if (!window.__SCALE_NO_AUTOBOOT__) {
    startScale(document.getElementById("app"));
  }
}
