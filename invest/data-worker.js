// SCALE data updater worker - Cloudflare Worker + Cron Trigger (free tier).
// Regenerates data/*.json on schedule into KV; the static site reads worker-first.
// Port of scripts/update_data.py. Same rules: exact suffix-stripped brand+legal
// matching against NSE master + NSE SME + BSE bhavcopy; news never removes;
// fail-closed when the NSE master is unreachable.

const HISTORY_DAYS = 180;
const MAX_NEWS = 60;

const FEEDS = [
  ["Inc42", "https://inc42.com/feed/"],
  ["YourStory", "https://yourstory.com/feed"],
  ["ET Tech", "https://economictimes.indiatimes.com/tech/rssfeeds/13357270.cms"],
  ["TechCrunch India", "https://techcrunch.com/tag/india/feed/"],
  ["Mint Companies", "https://www.livemint.com/rss/companies"],
  ["Moneycontrol", "https://www.moneycontrol.com/rss/business.xml"],
];
const NSE_EQUITY_CSV = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";
const NSE_SME_CSV = "https://nsearchives.nseindia.com/content/equities/SME_EQUITY_L.csv";
const BSE_BHAVCOPY = d =>
  "https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_" + d + "_F_0000.CSV";

const RE_STRONG = /startups?\b|funding|seed\b|series\s+[a-g]\b|venture|unicorn|valu(ed|ation)|nabs|bags|secures|lands|closes|nets\b|drhp|pre-?ipo|\bipo\b/i;
const RE_WEAK = /raise[sd]?\b|founder|co-?founder|fintech|edtech|healthtech|saas|quick[ -]?commerce|\bd2c\b|agritech|spacetech|\bgaming\b/i;
const RE_BIGCO = /airtel|\bjio\b|reliance industries|vodafone|\bbsnl\b|tata consultancy|\btcs\b|infosys|wipro|hcl ?tech|hdfc bank|icici bank|state bank of india|\bsbi\b|adani|tata motors|tata steel|tata power|sensex|\bnifty\b|nvidia|openai|\bmeta\b|microsoft|\bamazon\b|netflix|\bapple\b|\bgoogle\b|\badobe\b/i;
const RE_INDIA = /\bindia(n)?\b|\u20B9|\bcrore\b|\blakh\b|bengaluru|bangalore|mumbai|delhi|gurugram|gurgaon|hyderabad|chennai|\bpune\b|noida|kolkata|ahmedabad|jaipur|kochi|chandigarh|indore|coimbatore|bhubaneswar|lucknow|nagpur|surat|\bsebi\b|\bnse\b|\bbse\b|odisha|karnataka|maharashtra|tamil ?nadu|kerala|gujarat|telangana|andhra|assam|\bpunjab\b|haryana|uttar pradesh|west bengal|rajasthan|madhya pradesh|\bbihar\b|\bgoa\b|manipur|tripura|mizoram|nagaland|meghalaya|northeast/i;
const escRe = n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Startup-news relevance: a mention of a tracked startup always qualifies; otherwise
// require startup-ecosystem signals and reject large listed-company / index stories.
function isStartupRelevant(title, summary, startups) {
  const text = (title || "") + " " + (summary || "");
  for (const s of startups || []) {
    for (const n of [s.name, ...(s.aliases || [])]) {
      if (new RegExp("\\b" + escRe(n) + "\\b", "i").test(text)) return true;
    }
  }
  // Positive India grounding is required: startup/IPO keywords alone do not
  // establish that a story is about the Indian startup ecosystem.
  if (!RE_INDIA.test(text)) return false;
  if (RE_BIGCO.test(text) && !RE_STRONG.test(text)) return false;
  return RE_STRONG.test(text) || RE_WEAK.test(text);
}
export { isStartupRelevant };
const RE_LISTING_DONE = /(shares?\s+(list|listed|lists)\b|makes?\s+(its\s+)?(stock market\s+)?debut|listed\s+at\s+rs|listing\s+gain|stock market debut|trading debut|debuts\s+on\s+(the\s+)?(bse|nse|bourses))/i;
const RE_IPO_WATCH = /\b(ipo|drhp|rhp|public issue|listing plans|files? for)\b/i;
const RE_POSITIVE = /raises|funding|valuation|profit|profitable|growth|expands|launch|partnership|acquires|record|surge|wins|unicorn|hires/i;
const RE_NEGATIVE = /loss|layoff|shuts|shutdown|probe|fraud|fine|penalty|delays|defers|on hold|shelve|crash|falls|drops|cut|exits|resigns|ban/i;

