/* SCALE India Investment - Unlisted Startup Exchange
   Static front-end. All data comes from data/*.json, refreshed by the Cloudflare data worker (see data/meta.json).
   Paper trading state lives in this browser only (localStorage when available). */

const SHELL_HTML = `
<header class="topbar">
  <div class="brand">
    <img class="logo-img" src="/invest/assets/logo.png" alt="SCALE logo" width="36" height="36">
    <div>
      <div class="brand-name">SCALE India Investment</div>
      <div class="brand-sub">Unlisted Startup Exchange &middot; learning simulator</div>
    </div>
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
  <span class="notice-text">All prices and balances are <strong>SimRupees (Sim₹)</strong>, a virtual currency for learning - unlisted startups have no live market price and no real money is involved.
  News and listing status refresh automatically four times a day from our data worker (scale-startup-data.y84ikt.workers.dev). Nothing here is investment advice.</span>
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
  newsFilter: { src: "All", q: "" },
  chartMode: "line",
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
function lastClose(id) { const s = series(id); return s.length ? s[s.length - 1].c : 0; }
function dayChange(id) {
  const s = series(id);
  if (s.length < 2) return 0;
  return (s[s.length - 1].c / s[s.length - 2].c - 1) * 100;
}
const chgCls = (v) => (v >= 0 ? "up" : "down");
const chgTxt = (v) => (v >= 0 ? "+" : "") + v.toFixed(2) + "%";

function sparkline(id, w = 260, h = 44) {
  const s = series(id).slice(-60);
  if (s.length < 2) return "";
  const min = Math.min(...s.map(p => p.c)), max = Math.max(...s.map(p => p.c));
  const span = max - min || 1;
  const pts = s.map((p, i) =>
    `${(i / (s.length - 1) * w).toFixed(1)},${(h - 3 - (p.c - min) / span * (h - 6)).toFixed(1)}`
  ).join(" ");
  const up = s[s.length - 1].c >= s[0].c;
  const col = up ? "#2fbf71" : "#e5534b";
  return `<svg class="spark" width="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.8"/></svg>`;
}

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
    price: (a, b) => lastClose(b.id) - lastClose(a.id),
  };
  return list.sort(by[state.sort] || by.name);
}

function cardHtml(s) {
  const c = lastClose(s.id), ch = dayChange(s.id);
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
      <span class="price">${inr(c)}</span>
      <span class="change ${chgCls(ch)}">${chgTxt(ch)}</span>
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
  const c = lastClose(id), ch = dayChange(id);
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
      <span class="price" style="font-size:26px">${inr(c)}</span>
      <span class="change ${chgCls(ch)}">${chgTxt(ch)} today</span>
      <span style="color:var(--muted);font-size:12px">simulated</span>
    </div>
    <div class="chart-toggle">
      <button class="chip ${state.chartMode !== "candle" ? "on" : ""}" data-chartmode="line">Line</button>
      <button class="chip ${state.chartMode === "candle" ? "on" : ""}" data-chartmode="candle">Candlestick</button>
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
  // Sources responded, but coverage is partial: BSE is daily-traded names only
  // (suspended BSE-only scrips can be missed), the NSE SME master file was
  // nearly empty, and foreign listings are covered by news review only.
  return `<div class="verify-chip warn">Listing check ${checked}: name + legal-entity match against the NSE master, NSE SME master and BSE daily trades found no listings. Coverage is partial - suspended BSE-only scrips and foreign listings can be missed; see AUDIT.md. Unlisted status is best-effort, not guaranteed.</div>`;
}

function renderMarket() {
  const list = filteredStartups();
  const cards = list.map(s => cardHtml(s) + (state.openId === s.id ? drawerHtml(s.id) : ""));
  return `
    <div class="section-title">Market <span style="color:var(--muted);font-size:13px;font-weight:400">${state.startups.length} unlisted startups tracked</span></div>
    <div class="section-sub">Simulated prices update daily. Click any company for its chart, story and trading desk.</div>
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

/* --------------------------------------------------------------- news ---- */
function renderNews() {
  const f = state.newsFilter;
  const sources = ["All", ...new Set(state.news.map(i => i.source).filter(Boolean))];
  const q = (f.q || "").toLowerCase();
  const items = state.news.filter(i =>
    (f.src === "All" || i.source === f.src) &&
    (!q || (i.title || "").toLowerCase().includes(q) || (i.summary || "").toLowerCase().includes(q)));
  return `
    <div class="section-title">Startup News</div>
    <div class="section-sub">Pulled by the updater from ${(state.meta.feeds || []).join(", ") || "public feeds"}. Best-effort coverage, not exhaustive. Links open the original publisher.</div>
    <div class="news-filters">
      ${sources.map(src => `<button class="chip ${f.src === src ? "on" : ""}" data-newssrc="${esc(src)}">${esc(src)}</button>`).join("")}
      <input type="search" id="newsSearch" placeholder="Filter by keyword..." value="${esc(f.q || "")}" aria-label="Filter news by keyword">
    </div>
    ${items.map(i => `
      <div class="news-item">
        <h3><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>
        <div class="news-meta">
          <span>${esc(i.source)}</span><span>&middot;</span><span>${ago(i.date)}</span>
          ${(i.startups || []).map(id => {
            const st = state.startups.find(s => s.id === id);
            return st ? `<span class="tag">${esc(st.name)}</span>` : "";
          }).join("")}
        </div>
        ${i.summary ? `<div class="news-summary">${esc(i.summary)}...</div>` : ""}
      </div>`).join("") || '<div class="empty">No news yet. The updater runs 4 times a day.</div>'}`;
}