const CORP_SUFFIXES = new Set(("limited ltd private pvt technologies technology tech solutions services india ventures holdings holding corporation corp inc software labs global group enterprises international company co").split(" "));
const norm = s => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, "");
const HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "\u2019", lsquo: "\u2018", ldquo: "\u201C", rdquo: "\u201D", mdash: "\u2014", ndash: "\u2013", hellip: "\u2026" };
function decodeEntities(t) {
  if (!t) return t;
  return t
    .replace(/&#(\d+);/g, (_, n) => { const c = +n; return c >= 0 && c <= 0x10FFFF ? String.fromCodePoint(c) : _; })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { const c = parseInt(h, 16); return c >= 0 && c <= 0x10FFFF ? String.fromCodePoint(c) : _; })
    .replace(/&([a-zA-Z]+);/g, (m, name) => HTML_ENTITIES[name.toLowerCase()] || m);
}
const stripSuffix = n => { const t = n.split(" ").filter(Boolean); while (t.length > 1 && CORP_SUFFIXES.has(t[t.length-1])) t.pop(); return t.join(" "); };

async function rngFor(...parts) {
  const data = new TextEncoder().encode(parts.join("|"));
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  let a = (h[0] | h[1]<<8 | h[2]<<16 | h[3]<<24) >>> 0;
  return function() { // mulberry32
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
async function gaussFor(...parts) {
  const r = await rngFor(...parts);
  let spare = null;
  return () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0, v = 0;
    while (u === 0) u = r(); v = r();
    const m = Math.sqrt(-2 * Math.log(u)), a = 2 * Math.PI * v;
    spare = m * Math.sin(a);
    return m * Math.cos(a);
  };
}
const istOffset = 5.5 * 3600 * 1000;
const todayIST = () => new Date(Date.now() + istOffset).toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = iso => new Date(iso + "T00:00:00Z").getUTCDay(); // 0=Sun

async function fetchText(url) {
  const r = await fetch(url, { headers: { "User-Agent": "SCALE-India-Updater/1.1 (educational tracker)" } });
  if (!r.ok) throw new Error("http " + r.status);
  return await r.text();
}
function csvNames(text, col) {
  const lines = text.split(/\r?\n/);
  if (!lines.length) return new Set();
  const header = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const idx = header.findIndex(h => h.replace(/\s+/g, " ").toUpperCase().includes(col));
  if (idx < 0) return new Set();
  const out = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const nm = (cells[idx] || "").trim().replace(/^"|"$/g, "");
    const s = stripSuffix(norm(nm));
    if (s) out.add(s);
  }
  return out;
}
async function nseNames(url) { return csvNames(await fetchText(url), "NAME OF COMPANY"); }
async function bseNames() {
  const today = todayIST();
  for (let back = 0; back < 8; back++) {
    const d = addDays(today, -back).replace(/-/g, "");
    try {
      const names = csvNames(await fetchText(BSE_BHAVCOPY(d)), "FININSTRMNM");
      if (names.size) return { names, date: addDays(today, -back) };
    } catch (e) {}
  }
  return { names: null, date: null };
}
function parseFeed(source, raw) {
  const items = [];
  const blocks = raw.split(/<item[\s>]/).slice(1);
  for (const b of blocks) {
    const get = tag => { const m = b.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">")); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : ""; };
    const title = get("title"), link = get("link");
    if (!title || !link) continue;
    const pub = get("pubDate") || get("date");
    let d = new Date(pub);
    if (isNaN(d)) d = new Date();
    const summary = decodeEntities(get("description").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 240);
    items.push({ title: decodeEntities(title.replace(/\s+/g, " ")), url: link, source, date: d.toISOString(), summary });
  }
  return items;
}
function tagStartups(item, startups) {
  const text = item.title + " " + (item.summary || "");
  const tags = [];
  for (const s of startups) {
    for (const n of [s.name, ...(s.aliases || [])]) {
      const re = new RegExp("\\b" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
      if (re.test(text)) { tags.push(s.id); break; }
    }
  }
  return tags;
}
async function buildSeries(s, drift) {
  const r0 = await rngFor(s.id, "anchor");
  const vol = 0.018 + r0() * 0.014;
  let price = s.base_price / (1 + (r0() * 0.16 - 0.08));
  const start = addDays(todayIST(), -(HISTORY_DAYS - 1));
  const series = [];
  for (let i = 0; i < HISTORY_DAYS; i++) {
    const d = addDays(start, i);
    const wd = weekday(d);
    if (wd !== 0 && wd !== 6) {
      const g = await gaussFor(s.id, d);
      const tide = (await gaussFor("tide", d))() * 0.004;
      let ret = tide + (drift[s.id + "|" + d] || 0) + g() * vol;
      ret = Math.max(-0.06, Math.min(0.06, ret));
      price = Math.max(1, price * (1 + ret));
      series.push({ d, c: Math.round(price * 100) / 100 });
    }
  }
  return series;
}

async function runUpdate(env) {
  const log = [];
  const say = m => { log.push(m); };
  // Seed state: KV first, bundled seed as fallback.
  const su = (await env.SCALE_DATA.get("startups.json", "json")) || SEED_STARTUPS;
  const startups = su.startups;
  const newsOld = ((await env.SCALE_DATA.get("news.json", "json")) || { items: [] }).items;
  for (const it of newsOld) { it.title = decodeEntities(it.title); it.summary = decodeEntities(it.summary); }
  const grad = (await env.SCALE_DATA.get("graduated.json", "json")) || SEED_GRADUATED;
  const reviewOld = ((await env.SCALE_DATA.get("review.json", "json")) || { items: [] }).items;

  // 1. News
  const seen = new Set(newsOld.map(i => i.url));
  const fresh = [];
  for (const [source, url] of FEEDS) {
    try {
      for (const it of parseFeed(source, await fetchText(url))) {
        if (seen.has(it.url)) continue;
        if (!isStartupRelevant(it.title, it.summary, startups)) continue;
        seen.add(it.url); fresh.push(it);
      }
    } catch (e) { say("news " + source + " failed: " + e.message); }
  }
  const items = fresh.concat(newsOld).slice(0, MAX_NEWS);
  for (const it of items) it.startups = tagStartups(it, startups);
  say("news: " + fresh.length + " new, " + items.length + " total");

  // 2. Exchange sources (fail-closed on NSE master)
  let nse = null, sme = null, bse = { names: null, date: null };
  try { nse = await nseNames(NSE_EQUITY_CSV); say("nse: " + nse.size); } catch (e) { say("nse failed: " + e.message); }
  try { sme = await nseNames(NSE_SME_CSV); say("nse-sme: " + sme.size); } catch (e) { say("nse-sme failed: " + e.message); }
  try { bse = await bseNames(); say("bse: " + (bse.names ? bse.names.size + " @" + bse.date : "none")); } catch (e) { say("bse failed: " + e.message); }
  const status = { nse_master_ok: !!nse, nse_sme_ok: !!sme, bse_bhavcopy_ok: !!bse.names, bse_bhavcopy_date: bse.date };

  let kept = startups, newGrads = [], reviewNew = [];
  if (nse) {
    kept = [];
    for (const s of startups) {
      const cands = new Set([stripSuffix(norm(s.name)), ...(s.aliases || []).map(a => stripSuffix(norm(a)))].filter(c => c && c.length > 3));
      let evidence = null;
      for (const c of cands) {
        if (nse.has(c)) { evidence = "Matched NSE listed-company master (" + c + ")"; break; }
        if (sme && sme.has(c)) { evidence = "Matched NSE SME master (" + c + ")"; break; }
        if (bse.names && bse.names.has(c)) { evidence = "Matched BSE equity bhavcopy " + bse.date + " (" + c + ")"; break; }
      }
      if (evidence) { newGrads.push({ name: s.name, sector: s.sector, listed: todayIST(), detail: evidence }); say("graduate: " + s.name); continue; }
      for (const it of items) {
        const blob = it.title + " " + (it.summary || "");
        let hit = false;
        for (const n of [s.name, ...(s.aliases || [])]) {
          const re = new RegExp("\\b" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
          if (re.test(blob)) { hit = true; break; }
        }
        if (hit && RE_LISTING_DONE.test(blob)) {
          reviewNew.push({ startup: s.name, evidence: it.title, source: it.source, url: it.url, flagged: todayIST() });
          break;
        }
      }
      kept.push(s);
    }
  } else { say("NSE master unreachable - no eligibility changes"); }

  // IPO watch flags
  const watch = new Set();
  for (const it of items) {
    const blob = it.title + " " + (it.summary || "");
    if (!RE_IPO_WATCH.test(blob) || RE_LISTING_DONE.test(blob)) continue;
    for (const sid of it.startups || []) watch.add(sid);
  }
  for (const s of kept) s.ipo_watch = watch.has(s.id);

  // 3. Prices
  const prices = (await env.SCALE_DATA.get("prices.json", "json")) || { series: {} };
  const drift = {};
  for (const it of items) {
    const d = (it.date || "").slice(0, 10);
    if (!d) continue;
    let score = 0;
    if (RE_POSITIVE.test(it.title)) score += 1;
    if (RE_NEGATIVE.test(it.title)) score -= 1;
    for (const sid of it.startups || []) {
      const k = sid + "|" + d;
      drift[k] = Math.max(-0.02, Math.min(0.02, (drift[k] || 0) + score * 0.006));
    }
  }
  const today = todayIST();
  for (const s of kept) {
    let hist = prices.series[s.id];
    if (!hist || !hist.length) { hist = await buildSeries(s, drift); }
    else {
      let d = addDays(hist[hist.length - 1].d, 1);
      let price = hist[hist.length - 1].c;
      const r0 = await rngFor(s.id, "anchor");
      const vol = 0.018 + r0() * 0.014;
      while (d <= today) {
        const wd = weekday(d);
        if (wd !== 0 && wd !== 6) {
          const g = await gaussFor(s.id, d);
          const tide = (await gaussFor("tide", d))() * 0.004;
          let ret = Math.max(-0.06, Math.min(0.06, tide + (drift[s.id + "|" + d] || 0) + g() * vol));
          price = Math.max(1, price * (1 + ret));
          hist.push({ d, c: Math.round(price * 100) / 100 });
        }
        d = addDays(d, 1);
      }
    }
    prices.series[s.id] = hist.slice(-HISTORY_DAYS);
  }
  const keepIds = new Set(kept.map(s => s.id));
  for (const sid of Object.keys(prices.series)) if (!keepIds.has(sid)) delete prices.series[sid];
  prices.updated = new Date().toISOString();
  prices.note = "Simulated prices for learning. Unlisted startups have no live market price; moves are driven by news signals plus a deterministic model.";

  // 4. Persist
  const seenReview = new Set(reviewOld.map(r => r.startup + "|" + r.url));
  const reviewItems = reviewNew.filter(r => !seenReview.has(r.startup + "|" + r.url)).concat(reviewOld);
  const suOut = { ...su, startups: kept, updated: today };
  const grOut = { ...grad, graduated: newGrads.concat(grad.graduated || []), updated: today };
  const meta = {
    updated: new Date().toISOString(), tracked: kept.length,
    graduated_total: (grOut.graduated || []).length,
    new_graduates: newGrads.map(g => g.name),
    feeds: FEEDS.map(f => f[0]), exchange_check: status,
    note: "Generated by the SCALE data worker on Cloudflare (scheduled 4x daily). Runs the same rules as scripts/update_data.py.",
  };
  await env.SCALE_DATA.put("startups.json", JSON.stringify(suOut));
  await env.SCALE_DATA.put("prices.json", JSON.stringify(prices));
  await env.SCALE_DATA.put("news.json", JSON.stringify({ items, updated: new Date().toISOString() }));
  await env.SCALE_DATA.put("graduated.json", JSON.stringify(grOut));
  await env.SCALE_DATA.put("review.json", JSON.stringify({ updated: today, note: "News-flagged possible listings. Companies stay tracked until an exchange master confirms.", items: reviewItems }));
  await env.SCALE_DATA.put("meta.json", JSON.stringify(meta));
  await env.SCALE_DATA.put("eligibility.json", JSON.stringify(SEED_ELIGIBILITY));
  await env.SCALE_DATA.put("pending.json", JSON.stringify(SEED_PENDING));
  say("done; tracked=" + kept.length);
  return { log, meta };
}

const CORS = { "access-control-allow-origin": "*", "content-type": "application/json; charset=utf-8" };
/* ---------------------------------------------------------- Durable Object -
   PortfolioStore is the single transactional authority for account portfolio
   mutations. Cloudflare KV is eventually consistent and has no compare-and-
   swap, so read-modify-write trades executed in the worker itself can race
   across isolates/edges and double-spend. Each account maps to exactly one
   Durable Object instance (idFromName(userId)); DOs process requests single-
   threaded with transactional storage, so concurrent trades against one
   account are fully serialized no matter which edge receives them. The DO
   writes a display copy to KV (port:/txn:) for /lb and /api/portfolio reads;
   those reads may lag slightly but never drive a spending decision. */
export class PortfolioStore {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(req) {
    let b; try { b = await req.json(); } catch { return jres({ error: "bad_json" }, 400); }
    if (b.action !== "trade") return jres({ error: "unknown_action" }, 400);
    // True read-modify-write atomicity: a Durable Object is single-threaded but
    // async handlers can still interleave at awaits, so the balance update runs
    // inside a storage transaction. Cloudflare retries the closure on conflict
    // and commits all writes atomically, so two concurrent trades can never
    // both read the same pre-image. External side effects (KV write-through)
    // stay outside the transaction so a retry cannot double-journal.
    const id = String(b.id || ""); const side = String(b.side || "");
    const qty = Math.floor(+b.qty); const px = +b.price;
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(px) || px <= 0) return jres({ error: "qty", detail: "Invalid trade parameters" }, 400);
    const outcome = await this.state.storage.transaction(async (txn) => {
      const p = (await txn.get("port")) || { cash: ACCT_START_CASH, holdings: {}, trades: 0, createdAt: nowIso() };
      if (p.frozen) return { status: 409, body: { error: "frozen", detail: "This account is frozen pending review. Contact the creator." } };
      if (side === "BUY") {
        const cost = qty * px;
        if (cost > p.cash + 0.001) return { status: 400, body: { error: "insufficient_cash", detail: "Insufficient cash" } };
        const h = p.holdings[id] || { qty: 0, avg: 0 };
        const nq = h.qty + qty;
        h.avg = (h.avg * h.qty + cost) / nq;
        h.qty = nq;
        p.holdings[id] = h;
        p.cash = Math.round((p.cash - cost) * 100) / 100;
      } else if (side === "SELL") {
        const h = p.holdings[id];
        if (!h || h.qty < qty) return { status: 400, body: { error: "insufficient_holding", detail: "Not enough shares to sell" } };
        h.qty -= qty;
        if (!h.qty) delete p.holdings[id];
        p.cash = Math.round((p.cash + qty * px) * 100) / 100;
      } else {
        return { status: 400, body: { error: "side", detail: "Invalid trade type" } };
      }
      p.trades = (p.trades || 0) + 1;
      p.updated = nowIso();
      if (!portfolioInvariant(p)) return { status: 409, body: { error: "invariant", detail: "Inconsistent portfolio state; trade refused." } };
      await txn.put("port", p);
      return { status: 200, body: { ok: true, fillPrice: px, executed_at: p.updated }, port: p };
    });
    if (outcome.port) {
      // Committed: write-through display copies for /lb and /api/portfolio.
      const p = outcome.port; const ts = p.updated;
      const txnRec = { id: acctId(), startup: id, type: side, qty, price: px, total: Math.round(qty * px * 100) / 100, timestamp: ts };
      await this.env.SCALE_DATA.put("port:" + b.userId, JSON.stringify(p));
      const txns = (await this.env.SCALE_DATA.get("txn:" + b.userId, "json")) || [];
      txns.unshift(txnRec);
      await this.env.SCALE_DATA.put("txn:" + b.userId, JSON.stringify(txns.slice(0, 100)));
    }
    return jres(outcome.body, outcome.status);
  }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/run") {
      // Manual trigger is operator-only: the scheduled cron does not use this route.
      if (!env.RUN_KEY || req.headers.get("x-run-key") !== env.RUN_KEY) {
        return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: CORS });
      }
      const { log, meta } = await runUpdate(env);
      return new Response(JSON.stringify({ ok: true, log, meta }, null, 1), { headers: CORS });
    }
    if (url.pathname === "/lb" || url.pathname === "/lb/register" || url.pathname === "/lb/trade") {
      if (req.method === "OPTIONS") return new Response(null, { headers: { ...CORS, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type" } });
      if (url.pathname === "/lb" && req.method === "GET") return await lbList(env);
      if ((url.pathname === "/lb/register" || url.pathname === "/lb/trade") && req.method === "POST") return lbGone();
      return new Response(JSON.stringify({ error: "method" }), { status: 405, headers: CORS });
    }
    if (url.pathname.startsWith("/api/")) return await handleApi(req, env, url, ctx);
    const m = url.pathname.match(/^\/data\/([a-z]+\.json)$/);
    if (m) {
      const v = await env.SCALE_DATA.get(m[1]);
      if (v === null) return new Response(JSON.stringify({ error: "not_ready" }), { status: 404, headers: CORS });
      return new Response(v, { headers: { ...CORS, "cache-control": "public, max-age=300" } });
    }
    if (url.pathname === "/health") return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    if (url.pathname === "/site.zip") {
      // Self-hosted deploy artifact: the static preview (Render) builds from this zip,
      // so site updates ship by writing KV, with no dashboard or GitHub dependency.
      const b64 = await env.SCALE_DATA.get("SITE_ZIP_B64");
      if (b64 === null) return new Response(JSON.stringify({ error: "not_ready" }), { status: 404, headers: CORS });
      const bin = Uint8Array.from(atob(b64.replace(/\s+/g, "")), c => c.charCodeAt(0));
      return new Response(bin, { headers: { "content-type": "application/zip", "cache-control": "no-store" } });
    }
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: CORS });
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(runUpdate(env)); },
};



/* ------------------------------------------- accounts / server portfolios ---- */
// Restoration of the original FastAPI backend behavior (backend/server.py) on the
// free worker+KV stack: username/password signup -> login -> server-side
// portfolio/trades/transactions. Per the owner's 2026-11-14 direction, signup is
// APPROVED IMMEDIATELY with no expiry window (the original 10-day approval window
// is retired: auto-approving with an expiry would silently lock everyone out).
// The admin can still kick an account (reject/revoke): kicked accounts are blocked
// from login, ranked trades and the leaderboard, outstanding sessions die via the
// version bump, and a kicked account CANNOT restore itself by re-signing up or
// reapplying - only the admin can re-approve it. No email notifications are sent.

const ACCT_START_CASH = 1000000;            // matches the site's Sim-Rs 10,00,000
const TOKEN_DAYS = 7;                       // original JWT_EXPIRE_DAYS
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PBKDF2_ITER = 100000;

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uDec = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const utf8 = s => new TextEncoder().encode(s);

async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", utf8(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITER, hash: "SHA-256" }, key, 256);
  return "v1:" + b64u(salt) + ":" + b64u(bits);
}
async function verifyPassword(pw, stored) {
  try {
    const [v, s, h] = String(stored).split(":");
    if (v !== "v1") return false;
    const key = await crypto.subtle.importKey("raw", utf8(pw), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: b64uDec(s), iterations: PBKDF2_ITER, hash: "SHA-256" }, key, 256));
    const want = b64uDec(h);
    if (bits.length !== want.length) return false;
    let diff = 0;
    for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ want[i];
    return diff === 0;
  } catch { return false; }
}
async function signToken(payload) {
  const body = b64u(utf8(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", utf8(payload.__secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const { __secret, ...pub } = payload;
  const bodyPub = b64u(utf8(JSON.stringify(pub)));
  const sig = await crypto.subtle.sign("HMAC", key, utf8(bodyPub));
  return bodyPub + "." + b64u(sig);
}
async function verifyToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const key = await crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expect = b64u(await crypto.subtle.sign("HMAC", key, utf8(parts[0])));
  if (expect !== parts[1]) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64uDec(parts[0]))); } catch { return null; }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}
const acctId = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

async function rateLimitKV(env, key, max, windowSec) {
  const k = "rl:" + key;
  const cur = (await env.SCALE_DATA.get(k, "json")) || { n: 0 };
  if (cur.n >= max) return false;
  await env.SCALE_DATA.put(k, JSON.stringify({ n: cur.n + 1 }), { expirationTtl: windowSec });
  return true;
}

// Admin seeding mirrors the original _seed_admin: the admin record is (re)synced
// from the ADMIN_PASSWORD worker secret, so rotating the secret rotates the
// account. The repo's leaked .env password is never reused - the deploy sets a
// fresh random one.
async function ensureAdmin(env) {
  if (!env.ADMIN_PASSWORD) return;
  const marker = b64u(await crypto.subtle.digest("SHA-256", utf8("admin-marker|" + env.ADMIN_PASSWORD)));
  const existing = await env.SCALE_DATA.get("user:admin", "json");
  if (existing && existing.pwMarker === marker) return;
  const rec = {
    id: existing ? existing.id : acctId(),
    username: "admin", username_lc: "admin",
    email: existing && existing.email || "",
    realName: "Creator",
    passHash: await hashPassword(env.ADMIN_PASSWORD),
    pwMarker: marker,
    // Rotating the ADMIN_PASSWORD secret invalidates outstanding admin tokens.
    v: existing && existing.pwMarker !== marker ? (existing.v || 0) + 1 : (existing && existing.v || 0),
    status: "approved", isAdmin: true,
    createdAt: existing && existing.createdAt || nowIso(),
    approvedAt: nowIso(), approvedUntil: null,
    leaderboardHidden: true,
  };
  await env.SCALE_DATA.put("user:admin", JSON.stringify(rec));
}

function userActive(u) {
  if (u.isAdmin) return [true, ""];
  const status = u.status || "pending";
  if (status === "pending") return [false, "Your account is not active. Please log in again or contact the site owner."];
  if (status === "rejected") return [false, "This account was removed by the administrator."];
  if (u.approvedUntil && Date.now() > Date.parse(u.approvedUntil)) {
    return [false, "Your access has expired (10 days). Submit a new application from the Account tab."];
  }
  return [true, ""];
}

async function getSession(req, env) {
  const h = req.headers.get("authorization") || "";
  if (!h.toLowerCase().startsWith("bearer ")) return null;
  const p = await verifyToken(h.slice(7).trim(), env.AUTH_SECRET);
  if (!p) return null;
  return p;
}
const jres = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: CORS });
const badJson = async req => { try { return [await req.json(), null]; } catch { return [null, jres({ error: "bad_json" }, 400)]; } };