/* ---------------------------------------------------------- portfolio ---- */
function holdingValue() {
  return Object.entries(state.portfolio.holdings).reduce((v, [id, h]) => v + h.qty * lastClose(id), 0);
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
        const last = lastClose(id), val = h.qty * last, pl = val - h.qty * h.avg;
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
    return st ? { name: st.name, v: h.qty * lastClose(id) } : null;
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
    <div class="section-sub">Ranked automatically from the server portfolios of approved accounts: our data worker records each trade when it happens at the current simulated price, only during NSE market hours - backdated or self-reported trades are not accepted, and trades made while the worker is unreachable do not count. Starting capital is ${inr0(START_CASH)} SimRupees (virtual) for everyone.</div>
    ${body}
    <div class="lb-join">
      ${state.acct.token && state.acct.isAdmin ? `<div class="empty">The creator account is hidden from the board.</div>` :
        state.acct.token ? `<div class="empty">You are on the board as <strong>${esc(state.acct.username)}</strong> - your server portfolio is ranked automatically. Trades count only during NSE market hours (Mon-Fri, 9:15-15:30 IST).</div>` :
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
// gated to NSE market hours by the worker (the original behavior, restored).
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
      <div class="section-sub">Signed-up visitors get a server-kept portfolio that survives browsers and devices, and their trades count during NSE market hours. Without an account you can still browse and practice-trade locally in this browser.</div>
    </div>`;
  }
  const until = a.isAdmin ? "creator account - never expires" : (a.approvedUntil ? "access until " + new Date(a.approvedUntil).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
  return `
    <div class="section-title">Account</div>
    <div class="section-sub">Logged in as <strong>${esc(a.username)}</strong>${a.isAdmin ? " (creator)" : ""} &middot; ${esc(until)}. Your portfolio is kept on the server and trades here count only during NSE market hours (Mon-Fri, 9:15-15:30 IST).</div>
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
      <p>The prices here are <strong>simulated for learning</strong>. A small model starts each company near a level derived from its last reported valuation and moves it daily using (a) real news about that company - positive and negative headlines push the price - and (b) a deterministic random component so charts look and behave like real markets. The same date always produces the same price; history is never rewritten.</p>
      <h3>What updates automatically once live?</h3>
      <ul>
        <li><strong>News:</strong> our data worker runs automatically 4 times a day, pulling Indian startup news from public RSS feeds (Inc42, YourStory, ET Tech, TechCrunch India, Mint, Moneycontrol) and tagging stories to tracked companies. Non-startup and non-India stories are filtered out.</li>
        <li><strong>Listing status:</strong> the same job checks every tracked company against the NSE listed-company master and the BSE daily bhavcopy. An exact exchange match removes it from the tracked list. A news report of a listing never removes a company on its own - it is flagged for human review. IPO <em>plans</em> only add an "IPO Watch" badge.</li>
        <li><strong>Prices:</strong> one new simulated close is added each trading day.</li>
      </ul>
      <h3>Limits to know</h3>
      <ul>
        <li>Valuations are last publicly reported figures and may be stale.</li>
        <li>News coverage is best-effort from free feeds, not exhaustive.</li>
        <li>Without an account, your portfolio and watchlist are stored only in this browser. With a free approved account (Account tab), your portfolio is kept on our server across devices and server trades count only during NSE market hours.</li>
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
    d.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}
function closeDrawer() {
  state.openId = null;
  state.tradeMsg = null;
  refreshBody();
}

function drawChart(id) {
  const cv = $("#chart");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const s = series(id);
  if (s.length < 2) return;
  const W = cv.width, H = cv.height, pad = 40;
  const min = Math.min(...s.map(p => p.c)), max = Math.max(...s.map(p => p.c));
  const span = max - min || 1;
  const x = (i) => pad + (i / (s.length - 1)) * (W - pad - 8);
  const y = (v) => H - 20 - ((v - min) / span) * (H - 40);
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = "#262c36"; ctx.fillStyle = "#8b93a1";
  ctx.font = "11px sans-serif"; ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const gy = 20 + (g / 4) * (H - 40);
    ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(W - 8, gy); ctx.stroke();
    ctx.fillText(inr(max - (g / 4) * span, 0), 2, gy + 4);
  }
  if (state.chartMode === "candle") {
    // Simulated candles derived from the same simulated daily closes:
    // open = previous close, high/low = +/-1% band around the open-close range.
    const n = s.length, cw = Math.max(2, (W - pad - 8) / n * 0.6);
    s.forEach((p, i) => {
      const o = i ? s[i - 1].c : p.c * 0.995;
      const hi = Math.max(o, p.c) * 1.005, lo = Math.min(o, p.c) * 0.995;
      const upDay = p.c >= o;
      ctx.strokeStyle = upDay ? "#2fbf71" : "#e5534b";
      ctx.fillStyle = upDay ? "#2fbf71" : "#e5534b";
      ctx.lineWidth = 1;
      const cx = x(i);
      ctx.beginPath(); ctx.moveTo(cx, y(hi)); ctx.lineTo(cx, y(lo)); ctx.stroke();
      ctx.fillRect(cx - cw / 2, y(Math.max(o, p.c)), cw, Math.max(1, Math.abs(y(o) - y(p.c))));
    });
  } else {
    const up = s[s.length - 1].c >= s[0].c;
    ctx.strokeStyle = up ? "#2fbf71" : "#e5534b"; ctx.lineWidth = 2;
    ctx.beginPath();
    s.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p.c)) : ctx.moveTo(x(i), y(p.c))));
    ctx.stroke();
  }
  ctx.fillText(s[0].d, pad, H - 6);
  const lastLbl = s[s.length - 1].d;
  ctx.fillText(lastLbl, W - 8 - ctx.measureText(lastLbl).width, H - 6);
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
  const price = lastClose(id);
  // Logged-in accounts trade on the server (authoritative): the worker prices
  // the order at the current server quote and enforces NSE market hours, so a
  // failed server trade must NOT be applied locally.
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
  p.txns.push({ ts: Date.now(), side, id, name: s.name, qty, price });
  saveLocal();
  setMsg(`${side === "BUY" ? "Bought" : "Sold"} ${qty} x ${s.name} at ${inr(price)}.`, "up");
  refreshBody();
  drawChart(id);
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
  if (state.openId) drawChart(state.openId);
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
  $$("[data-newssrc]").forEach(b => b.onclick = () => { state.newsFilter.src = b.dataset.newssrc; refreshBody(); });
  const ns = $("#newsSearch");
  if (ns) ns.oninput = (e) => {
    state.newsFilter.q = e.target.value;
    clearTimeout(state._nsT);
    state._nsT = setTimeout(() => { refreshBody(); const el = $("#newsSearch"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }, 300);
  };
  $$("[data-chartmode]").forEach(b => b.onclick = () => { state.chartMode = b.dataset.chartmode; refreshBody(); if (state.openId) drawChart(state.openId); });
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
  $("#footerMeta").textContent = (state.dataSource === "live" ? `Live data from the SCALE data worker, refreshed ${updated}` : `Cached snapshot ${updated} - live updates temporarily unavailable`);
  const notice = document.querySelector(".notice-text");
  if (notice && state.dataSource !== "live") {
    notice.innerHTML = `Showing <strong>cached data from ${updated}</strong> - the live update service is temporarily unreachable, so recently listed or removed companies may still appear. Prices are simulated for learning. Nothing here is investment advice.`;
  }
  renderIndexPill();
  render();
  if (state.acct.token && !state.acct.username) {
    acctRestore().then(() => { if (state.tab === "account") render(); });
  }
}

// Live data source: the Cloudflare data worker (scale-startup-data.y84ikt.workers.dev)
// refreshes data/*.json on a 4x/day schedule and serves them from KV. We try it
// first with a short timeout and fall back to the static files bundled with the
// site, so the page still works if the worker is unreachable.
const DATA_WORKER = "https://scale-startup-data.y84ikt.workers.dev";

async function load() {
  let liveHits = 0;
  const grab = async (name, fb) => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3000);
      const r = await fetch(DATA_WORKER + "/data/" + name + "?v=" + Date.now(), { signal: ctl.signal });
      clearTimeout(t);
      if (r.ok) { liveHits++; return await r.json(); }
    } catch {}
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
  state.dataSource = liveHits >= 3 ? "live" : "cached";
  const ageMs = me && me.updated ? Date.now() - Date.parse(me.updated) : Infinity;
  state.tradingHalted = state.dataSource !== "live" || ageMs > 26 * 3600 * 1000;
  applyData(su, pr, ne, gr, me);
}

if (typeof window !== "undefined") {
  window.startScale = startScale;
  if (!window.__SCALE_NO_AUTOBOOT__) {
    startScale(document.getElementById("app"));
  }
}