async function acctSignup(req, env) {
  const [b, err] = await badJson(req); if (err) return err;
  const username = String(b.username || "").trim();
  const email = String(b.email || "").trim();
  const realName = String(b.real_name || "").trim().slice(0, 80);
  const pw = String(b.password || "");
  if (!USERNAME_RE.test(username)) return jres({ error: "username", detail: "Username must be 3-20 chars (letters, numbers, underscore)." }, 400);
  if (pw.length < 6) return jres({ error: "password", detail: "Password must be at least 6 characters." }, 400);
  if (!EMAIL_RE.test(email)) return jres({ error: "email", detail: "Please provide a valid email address." }, 400);
  if (!realName) return jres({ error: "real_name", detail: "Real name is required (used only for your certificate)." }, 400);
  const lc = username.toLowerCase();
  const existing = await env.SCALE_DATA.get("user:" + lc, "json");
  if (existing) {
    if (existing.isAdmin) return jres({ error: "taken", detail: "Username already taken" }, 409);
    if (existing.status === "rejected") {
      // Kicked by the admin: no self-restore through the signup form.
      return jres({ error: "removed", detail: "This account was removed by the administrator. Please contact the site owner if you believe this is a mistake." }, 403);
    }
    const expired = existing.status === "approved" && existing.approvedUntil && Date.now() > Date.parse(existing.approvedUntil);
    if (!expired) return jres({ error: "taken", detail: "Username already taken" }, 409);
    // legacy expired account: reactivates immediately under auto-approval
    existing.passHash = await hashPassword(pw);
    existing.email = email;
    if (realName) existing.realName = realName;
    existing.status = "approved";
    existing.approvedAt = nowIso(); existing.approvedUntil = null;
    existing.reappliedAt = nowIso();
    existing.v = (existing.v || 0) + 1;   // invalidate any outstanding tokens
    await env.SCALE_DATA.put("user:" + lc, JSON.stringify(existing));
    return jres({ submitted: true, approved: true, message: "Account reactivated. You can log in right away." });
  }
  const rec = {
    id: acctId(), username, username_lc: lc,
    email, realName,
    passHash: await hashPassword(pw),
    status: "approved", isAdmin: false,
    createdAt: nowIso(), approvedAt: nowIso(), approvedUntil: null,
    leaderboardHidden: false, v: 0,
  };
  await env.SCALE_DATA.put("user:" + lc, JSON.stringify(rec));
  await env.SCALE_DATA.put("port:" + rec.id, JSON.stringify({ cash: ACCT_START_CASH, holdings: {}, trades: 0, createdAt: nowIso(), updated: nowIso() }));
  return jres({ submitted: true, approved: true, message: "Account created. You can log in right away." });
}

async function acctLogin(req, env) {
  const [b, err] = await badJson(req); if (err) return err;
  const lc = String(b.username || "").trim().toLowerCase();
  const u = await env.SCALE_DATA.get("user:" + lc, "json");
  if (!u || !(await verifyPassword(String(b.password || ""), u.passHash))) {
    return jres({ error: "invalid", detail: "Invalid username or password" }, 401);
  }
  const [ok, reason] = userActive(u);
  if (!ok) return jres({ error: "inactive", status: u.status, detail: reason }, 403);
  const token = await signToken({ userId: u.id, username: u.username, isAdmin: !!u.isAdmin, v: u.v || 0, exp: Date.now() + TOKEN_DAYS * 864e5, __secret: env.AUTH_SECRET });
  return jres({ token, userId: u.id, username: u.username, isAdmin: !!u.isAdmin, approvedUntil: u.approvedUntil });
}

async function acctReapply(req, env) {
  const [b, err] = await badJson(req); if (err) return err;
  const lc = String(b.username || "").trim().toLowerCase();
  const u = await env.SCALE_DATA.get("user:" + lc, "json");
  if (!u || !(await verifyPassword(String(b.password || ""), u.passHash))) {
    return jres({ error: "invalid", detail: "Invalid username or password" }, 401);
  }
  if (u.isAdmin) return jres({ error: "admin", detail: "Admin does not need to reapply." }, 400);
  if (u.status === "rejected") {
    // Kicked by the admin: reapply cannot restore access.
    return jres({ error: "removed", status: "rejected", detail: "This account was removed by the administrator. Please contact the site owner if you believe this is a mistake." }, 403);
  }
  if (u.status === "approved" && !(u.approvedUntil && Date.now() > Date.parse(u.approvedUntil))) {
    return jres({ submitted: true, approved: true, message: "Your account is already active - just log in." });
  }
  // legacy expired/pending account: active immediately under auto-approval
  u.status = "approved"; u.reason = String(b.reason || "").trim(); u.approvedAt = nowIso(); u.approvedUntil = null; u.reappliedAt = nowIso();
  await env.SCALE_DATA.put("user:" + lc, JSON.stringify(u));
  return jres({ submitted: true, approved: true, message: "Account reactivated. You can log in right away." });
}

async function acctMe(req, env, sess) {
  const u = await env.SCALE_DATA.get("user:" + sess.username.toLowerCase(), "json");
  if (!u) return jres({ error: "not_found", detail: "User not found" }, 401);
  const [ok, reason] = userActive(u);
  if (!ok) return jres({ error: "inactive", status: u.status, detail: reason }, 403);
  return jres({ userId: u.id, username: u.username, isAdmin: !!u.isAdmin, approvedUntil: u.approvedUntil });
}

async function acctChangePassword(req, env, sess) {
  const [b, err] = await badJson(req); if (err) return err;
  const np = String(b.newPassword || "");
  if (np.length < 6) return jres({ error: "password", detail: "New password must be at least 6 characters." }, 400);
  if (np === String(b.currentPassword || "")) return jres({ error: "same", detail: "New password must differ from current password." }, 400);
  const u = await env.SCALE_DATA.get("user:" + sess.username.toLowerCase(), "json");
  if (!u || !(await verifyPassword(String(b.currentPassword || ""), u.passHash))) {
    return jres({ error: "invalid", detail: "Current password is incorrect." }, 401);
  }
  u.passHash = await hashPassword(np);
  u.v = (u.v || 0) + 1;   // password change invalidates every outstanding session
  await env.SCALE_DATA.put("user:" + u.username_lc, JSON.stringify(u));
  return jres({ ok: true, message: "Password updated successfully." });
}

/* ---- server portfolio ---- */
async function acctPortfolioDoc(env, userId) {
  let p = await env.SCALE_DATA.get("port:" + userId, "json");
  if (!p) {
    p = { cash: ACCT_START_CASH, holdings: {}, trades: 0, createdAt: nowIso(), updated: nowIso() };
    await env.SCALE_DATA.put("port:" + userId, JSON.stringify(p));
  }
  return p;
}
function lastCloses(prices) {
  const out = {};
  for (const [sid, ser] of Object.entries((prices && prices.series) || {})) {
    if (ser && ser.length) out[sid] = ser[ser.length - 1].c;
  }
  return out;
}
async function acctGetPortfolio(env, sess) {
  const p = await acctPortfolioDoc(env, sess.userId);
  const prices = (await env.SCALE_DATA.get("prices.json", "json")) || { series: {} };
  const close = lastCloses(prices);
  let invested = 0, current = 0;
  const holdings = [];
  for (const [sid, h] of Object.entries(p.holdings)) {
    const ltp = close[sid] || h.avg;
    const inv = h.avg * h.qty, cur = ltp * h.qty;
    invested += inv; current += cur;
    holdings.push({ id: sid, qty: h.qty, avgBuyPrice: Math.round(h.avg * 100) / 100, ltp: Math.round(ltp * 100) / 100, currentValue: Math.round(cur * 100) / 100, pnl: Math.round((cur - inv) * 100) / 100, pnlPct: inv > 0 ? Math.round((cur - inv) / inv * 10000) / 100 : 0 });
  }
  const totalValue = p.cash + current;
  return jres({
    cash: Math.round(p.cash * 100) / 100,
    holdings,
    totalInvested: Math.round(invested * 100) / 100,
    holdingsValue: Math.round(current * 100) / 100,
    totalValue: Math.round(totalValue * 100) / 100,
    totalPnl: Math.round((totalValue - ACCT_START_CASH) * 100) / 100,
    totalPnlPct: Math.round((totalValue - ACCT_START_CASH) / ACCT_START_CASH * 10000) / 100,
    trades: p.trades || 0,
  });
}

// Original gate: trading only while NSE is open (Mon-Fri 09:15-15:30 IST), plus
// the site's fail-closed stale-data guard (no trades on data older than 26h).
function marketOpenIST() {
  const ist = new Date(Date.now() + istOffset);
  const wd = ist.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}
// Portfolio mutations are executed inside the per-account PortfolioStore
// Durable Object (single-threaded, transactional) - see the class comment
// above. The worker performs only the market-level gates here (fresh data,
// NSE market hours, valid instrument/price) and hands the balance change to
// the DO, which is the sole writer of the authoritative balance.
function portfolioInvariant(p) {
  if (!p || typeof p.cash !== "number" || p.cash < -0.01) return false;
  for (const h of Object.values(p.holdings || {})) { if (!h || !(h.qty > 0) || !(h.avg > 0)) return false; }
  return true;
}

async function acctTrade(req, env, sess) {
  const [b, err] = await badJson(req); if (err) return err;
  const id = String(b.id || "");
  const side = String(b.side || "");
  const qty = Math.floor(+b.qty);
  if (!Number.isFinite(qty) || qty <= 0 || qty > 1000000) return jres({ error: "qty", detail: "Quantity must be positive" }, 400);
  const meta = await env.SCALE_DATA.get("meta.json", "json");
  const lastRun = meta && meta.updated ? Date.parse(meta.updated) : 0;
  if (!lastRun || Date.now() - lastRun > 26 * 3600e3) {
    return jres({ error: "stale_data", detail: "Market data is stale (last update over 26h ago); trading is paused until the updater runs again." }, 503);
  }
  if (!marketOpenIST()) return jres({ error: "market_closed", detail: "Trading is disabled. NSE is currently closed." }, 400);
  const prices = (await env.SCALE_DATA.get("prices.json", "json")) || { series: {} };
  const ser = prices.series[id];
  if (!ser || !ser.length) return jres({ error: "unknown_id", detail: "Unknown startup" }, 400);
  const px = ser[ser.length - 1].c;
  const stub = env.PORTFOLIO_STORE.get(env.PORTFOLIO_STORE.idFromName(sess.userId));
  return await stub.fetch("https://portfolio-store/trade", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "trade", userId: sess.userId, id, side, qty, price: px }),
  });
}

// Browser-portfolio import is DISABLED: a ranked portfolio must be built only
// from trades placed on this server during NSE market hours. Even repriced at
// current quotes, client-declared starting assets are unverifiable, so the
// import path was removed rather than trusted.
async function acctImport() {
  return jres({ error: "import_disabled", detail: "Browser-portfolio import is no longer accepted. Your ranked server portfolio starts at Sim\u20b910,00,000 and changes only through trades placed here during NSE market hours." }, 410);
}

async function acctTransactions(env, sess) {
  const txns = (await env.SCALE_DATA.get("txn:" + sess.userId, "json")) || [];
  return jres({ transactions: txns });
}

/* ---- admin (creator) ---- */
function appView(u) {
  return { userId: u.id, username: u.username, email: u.email || "", realName: u.realName || "", reason: u.reason || "", status: u.status || "pending", isAdmin: !!u.isAdmin, createdAt: u.createdAt, approvedAt: u.approvedAt, approvedUntil: u.approvedUntil, reappliedAt: u.reappliedAt, leaderboardHidden: !!u.leaderboardHidden };
}
async function adminApplications(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.SCALE_DATA.list({ prefix: "user:", cursor });
    for (const k of page.keys) {
      const u = await env.SCALE_DATA.get(k.name, "json");
      if (u && !u.isAdmin) out.push(appView(u));
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  out.sort((a, b) => String(b.reappliedAt || b.createdAt || "").localeCompare(String(a.reappliedAt || a.createdAt || "")));
  const by = s => out.filter(r => r.status === s);
  return jres({ pending: by("pending"), approved: by("approved"), rejected: by("rejected"), counts: { pending: by("pending").length, approved: by("approved").length, rejected: by("rejected").length } });
}
async function findUserById(env, userId) {
  // userId -> record: scan the (small) user prefix
  let cursor;
  do {
    const page = await env.SCALE_DATA.list({ prefix: "user:", cursor });
    for (const k of page.keys) {
      const u = await env.SCALE_DATA.get(k.name, "json");
      if (u && u.id === userId) return u;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return null;
}

async function adminAction(req, env, action, ctx) {
  const [b, err] = await badJson(req); if (err) return err;
  const u = await findUserById(env, String(b.userId || ""));
  if (!u) return jres({ error: "not_found", detail: "User not found" }, 404);
  if (u.isAdmin) return jres({ error: "admin", detail: "Cannot modify admin account" }, 400);
  if (action === "approve") {
    // Admin approval is permanent under auto-approval (no 10-day window).
    u.status = "approved"; u.approvedAt = nowIso(); u.approvedUntil = null;
    await env.SCALE_DATA.put("user:" + u.username_lc, JSON.stringify(u));
    return jres({ ok: true, approvedUntil: null });
  }
  if (action === "reject") {
    u.status = "rejected"; u.approvedAt = null; u.approvedUntil = null;
    u.v = (u.v || 0) + 1;   // outstanding sessions die immediately
    await env.SCALE_DATA.put("user:" + u.username_lc, JSON.stringify(u));
    return jres({ ok: true });
  }
  if (action === "revoke") {
    // Kick: same blocked state as reject - no pending self-restore path exists.
    u.status = "rejected"; u.approvedAt = null; u.approvedUntil = null;
    u.v = (u.v || 0) + 1;
    await env.SCALE_DATA.put("user:" + u.username_lc, JSON.stringify(u));
    return jres({ ok: true });
  }
  if (action === "leaderboard-visibility") {
    u.leaderboardHidden = !!b.hidden;
    await env.SCALE_DATA.put("user:" + u.username_lc, JSON.stringify(u));
    return jres({ ok: true, leaderboardHidden: u.leaderboardHidden });
  }
  return jres({ error: "action" }, 400);
}
async function adminBulk(env, action) {
  let cursor, count = 0;
  do {
    const page = await env.SCALE_DATA.list({ prefix: "user:", cursor });
    for (const k of page.keys) {
      const u = await env.SCALE_DATA.get(k.name, "json");
      if (!u || u.isAdmin) continue;
      if (action === "reject-pending" && u.status === "pending") { u.status = "rejected"; u.approvedAt = null; u.approvedUntil = null; u.v = (u.v || 0) + 1; }
      else if (action === "revoke-approved" && u.status === "approved") { u.status = "rejected"; u.approvedAt = null; u.approvedUntil = null; u.v = (u.v || 0) + 1; }
      else if (action === "leaderboard-hide-all") u.leaderboardHidden = true;
      else if (action === "leaderboard-show-all") u.leaderboardHidden = false;
      else continue;
      count++;
      await env.SCALE_DATA.put(k.name, JSON.stringify(u));
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return jres({ ok: true, count });
}

async function handleApi(req, env, url, ctx) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { ...CORS, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type, authorization" } });
  }
  if (!env.AUTH_SECRET) return jres({ error: "auth_not_configured" }, 503);
  await ensureAdmin(env);
  const path = url.pathname;
  const ip = req.headers.get("cf-connecting-ip") || "anon";
  // auth endpoints (rate-limited like the original: 10/min, reapply 5/min)
  if (path === "/api/auth/signup" && req.method === "POST") {
    if (!(await rateLimitKV(env, "signup:" + ip, 10, 60))) return jres({ error: "rate_limited", detail: "Too many requests. Try again shortly." }, 429);
    return await acctSignup(req, env);
  }
  if (path === "/api/auth/login" && req.method === "POST") {
    if (!(await rateLimitKV(env, "login:" + ip, 10, 60))) return jres({ error: "rate_limited", detail: "Too many requests. Try again shortly." }, 429);
    return await acctLogin(req, env);
  }
  if (path === "/api/auth/reapply" && req.method === "POST") {
    if (!(await rateLimitKV(env, "reapply:" + ip, 5, 60))) return jres({ error: "rate_limited", detail: "Too many requests. Try again shortly." }, 429);
    return await acctReapply(req, env);
  }
  const sess = await getSession(req, env);
  if (!sess) return jres({ error: "unauthorized", detail: "Missing or invalid token" }, 401);
  // Central session validation: the token must match the user's CURRENT auth
  // version (password change, admin revoke/reject, re-application and admin
  // secret rotation all bump v and thereby invalidate outstanding tokens), and
  // the account must be active (approved and inside its 10-day window). This
  // covers portfolio/trade/import/transactions/admin - not just /api/auth/me.
  const sessUser = await env.SCALE_DATA.get("user:" + String(sess.username || "").toLowerCase(), "json");
  if (!sessUser || (sessUser.v || 0) !== (sess.v || 0)) {
    return jres({ error: "session_expired", detail: "Your session is no longer valid. Please log in again." }, 401);
  }
  const [activeOk, activeReason] = userActive(sessUser);
  if (!activeOk) return jres({ error: "inactive", status: sessUser.status, detail: activeReason }, 403);
  if (path === "/api/auth/me" && req.method === "GET") return await acctMe(req, env, sess);
  if (path === "/api/auth/change-password" && req.method === "POST") return await acctChangePassword(req, env, sess);
  if (path === "/api/portfolio" && req.method === "GET") return await acctGetPortfolio(env, sess);
  if (path === "/api/trade" && req.method === "POST") return await acctTrade(req, env, sess);
  if (path === "/api/portfolio/import" && req.method === "POST") return await acctImport(req, env, sess);
  if (path === "/api/transactions" && req.method === "GET") return await acctTransactions(env, sess);
  if (path === "/api/admin/applications" && req.method === "GET") {
    if (!sess.isAdmin) return jres({ error: "forbidden", detail: "Admin access required" }, 403);
    return await adminApplications(env);
  }
  const mAct = path.match(/^\/api\/admin\/(approve|reject|revoke|leaderboard-visibility)$/);
  if (mAct && req.method === "POST") {
    if (!sess.isAdmin) return jres({ error: "forbidden", detail: "Admin access required" }, 403);
    return await adminAction(req, env, mAct[1], ctx);
  }
  const mBulk = path.match(/^\/api\/admin\/bulk\/(reject-pending|revoke-approved|leaderboard-hide-all|leaderboard-show-all)$/);
  if (mBulk && req.method === "POST") {
    if (!sess.isAdmin) return jres({ error: "forbidden", detail: "Admin access required" }, 403);
    return await adminBulk(env, mBulk[1]);
  }
  return jres({ error: "not_found" }, 404);
}

/* ------------------------------------------------------- leaderboard ---- */
// Shared leaderboard, restored to the original backend's semantics: scores are
// computed from SERVER portfolios of approved accounts. Nothing is submitted
// by clients - there is no register/replay endpoint, so fabricated holdings or
// balances cannot reach the board. Pending, rejected, expired and revoked
// accounts are excluded at read time, as are admin-hidden users and the admin.
const LB_START_CASH = 1000000;

async function lbList(env) {
  const prices = (await env.SCALE_DATA.get("prices.json", "json")) || { series: {} };
  const close = lastCloses(prices);
  const users = [];
  let cursor;
  do {
    const page = await env.SCALE_DATA.list({ prefix: "user:", cursor });
    for (const k of page.keys) {
      const u = await env.SCALE_DATA.get(k.name, "json");
      if (u) users.push(u);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const out = [];
  for (const u of users) {
    if (u.isAdmin || u.leaderboardHidden) continue;
    const [ok] = userActive(u);
    if (!ok) continue;   // pending / rejected / expired never appear
    const p = await env.SCALE_DATA.get("port:" + u.id, "json");
    let value = p && typeof p.cash === "number" ? p.cash : ACCT_START_CASH;
    for (const [hid, h] of Object.entries((p && p.holdings) || {})) {
      value += (close[hid] || h.avg) * h.qty;
    }
    value = Math.round(value);
    out.push({ id: u.id, name: u.username, value, ret: +(((value - LB_START_CASH) / LB_START_CASH) * 100).toFixed(2), updated: (p && p.updated) || u.createdAt, joined: u.createdAt });
  }
  out.sort((a, b) => b.value - a.value);
  return new Response(JSON.stringify({ entries: out.slice(0, 50) }), { headers: { ...CORS, "cache-control": "public, max-age=60" } });
}

// The legacy anonymous endpoints (display-name tokens, client-replayed trades)
function lbGone() {
  return new Response(JSON.stringify({ error: "gone", detail: "The leaderboard is now ranked automatically from the server portfolios of approved accounts - no separate entry or trade submission." }), { status: 410, headers: CORS });
}

const SEED_STARTUPS = {"updated":"2026-11-14","note":"Curated dataset of Indian UNLISTED startups. Eligibility: founded in India, headquartered/primarily operated in India, not listed on any exchange anywhere, not a subsidiary of a listed company. Valuations are last publicly reported figures and may be stale. Prices are simulated for learning.","startups":[{"id":"flipkart","name":"Flipkart","sector":"E-commerce","hq":"Bengaluru","founded":2007,"valuation_usd":36000000000,"funding_usd":15000000000,"investors":["Walmart","Tiger Global","Accel"],"blurb":"India's largest homegrown e-commerce marketplace; IPO deferred to at least 2028.","base_price":512.0,"aliases":["Flipkart Internet"],"ipo_watch":false},{"id":"phonepe","name":"PhonePe","sector":"Fintech","hq":"Bengaluru","founded":2015,"valuation_usd":12000000000,"funding_usd":1900000000,"investors":["Walmart","General Atlantic","Tiger Global"],"blurb":"UPI payments leader; SEBI approval received Jan 2026 but IPO launch paused.","base_price":171.0,"aliases":["PhonePe Private Limited","PhonePe India"],"ipo_watch":false},{"id":"zerodha","name":"Zerodha","sector":"Fintech","hq":"Bengaluru","founded":2010,"valuation_usd":10500000000,"funding_usd":0,"investors":["Bootstrapped"],"blurb":"India's largest discount broker; profitable and bootstrapped with no IPO plans.","base_price":150.0,"aliases":["Zerodha Broking"],"ipo_watch":false},{"id":"razorpay","name":"Razorpay","sector":"Fintech","hq":"Bengaluru","founded":2014,"valuation_usd":5000000000,"funding_usd":740000000,"investors":["Peak XV","Lightspeed","Tiger Global","GIC"],"blurb":"Payments and banking infra for businesses; SEBI nod Nov 2026, eyeing a 2027 listing.","base_price":71.0,"aliases":["Razorpay Software"],"ipo_watch":true},{"id":"zepto","name":"Zepto","sector":"Quick commerce","hq":"Mumbai","founded":2021,"valuation_usd":4500000000,"funding_usd":3600000000,"investors":["StepStone","Lightspeed","Y Combinator"],"blurb":"10-minute grocery delivery; IPO on hold, raised a pre-IPO round instead.","base_price":64.0,"aliases":["Kiranakart","KiranaKart Technologies"],"ipo_watch":false},{"id":"cred","name":"CRED","sector":"Fintech","hq":"Bengaluru","founded":2018,"valuation_usd":6400000000,"funding_usd":1000000000,"investors":["Peak XV","Ribbit Capital","Tiger Global"],"blurb":"Members-only credit card bill payments and commerce club.","base_price":91.0,"aliases":["Dreamplug Technologies"],"ipo_watch":false},{"id":"dream11","name":"Dream11","sector":"Gaming","hq":"Mumbai","founded":2008,"valuation_usd":8000000000,"funding_usd":1620000000,"investors":["Tiger Global","Steadview","TPG"],"blurb":"Fantasy sports giant navigating India's real-money gaming reset.","base_price":114.0,"aliases":["Sporta Technologies"],"ipo_watch":false},{"id":"oyo","name":"OYO","sector":"Hospitality","hq":"Gurugram","founded":2012,"valuation_usd":2400000000,"funding_usd":3200000000,"investors":["SoftBank","Lightspeed","Airbnb"],"blurb":"Budget hotel and homes network; long-running IPO ambitions.","base_price":34.0,"aliases":["Oravel Stays","Prism"],"ipo_watch":false},{"id":"acko","name":"Acko","sector":"Insurtech","hq":"Bengaluru","founded":2016,"valuation_usd":1400000000,"funding_usd":450000000,"investors":["General Atlantic","Munich Re","Amazon"],"blurb":"Digital-first general insurer for motor, health and embedded cover.","base_price":20.0,"aliases":["Acko General Insurance"],"ipo_watch":false},{"id":"boat","name":"boAt","sector":"Consumer electronics","hq":"Mumbai","founded":2016,"valuation_usd":1300000000,"funding_usd":170000000,"investors":["Warburg Pincus","Malabar","Fireside"],"blurb":"Audio and wearables brand; IPO deferred despite SEBI approval.","base_price":18.5,"aliases":["Imagine Marketing"],"ipo_watch":false},{"id":"ofbusiness","name":"OfBusiness","sector":"B2B commerce","hq":"Gurugram","founded":2015,"valuation_usd":5000000000,"funding_usd":880000000,"investors":["Tiger Global","SoftBank","Falcon Edge"],"blurb":"Raw-material commerce and SME financing (Oxyzo); DRHP expected soon.","base_price":71.0,"aliases":["OFB Tech"],"ipo_watch":false},{"id":"zoho","name":"Zoho","sector":"SaaS","hq":"Chennai","founded":1996,"valuation_usd":0,"funding_usd":0,"investors":["Bootstrapped"],"blurb":"Profitable bootstrapped business-software suite used worldwide.","base_price":100.0,"aliases":["Zoho Corporation"],"ipo_watch":false},{"id":"udaan","name":"Udaan","sector":"B2B commerce","hq":"Bengaluru","founded":2016,"valuation_usd":1800000000,"funding_usd":1950000000,"investors":["Lightspeed","DST Global","Tencent"],"blurb":"B2B marketplace connecting manufacturers, wholesalers and retailers.","base_price":26.0,"aliases":["Hiveloop Technology"],"ipo_watch":false},{"id":"sharechat","name":"ShareChat","sector":"Social media","hq":"Bengaluru","founded":2015,"valuation_usd":2000000000,"funding_usd":1700000000,"investors":["Tiger Global","Snap","Twitter"],"blurb":"Regional-language social network behind Moj short video.","base_price":28.5,"aliases":["Mohalla Tech"],"ipo_watch":false},{"id":"rapido","name":"Rapido","sector":"Mobility","hq":"Bengaluru","founded":2015,"valuation_usd":1100000000,"funding_usd":430000000,"investors":["WestBridge","Nexus","Swiggy"],"blurb":"Bike-taxi and auto ride-hailing challenger to Ola and Uber.","base_price":15.7,"aliases":["Roppen Transportation","Roppen Transportation Services"],"ipo_watch":false},{"id":"bharatpe","name":"BharatPe","sector":"Fintech","hq":"New Delhi","founded":2018,"valuation_usd":2850000000,"funding_usd":680000000,"investors":["Peak XV","Tiger Global","Coatue"],"blurb":"Merchant payments and lending network built on UPI QR.","base_price":40.5,"aliases":["Resilient Innovations"],"ipo_watch":false},{"id":"cars24","name":"CARS24","sector":"Auto tech","hq":"Gurugram","founded":2015,"valuation_usd":1300000000,"funding_usd":1400000000,"investors":["DST Global","SoftBank","Alpha Wave"],"blurb":"Used-car buying, selling and financing platform.","base_price":18.5,"aliases":["Global Cars24","CARS24 Services"],"ipo_watch":false},{"id":"cardekho","name":"CarDekho","sector":"Auto tech","hq":"Jaipur","founded":2008,"valuation_usd":750000000,"funding_usd":690000000,"investors":["Peak XV","Google","Hillhouse"],"blurb":"Car discovery marketplace with insurance and finance arms.","base_price":10.7,"aliases":["Girnar Software"],"ipo_watch":false},{"id":"unacademy","name":"Unacademy","sector":"Edtech","hq":"Bengaluru","founded":2015,"valuation_usd":3400000000,"funding_usd":880000000,"investors":["SoftBank","General Atlantic","Peak XV"],"blurb":"Online learning platform spanning test prep to upskilling.","base_price":48.5,"aliases":["Sorting Hat Technologies"],"ipo_watch":false},{"id":"upgrad","name":"upGrad","sector":"Edtech","hq":"Mumbai","founded":2015,"valuation_usd":2250000000,"funding_usd":600000000,"investors":["Temasek","Bodhi Tree"],"blurb":"Higher-education and skilling degrees with university partners.","base_price":32.0,"aliases":["upGrad Education"],"ipo_watch":false},{"id":"eruditus","name":"Eruditus","sector":"Edtech","hq":"Mumbai","founded":2010,"valuation_usd":3200000000,"funding_usd":1600000000,"investors":["SoftBank","Accel","CPP Investments"],"blurb":"Executive education with global university partners (Emeritus).","base_price":45.5,"aliases":["Eruditus Executive Education"],"ipo_watch":false},{"id":"cultfit","name":"Cult.fit","sector":"Fitness","hq":"Bengaluru","founded":2016,"valuation_usd":650000000,"funding_usd":640000000,"investors":["Zomato","Tata Digital","Accel"],"blurb":"Fitness centres, at-home workouts and healthy food under cure.fit.","base_price":9.3,"aliases":["cure.fit","Curefit Healthcare"],"ipo_watch":false},{"id":"porter","name":"Porter","sector":"Logistics","hq":"Bengaluru","founded":2014,"valuation_usd":1000000000,"funding_usd":300000000,"investors":["Tiger Global","Peak XV","Vitruvian"],"blurb":"Intra-city mini-truck and two-wheeler logistics marketplace.","base_price":14.3,"aliases":["Resfeber Labs","SmartShift Logistics Solutions"],"ipo_watch":false},{"id":"xpressbees","name":"Xpressbees","sector":"Logistics","hq":"Pune","founded":2015,"valuation_usd":1400000000,"funding_usd":590000000,"investors":["Blackstone","TPG","ChrysCapital"],"blurb":"E-commerce delivery network covering thousands of pin codes.","base_price":20.0,"aliases":["Busybees Logistics","Busybees Logistics Solutions"],"ipo_watch":false},{"id":"elasticrun","name":"ElasticRun","sector":"B2B commerce","hq":"Pune","founded":2016,"valuation_usd":1500000000,"funding_usd":440000000,"investors":["SoftBank","Prosus","Chimera"],"blurb":"Rural distribution network reaching kirana stores across India.","base_price":21.5,"aliases":["NTex Transportation","Ntex Transportation Services"],"ipo_watch":false},{"id":"atomberg","name":"Atomberg","sector":"Consumer appliances","hq":"Mumbai","founded":2012,"valuation_usd":500000000,"funding_usd":130000000,"investors":["Temasek","Steadview","Jungle"],"blurb":"Energy-efficient BLDC fans and home appliances; SEBI observations received.","base_price":7.1,"aliases":["Atomberg Technologies"],"ipo_watch":false},{"id":"healthifyme","name":"HealthifyMe","sector":"Healthtech","hq":"Bengaluru","founded":2012,"valuation_usd":600000000,"funding_usd":200000000,"investors":["LeapFrog","Khosla","Unilever Ventures"],"blurb":"AI-powered nutrition and fitness coaching app.","base_price":8.6,"aliases":["HealthifyMe Wellness"],"ipo_watch":false},{"id":"kukufm","name":"Kuku FM","sector":"Media","hq":"Mumbai","founded":2018,"valuation_usd":550000000,"funding_usd":120000000,"investors":["Krafton","Vertex","3one4"],"blurb":"Hindi and regional-language audio shows and audiobooks.","base_price":7.9,"aliases":["Mebigo Labs","Kuku Technologies"],"ipo_watch":false},{"id":"jar","name":"Jar","sector":"Fintech","hq":"Bengaluru","founded":2021,"valuation_usd":300000000,"funding_usd":60000000,"investors":["Tiger Global","Arkam"],"blurb":"Micro-savings app that rounds up spare change into digital gold.","base_price":4.3,"aliases":["ChangeJar Technologies"],"ipo_watch":false},{"id":"darwinbox","name":"Darwinbox","sector":"SaaS","hq":"Hyderabad","founded":2015,"valuation_usd":1000000000,"funding_usd":190000000,"investors":["Salesforce Ventures","Peak XV","Lightspeed"],"blurb":"Cloud HR platform for large enterprises.","base_price":14.3,"aliases":["Darwinbox Digital Solutions"],"ipo_watch":false},{"id":"jupiter","name":"Jupiter","sector":"Fintech","hq":"Mumbai","founded":2019,"valuation_usd":710000000,"funding_usd":160000000,"investors":["Tiger Global","Peak XV","Matrix"],"blurb":"Neobanking app for savings, payments and money insights.","base_price":10.1,"aliases":["Amica Financial","Amica Financial Technologies"],"ipo_watch":false},{"id":"zeta","name":"Zeta","sector":"Fintech","hq":"Bengaluru","founded":2015,"valuation_usd":2000000000,"funding_usd":390000000,"investors":["SoftBank Vision Fund 2","Mastercard","Optum"],"blurb":"Banking-tech platform powering card issuing and core banking for lenders like HDFC Bank; valued at $2 Bn after Optum's 2025 strategic round. Indian parent entity verified as Better World Technologies Pvt Ltd.","base_price":28.6,"aliases":["Better World Technologies","Better World Technologies Private Limited"],"ipo_watch":false},{"id":"moengage","name":"MoEngage","sector":"SaaS","hq":"Bengaluru","founded":2014,"valuation_usd":900000000,"funding_usd":307000000,"investors":["Goldman Sachs Alternatives","ChrysCapital","B Capital","A91 Partners"],"blurb":"Customer engagement and analytics platform; reverse-flipped to India through an NCLT-approved merger into MoEngage India Pvt Ltd (Jan 2026) ahead of a planned domestic IPO.","base_price":12.9,"aliases":["MoEngage India","MoEngage India Private Limited"],"ipo_watch":true}]};
const SEED_GRADUATED = {"updated":"2026-11-14","note":"Startups that graduated from the tracker by listing on NSE/BSE. Dates are listing dates where verified, otherwise approximate month.","graduated":[{"name":"Zetwerk","sector":"B2B manufacturing","listed":"Oct 2026","detail":"Listed on NSE/BSE at Rs 151, up ~23% on debut."},{"name":"Shiprocket","sector":"Logistics","listed":"Jul 2026","detail":"E-commerce shipping aggregator listed mid-2026."},{"name":"Fractal Analytics","sector":"AI / Analytics","listed":"2026","detail":"Enterprise AI firm listed in 2026; trading below issue price."},{"name":"Amagi","sector":"Media SaaS","listed":"Jan 2026","detail":"First major new-age listing of 2026."},{"name":"Shadowfax","sector":"Logistics","listed":"2026","detail":"Last-mile delivery platform listed in 2026."},{"name":"Meesho","sector":"E-commerce","listed":"Dec 2025","detail":"Listed 10 Dec 2025; closed 53% above issue price on debut."},{"name":"Lenskart","sector":"Retail / Eyewear","listed":"Nov 2025","detail":"Listed on NSE and BSE in November 2025."},{"name":"Pine Labs","sector":"Fintech","listed":"Nov 2025","detail":"Listed at ~$2.9 Bn valuation, below its private peak."},{"name":"Groww","sector":"Fintech","listed":"Nov 2025","detail":"Retail investing platform listed in November 2025."},{"name":"Urban Company","sector":"Home services","listed":"Sep 2025","detail":"Debuted ~62% above issue price."},{"name":"PhysicsWallah","sector":"Edtech","listed":"Sep 2025","detail":"Listed in September 2025."},{"name":"Ather Energy","sector":"EV","listed":"May 2025","detail":"Electric scooter maker listed in May 2025."},{"name":"Ola Electric","sector":"EV","listed":"Aug 2024","detail":"Listed on 9 Aug 2024."},{"name":"Swiggy","sector":"Food delivery","listed":"Nov 2024","detail":"Listed on 13 Nov 2024."},{"name":"Zomato","sector":"Food delivery","listed":"Jul 2021","detail":"First major Indian startup listing of the modern era."},{"name":"Paytm","sector":"Fintech","listed":"Nov 2021","detail":"One97 Communications listed in November 2021."},{"name":"Nykaa","sector":"E-commerce","listed":"Nov 2021","detail":"FSN E-Commerce listed in November 2021."},{"name":"Policybazaar","sector":"Insurtech","listed":"Nov 2021","detail":"PB Fintech listed in November 2021."},{"name":"Delhivery","sector":"Logistics","listed":"May 2022","detail":"Listed in May 2022."}]};
const SEED_ELIGIBILITY = {"updated":"2026-11-14","note":"Positive issuer-level evidence that each tracked company is unlisted, with dated sources. Re-verified each updater run against exchange masters; this file is the affirmative case.","evidence":{"flipkart":{"name":"Flipkart","claim":"IPO deferred to 2028 or later - still private","source":"https://economictimes.indiatimes.com/tech/startups","evidence_date":"Nov 2026"},"phonepe":{"name":"PhonePe","claim":"Traded as unlisted/pre-IPO shares; IPO paused Mar 2026","source":"https://www.planify.in/research-report/phonepe/","evidence_date":"Nov 2026"},"zerodha":{"name":"Zerodha","claim":"Traded as unlisted shares; no IPO ever filed","source":"https://www.planify.in/research-report/zerodha/","evidence_date":"Nov 2026"},"razorpay":{"name":"Razorpay","claim":"Traded as unlisted shares; SEBI IPO nod Nov 2026, listing targeted Q1 2027","source":"https://www.planify.in/research-report/razorpay/","evidence_date":"Nov 2026"},"zepto":{"name":"Zepto","claim":"Confidential DRHP reported, IPO shelved per ET - still private","source":"https://economictimes.indiatimes.com/tech/startups","evidence_date":"Nov 2026"},"cred":{"name":"CRED","claim":"Traded as unlisted/pre-IPO shares","source":"https://www.planify.in/research-report/cred/","evidence_date":"Nov 2026"},"dream11":{"name":"Dream11","claim":"Dream Sports tracked on unlisted-markets platform","source":"https://www.prosperainsights.in/unlisted-markets/dream11-dream-sports","evidence_date":"Nov 2026"},"oyo":{"name":"OYO","claim":"Parent Prism (ex-Oravel Stays) filed UDRHP Jun 2026 - pre-IPO","source":"https://www.livemint.com/market/ipo/oyo-ipo-parent-prism-files-updated-drhp-for-6-650-crore-public-issue-11782793572171.html","evidence_date":"Jun 2026"},"acko":{"name":"Acko","claim":"Pre-IPO: appointed independent directors ahead of IPO, DRHP targeted","source":"https://www.moneycontrol.com/news/business/startup/acko-waited-two-years-for-growth-visibility-appointed-independent-directors-well-before-ipo-founder-varun-dua-14040140.html","evidence_date":"Sep 2026"},"boat":{"name":"boAt","claim":"Issuer Imagine Marketing refiled DRHP Oct 2025 - pre-IPO","source":"https://www.goldmansachs.com/worldwide/india/ipo/imagine-marketing-limited/download","evidence_date":"Oct 2025"},"ofbusiness":{"name":"OfBusiness","claim":"Traded as unlisted shares; DRHP filed ~Nov 2026","source":"https://www.planify.in/research-report/ofbusiness/","evidence_date":"Nov 2026"},"zoho":{"name":"Zoho","claim":"CEO: IPO unlikely soon, focus on R&D","source":"https://www.business-standard.com/companies/news/zoho-ipo-delay-arattai-success-bharat-projects-125092900810_1.html","evidence_date":"Sep 2025"},"udaan":{"name":"Udaan","claim":"Targets IPO by early 2028 - still private","source":"https://www.business-standard.com/companies/news/b2b-ecom-platform-udaan-targets-ipo-by-early-2028-as-turnaround-takes-hold-126101100549_1.html","evidence_date":"Oct 2026"},"sharechat":{"name":"ShareChat","claim":"Traded as unlisted/pre-IPO shares","source":"https://www.planify.in/research-report/sharechat/","evidence_date":"Nov 2026"},"rapido":{"name":"Rapido","claim":"Co-founder: not chasing IPO timeline","source":"https://www.newindianexpress.com/business/2026/Jun/15/well-capitalised-not-chasing-ipo-timeline-rapido-co-founder-aravind-sanka","evidence_date":"Jun 2026"},"bharatpe":{"name":"BharatPe","claim":"Traded as unlisted/pre-IPO shares","source":"https://www.planify.in/research-report/bharatpe/","evidence_date":"Nov 2026"},"cars24":{"name":"CARS24","claim":"Traded as unlisted shares; inc42 IPO tracker: yet to file","source":"https://www.planify.in/research-report/cars24/","evidence_date":"Nov 2026"},"cardekho":{"name":"CarDekho","claim":"inc42 IPO tracker: yet to file","source":"https://inc42.com/features/indian-startup-ipo-tracker/","evidence_date":"Nov 2026"},"unacademy":{"name":"Unacademy","claim":"Tracked as private company on secondary-market platforms","source":"https://quantlogix.ai/private-company/unacademy","evidence_date":"Nov 2026"},"upgrad":{"name":"upGrad","claim":"Traded as unlisted/pre-IPO shares","source":"https://www.planify.in/research-report/upgrad/","evidence_date":"Nov 2026"},"eruditus":{"name":"Eruditus","claim":"Tracked on private secondary-market platforms","source":"https://notice.co/c/eruditus","evidence_date":"Nov 2026"},"cultfit":{"name":"Cult.fit","claim":"inc42 IPO tracker: yet to file","source":"https://inc42.com/features/indian-startup-ipo-tracker/","evidence_date":"Nov 2026"},"porter":{"name":"Porter","claim":"Traded as unlisted/pre-IPO shares","source":"https://www.planify.in/research-report/porter/","evidence_date":"Nov 2026"},"xpressbees":{"name":"Xpressbees","claim":"Traded as unlisted/pre-IPO shares","source":"https://www.planify.in/research-report/xpressbees/","evidence_date":"Nov 2026"},"elasticrun":{"name":"ElasticRun","claim":"Issuer NTex Transportation tracked on Moneycontrol unlisted-shares (ISIN-tagged)","source":"https://www.moneycontrol.com/markets/unlisted-shares/elasticrun-ntex-transportation-services-share-price-INE0AGE01019/","evidence_date":"Nov 2026"},"atomberg":{"name":"Atomberg","claim":"DRHP filed with SEBI (Atomberg Technologies Ltd, CIN U72900MH2012PLC229...) - pre-IPO","source":"https://www.sebi.gov.in/sebi_data/attachdocs/aug-2026/1787809930622.pdf","evidence_date":"Aug 2026"},"healthifyme":{"name":"HealthifyMe","claim":"Traded as unlisted/pre-IPO shares","source":"https://www.planify.in/research-report/healthifyme/","evidence_date":"Nov 2026"},"kukufm":{"name":"Kuku FM","claim":"Parent Kuku Technologies got SEBI nod for IPO, listing eyed 2027 - pre-IPO","source":"https://indianstartupnews.com/news/kuku-fm-parent-gets-sebi-nod-for-rs-3500-crore-ipo-eyes-stock-market-listing-in-2027-12548372","evidence_date":"Sep 2026"},"jar":{"name":"Jar","claim":"Raised fresh private funding Sep 2026 - still private","source":"https://entrackr.com/exclusive/exclusive-jar-raises-small-fresh-funding-from-unitary-fund-12547515","evidence_date":"Sep 2026"},"darwinbox":{"name":"Darwinbox","claim":"Weighing buyout interest amid IPO plans - still private","source":"https://www.hindustantimes.com/business/microsoft-rivals-eye-buyout-of-hr-firm-darwinbox-101787047269601.html","evidence_date":"Aug 2026"},"jupiter":{"name":"Jupiter","claim":"Traded as unlisted/pre-IPO shares","source":"https://www.planify.in/research-report/jupiter/","evidence_date":"Nov 2026"},"zeta":{"name":"Zeta","claim":"Private: raised $50 Mn from Optum at a $2 Bn valuation (Feb 2025), no IPO filed; Indian parent entity verified as Better World Technologies Pvt Ltd (FY24 financials covered by YourStory)","source":"https://techcrunch.com/2025/02/10/zeta-valued-at-2b-in-new-funding/","evidence_date":"Nov 2026"},"moengage":{"name":"MoEngage","claim":"Private: $280 Mn Series F (Dec 2025) at ~$900 Mn; reverse-merged into MoEngage India Private Limited (NCLT order 12 Jan 2026); no formal IPO process started, listing expected 2027-28","source":"https://inc42.com/buzz/ipo-bound-moengage-gets-nclt-nod-for-reverse-merger/","evidence_date":"Nov 2026"}}};
const SEED_PENDING = {"updated":"2026-11-14","note":"Companies reviewed against the India-domicile rule and NOT tracked. status=pending: domicile unresolved (quarantined). status=excluded: research resolved them as not headquartered/primarily operated in India today.","items":[{"name":"Postman","status":"excluded","pending_reason":"Resolved 2026-11-14: official site states 'headquartered in San Francisco' (founded in Bangalore); parent Postman Inc (US). Postdot Technologies Pvt Ltd is the Indian subsidiary. Fails the India-HQ rule.","source":"https://www.postman.com/company/contact-us/"},{"name":"Icertis","status":"excluded","pending_reason":"Resolved 2026-11-14: headquartered in Bellevue, Washington (GlobalData, PitchBook, Wikipedia agree); Icertis Inc (US). Pune is the India office. Fails the India-HQ rule.","source":"https://www.globaldata.com/company-profile/icertis-inc/locations/"},{"name":"Innovaccer","status":"excluded","pending_reason":"Resolved 2026-11-14: headquartered in San Francisco (official ONC disclosure, 101 Mission Street); Innovaccer Inc (US SEC filer). Innovaccer Analytics Pvt Ltd (Noida) is the Indian subsidiary. Fails the India-HQ rule.","source":"https://innovaccer.com/onc-certification-file/onc-disclaimer-document.pdf"},{"name":"Chargebee","status":"excluded","pending_reason":"Resolved 2026-11-14: headquarters in California (Walnut/San Francisco); Chargebee Inc (US SEC filer). Chargebee Technologies Pvt Ltd (Chennai) is the R&D and operations centre. Fails the India-HQ rule.","source":"https://www.highperformr.ai/company/chargebee"},{"name":"BrowserStack","status":"pending","pending_reason":"Founded and operated from Mumbai (BrowserStack Software Pvt Ltd) but the holding entity is Irish (BrowserStack Limited); redomicile to India was reported started Jan 2025 (8-12 month process per The Arc) with no completion report found as of 2026-11-14. Quarantined until the Indian holding entity is confirmed.","source":"https://inc42.com/buzz/browserstack-begins-process-to-redomicile-its-holding-entity-to-india-report/"}]};
