#!/usr/bin/env node
/**
 * Build-time prerenderer for the SCALE static site.
 *
 * WHY THIS EXISTS
 * ---------------
 * The site is a Create React App single-page app. The file CRA ships,
 * build/index.html, has an empty <div id="root"></div> and one generic title.
 * A crawler that does not run JavaScript (and most AI assistants' fetchers do
 * not) sees a blank page with no headings, no copy and no facts. Google will
 * eventually render it, but slowly and unreliably, and every URL looks
 * identical to anything that only reads HTML.
 *
 * This script runs AFTER `craco build`. It reads the real content from the
 * backend API (the same endpoints the app itself calls), then writes one
 * static HTML file per public route. Each file keeps the exact same CRA
 * script/link tags as the original build, so the React app still boots and
 * takes over normally. The difference is that before JavaScript runs, the
 * HTML already contains the page's real headings and text, a unique <title>,
 * a unique meta description, a self-referencing canonical, Open Graph and
 * Twitter tags, and JSON-LD.
 *
 * Crawlers and users therefore get the same content - the prerendered HTML is
 * generated from the same API responses the app renders from, not a
 * crawler-only variant.
 *
 * WHAT IT WRITES
 * --------------
 *   build/index.html                      home (overwritten in place)
 *   build/courses/index.html              course listing
 *   build/courses/<slug>/index.html       one per published course
 *   build/events/<id>/index.html          one per event returned by the API
 *   build/login|signup|admin|...          noindex shells for private routes
 *   build/app-noindex.html               noindex shell used by Render rewrites
 *                                         for unenumerable routes
 *   build/404.html                        real not-found page (no app bundle)
 *   build/robots.txt
 *   build/sitemap.xml
 *   build/llms.txt
 *
 * CONTENT FRESHNESS
 * -----------------
 * Prerendered HTML is a snapshot taken at build time. Admin edits show up for
 * users immediately (the React app always fetches live data on load), but the
 * *first paint* and the crawler-visible HTML only change on the next deploy.
 * Worst case staleness for crawlers is therefore "until the next deploy".
 * Newly created events and courses need a redeploy before their URL exists as
 * a file; that is the same mechanism that makes deleted or hidden items
 * correctly stop resolving.
 *
 * FAILURE BEHAVIOUR
 * -----------------
 * Every fetch retries with long timeouts, because the backend is on a Render
 * free plan and a cold start can take 30-50 seconds. If the data still cannot
 * be read, the script exits non-zero so the Render build FAILS LOUDLY and the
 * previous good deploy stays live. It never publishes empty or
 * placeholder-only pages.
 */

const fs = require("fs");
const path = require("path");

const {
  SITE,
  ORG,
  ROUTES,
  EVENT_OVERRIDES,
  COURSE_OVERRIDES,
  NOINDEX_STATIC_ROUTES,
} = require("./seo-config");

const BUILD_DIR = path.resolve(__dirname, "..", "build");
const BACKEND =
  (process.env.PRERENDER_BACKEND_URL ||
    process.env.REACT_APP_BACKEND_URL ||
    "https://scale-india-backend.onrender.com").replace(/\/+$/, "");
const API = `${BACKEND}/api`;

// Render free plan cold starts can take 30-50s, so allow a long single-attempt
// timeout and several attempts before giving up.
const ATTEMPT_TIMEOUT_MS = 75000;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [3000, 8000, 15000, 25000];

/* ------------------------------------------------------------------ utils */

const log = (...a) => console.log("[prerender]", ...a);

function fail(message) {
  console.error("\n[prerender] FATAL:", message);
  console.error(
    "[prerender] Refusing to publish pages without real content. " +
      "Fix the backend or network and redeploy; the previous deploy stays live.\n"
  );
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      log(`  attempt ${attempt}/${MAX_ATTEMPTS} failed for ${url}: ${err.message}`);
      if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_MS[attempt - 1] || 25000);
    }
  }
  throw new Error(`could not fetch ${url}: ${lastErr && lastErr.message}`);
}

/** HTML-escape for text nodes and attribute values. */
function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Collapse whitespace and trim to a meta-description-sized string. */
function metaText(value, max = 158) {
  const flat = String(value || "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:\s]+$/, "")}...`;
}

/**
 * Drop strings that another string already contains, keeping the longest
 * version. Courses store a `subtitle` that is usually the opening sentence of
 * `description`; printing both reads like a stutter and hands crawlers
 * duplicate text, while printing only the subtitle would throw away the extra
 * sentence the description adds.
 */
function dedupeTexts(values) {
  const cleaned = values
    .map((v) => String(v || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const kept = [];
  for (const value of cleaned) {
    const needle = value.toLowerCase();
    if (!kept.some((k) => k.toLowerCase().includes(needle))) kept.push(value);
  }
  return kept;
}

/** Render a multi-line string as separate <p> elements. */
function paragraphs(value, className = "") {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p${className ? ` class="${className}"` : ""}>${esc(line)}</p>`)
    .join("\n");
}

function writeFileEnsured(relPath, contents) {
  const full = path.join(BUILD_DIR, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, "utf8");
  log(`  wrote ${relPath} (${(contents.length / 1024).toFixed(1)} kB)`);
}

/**
 * The pristine CRA shell: build/index.html exactly as webpack emitted it,
 * empty <div id="root"></div> and all.
 *
 * This script overwrites build/index.html with the prerendered home page, so a
 * second run (someone re-running `yarn prerender` without rebuilding) would
 * otherwise find an already-filled root and have nothing to work from. The
 * pristine copy is cached next to node_modules, OUTSIDE build/, so it is never
 * published. A fresh build always wins over the cache, which keeps the
 * hashed bundle filenames correct.
 */
function loadShell() {
  const buildIndex = path.join(BUILD_DIR, "index.html");
  const cachePath = path.resolve(__dirname, "..", ".prerender-shell.html");

  if (fs.existsSync(buildIndex)) {
    const fresh = fs.readFileSync(buildIndex, "utf8");
    if (/<div id="root">\s*<\/div>/.test(fresh)) {
      fs.writeFileSync(cachePath, fresh, "utf8");
      return fresh;
    }
  }

  if (fs.existsSync(cachePath)) {
    const cached = fs.readFileSync(cachePath, "utf8");
    if (/<div id="root">\s*<\/div>/.test(cached)) {
      log("build/index.html was already prerendered; reusing the cached shell.");
      return cached;
    }
  }

  fail(
    "could not find an unmodified build/index.html with an empty " +
      '<div id="root"></div>. Run `yarn build:spa-only` first.'
  );
  return "";
}

/* ------------------------------------------------------- html composition */

/**
 * Take the CRA-built index.html and produce a page with its own head tags and
 * (optionally) prerendered body content. The CRA <script>/<link> tags are left
 * untouched so the app still hydrates and behaves exactly as before.
 */
function composePage(template, opts) {
  const {
    title,
    description,
    canonicalPath,
    bodyHtml = "",
    jsonLd = [],
    noindex = false,
    ogType = "website",
  } = opts;

  let html = template;

  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
  html = html.replace(
    /<meta\s+name="description"[\s\S]*?\/?>/i,
    `<meta name="description" content="${esc(description)}"/>`
  );

  const canonicalUrl = canonicalPath ? `${SITE}${canonicalPath}` : null;
  const head = [];

  if (noindex) {
    head.push(`<meta name="robots" content="noindex,follow"/>`);
  } else {
    head.push(`<meta name="robots" content="index,follow,max-image-preview:large"/>`);
  }
  if (canonicalUrl) head.push(`<link rel="canonical" href="${esc(canonicalUrl)}"/>`);

  head.push(`<meta property="og:type" content="${esc(ogType)}"/>`);
  head.push(`<meta property="og:site_name" content="SCALE"/>`);
  head.push(`<meta property="og:title" content="${esc(title)}"/>`);
  head.push(`<meta property="og:description" content="${esc(description)}"/>`);
  if (canonicalUrl) head.push(`<meta property="og:url" content="${esc(canonicalUrl)}"/>`);
  head.push(`<meta property="og:image" content="${esc(ORG.logo)}"/>`);
  head.push(`<meta property="og:locale" content="en_IN"/>`);
  head.push(`<meta name="twitter:card" content="summary"/>`);
  head.push(`<meta name="twitter:title" content="${esc(title)}"/>`);
  head.push(`<meta name="twitter:description" content="${esc(description)}"/>`);
  head.push(`<meta name="twitter:image" content="${esc(ORG.logo)}"/>`);

  // Every indexable page carries the Organization and WebSite nodes so the
  // `@id` references used by the page-specific blocks below always resolve
  // within that one document. Validators flag dangling cross-page @ids.
  const graph = noindex ? [] : [identityGraph(), ...jsonLd];

  for (const block of graph) {
    // </script> inside a JSON string would end the script element early.
    const json = JSON.stringify(block).replace(/</g, "\\u003c");
    head.push(`<script type="application/ld+json">${json}</script>`);
  }

  if (bodyHtml) head.push(PRERENDER_STYLE);

  html = html.replace("</head>", `${head.join("\n    ")}\n  </head>`);

  if (bodyHtml) {
    html = html.replace(
      /<div id="root">\s*<\/div>/,
      `<div id="root">${bodyHtml}</div>`
    );
  }

  return html;
}

/**
 * Minimal inline styling for the prerendered markup.
 *
 * The prerendered content carries no Tailwind classes, so without this it
 * would paint as unstyled black-on-white text for the moment before the app
 * bundle takes over. This is the same content in both cases - only the
 * presentation of that brief first paint changes, so it is not cloaking.
 * Inline (not a separate file) so it costs no extra request.
 */
const PRERENDER_STYLE = `<style>
#root [data-prerender]{background:#3a0a10;color:#fff;font-family:'DM Sans',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  line-height:1.6;padding:24px 20px 56px;min-height:100vh;box-sizing:border-box}
#root [data-prerender] main{max-width:860px;margin:0 auto}
#root [data-prerender] nav{max-width:860px;margin:0 auto 40px;display:flex;flex-wrap:wrap;gap:18px;align-items:center;
  font-size:.85rem;letter-spacing:.08em;text-transform:uppercase}
#root [data-prerender] h1{font-family:'Playfair Display',Georgia,serif;font-size:2.1rem;line-height:1.15;margin:.2em 0 .4em}
#root [data-prerender] h2{font-family:'Playfair Display',Georgia,serif;font-size:1.4rem;margin:1.8em 0 .4em}
#root [data-prerender] h3{font-size:1.05rem;margin:1.2em 0 .2em}
#root [data-prerender] a{color:#e0b559;text-decoration:none}
#root [data-prerender] ul,#root [data-prerender] ol{padding-left:1.1em}
#root [data-prerender] li{margin:.35em 0}
#root [data-prerender] footer{max-width:860px;margin:56px auto 0;padding-top:20px;
  border-top:1px solid rgba(255,255,255,.18);font-size:.85rem;color:rgba(255,255,255,.65)}
#root [data-prerender] small{color:rgba(255,255,255,.45);font-size:.7rem}
</style>`;

/* ------------------------------------------------------------- JSON-LD */

const orgNode = {
  "@type": "Organization",
  "@id": `${SITE}/#organization`,
  name: ORG.name,
  legalName: ORG.legalName,
  alternateName: ORG.alternateName,
  url: ORG.url,
  logo: ORG.logo,
  email: ORG.email,
  description: ORG.description,
  sameAs: ORG.sameAs,
  areaServed: "IN",
};

/** The identity nodes repeated on every indexable page. */
function identityGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      orgNode,
      {
        "@type": "WebSite",
        "@id": `${SITE}/#website`,
        url: SITE,
        name: "SCALE",
        publisher: { "@id": `${SITE}/#organization` },
        inLanguage: "en",
      },
    ],
  };
}

function breadcrumb(trail) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${SITE}${item.path}`,
    })),
  };
}

/* ----------------------------------------------- shared chrome fragments */

function navHtml(content) {
  const links = [
    `<a href="/">Home</a>`,
    `<a href="/#about">What is SCALE</a>`,
    `<a href="/#events">Events</a>`,
    `<a href="/#contact">Contact</a>`,
  ];
  // Mirror the live nav: hidden pages are not linked for visitors.
  if (content.community_page_visible !== false) links.push(`<a href="/community">Community</a>`);
  if (content.courses_page_visible !== false) links.push(`<a href="/courses">Courses</a>`);
  return `<nav aria-label="Main"><a href="/">SCALE</a>${links.join("")}</nav>`;
}

function footerHtml(content) {
  return `<footer>
<p>SCALE ${esc(ORG.legalName ? `(${ORG.legalName})` : "")}</p>
${content.footer_tagline ? `<p>${esc(content.footer_tagline)}</p>` : ""}
<p>Contact: <a href="mailto:${esc(content.contact_email || ORG.email)}">${esc(
    content.contact_email || ORG.email
  )}</a></p>
${content.contact_instagram ? `<p>Instagram: ${esc(content.contact_instagram)}</p>` : ""}
</footer>`;
}

/* ------------------------------------------------------------ page bodies */

function homeBody(content, events, courses) {
  const pillars = (content.pillars || [])
    .map(
      (p) =>
        `<li><h3>${esc(p.title)}</h3><p>${esc(p.desc)}</p></li>`
    )
    .join("\n");

  const why = (content.why_scale_items || [])
    .map((w) => `<li><h3>${esc(w.title)}</h3><p>${esc(w.desc)}</p></li>`)
    .join("\n");

  const eventList = events
    .map(
      (ev) => `<li>
<h3><a href="/events/${esc(ev.id)}">${esc(ev.title)}</a></h3>
${ev.date ? `<p>${esc(ev.date)}</p>` : ""}
${ev.location ? `<p>${esc(ev.location)}</p>` : ""}
<p>${esc(ev.description)}</p>
<p>${Number(ev.price_inr) === 0 ? "Free to enter" : `Entry fee: ₹${esc(ev.price_inr)}`}</p>
${ev.registration_open === false ? `<p>${esc(ev.registration_closed_message || "Registration is closed.")}</p>` : ""}
</li>`
    )
    .join("\n");

  const courseList = courses
    .map(
      (c) =>
        `<li><h3><a href="/courses/${esc(c.slug)}">${esc(c.title)}</a></h3><p>${esc(
          c.subtitle || c.description || ""
        )}</p></li>`
    )
    .join("\n");

  return `<div data-prerender="1">
${navHtml(content)}
<main>
<section id="home">
${content.hero_label ? `<p>${esc(content.hero_label)}</p>` : ""}
<h1>${esc(content.hero_headline || "SCALE")}</h1>
${content.hero_subtext ? `<p>${esc(content.hero_subtext)}</p>` : ""}
${content.hero_ticker ? `<p>${esc(content.hero_ticker)}</p>` : ""}
</section>

<section id="about">
<h2>${esc(content.whatis_headline || "What is SCALE")}</h2>
${paragraphs(content.about_paragraph)}
</section>

${pillars ? `<section><h2>${esc(content.pillars_headline || "The SCALE experience")}</h2><ul>${pillars}</ul></section>` : ""}

${why ? `<section><h2>${esc(content.why_eyebrow || "Why SCALE")}</h2><ul>${why}</ul></section>` : ""}

<section id="events">
<h2>${esc(content.events_headline || "Events and sessions")}</h2>
${eventList ? `<ul>${eventList}</ul>` : ""}
${content.competitions_teaser ? `<p>${esc(content.competitions_teaser)}</p>` : ""}
</section>

${
  content.courses_page_visible !== false && courseList
    ? `<section>
<h2>${esc(content.courses_headline || "Free courses")}</h2>
${content.courses_about ? `<p>${esc(content.courses_about)}</p>` : ""}
<ul>${courseList}</ul>
<p><a href="/courses">See all SCALE courses</a></p>
</section>`
    : ""
}

<section id="contact">
<h2>${esc(content.contact_headline || "Contact")}</h2>
<p><a href="mailto:${esc(content.contact_email || ORG.email)}">${esc(
    content.contact_email || ORG.email
  )}</a></p>
</section>
</main>
${footerHtml(content)}
</div>`;
}

function coursesBody(content, courses) {
  const items = courses
    .map(
      (c) => `<li>
<h2><a href="/courses/${esc(c.slug)}">${esc(c.title)}</a></h2>
${dedupeTexts([c.subtitle, c.description]).map((t) => `<p>${esc(t)}</p>`).join("\n")}
<p>Free</p>
</li>`
    )
    .join("\n");

  return `<div data-prerender="1">
${navHtml(content)}
<main>
${content.courses_eyebrow ? `<p>${esc(content.courses_eyebrow)}</p>` : ""}
<h1>${esc(content.courses_headline || "SCALE courses")}</h1>
${paragraphs(content.courses_about)}
${items ? `<ul>${items}</ul>` : ""}
</main>
${footerHtml(content)}
</div>`;
}

function courseBody(content, course) {
  const lessons = (course.lessons || [])
    .map((l, i) => `<li>Lesson ${i + 1}: ${esc(l.title)}</li>`)
    .join("\n");

  return `<div data-prerender="1">
${navHtml(content)}
<main>
<p><a href="/courses">SCALE courses</a></p>
<h1>${esc(course.title)}</h1>
${dedupeTexts([course.subtitle, course.description]).map((t) => `<p>${esc(t)}</p>`).join("\n")}
<p>This course is free.</p>
${
  lessons
    ? `<section><h2>Lessons (${(course.lessons || []).length})</h2><ol>${lessons}</ol></section>`
    : ""
}
</main>
${footerHtml(content)}
</div>`;
}

function eventBody(content, ev) {
  const docs = ((ev.materials && ev.materials.documents) || [])
    .map((d) => `<li>${esc(d.label || d.filename)}</li>`)
    .join("\n");
  const links = ((ev.materials && ev.materials.links) || [])
    .map((l) => `<li><a href="${esc(l.url)}" rel="nofollow">${esc(l.label || l.url)}</a></li>`)
    .join("\n");
  const notes = (ev.materials && ev.materials.notes) || "";

  return `<div data-prerender="1">
${navHtml(content)}
<main>
<p><a href="/">SCALE</a></p>
<h1>${esc(ev.title)}</h1>
<p>${esc(ev.description)}</p>
<ul>
${ev.date ? `<li>${esc(ev.date)}</li>` : ""}
${ev.location ? `<li>${esc(ev.location)}</li>` : ""}
<li>${Number(ev.price_inr) === 0 ? "Free to enter" : `Entry fee: ₹${esc(ev.price_inr)}`}</li>
${ev.registration_mode ? `<li>Entry format: ${esc(ev.registration_mode)}</li>` : ""}
</ul>
${
  ev.registration_open === false
    ? `<p>${esc(ev.registration_closed_message || "Registration is closed.")}</p>`
    : ""
}
${
  ev.about
    ? `<section><h2>${esc(content.event_detail_about_label || "About this event")}</h2>${paragraphs(
        ev.about
      )}</section>`
    : ""
}
${
  ev.eligibility
    ? `<section><h2>${esc(
        content.event_detail_eligibility_label || "Eligibility"
      )}</h2>${paragraphs(ev.eligibility)}</section>`
    : ""
}
${ev.prize_pool ? `<section><h2>Prize Pool</h2>${paragraphs(ev.prize_pool)}</section>` : ""}
${
  docs || links || notes
    ? `<section><h2>Materials</h2>
${notes ? `<p>${esc(notes)}</p>` : ""}
${docs ? `<ul>${docs}</ul>` : ""}
${links ? `<ul>${links}</ul>` : ""}
</section>`
    : ""
}
${ev.disclaimer ? `<p><small>${esc(ev.disclaimer)}</small></p>` : ""}
</main>
${footerHtml(content)}
</div>`;
}

/* ------------------------------------------------------------------- main */

async function main() {
  const template = loadShell();

  log(`backend: ${API}`);

  let content;
  let events;
  let courses;
  try {
    [content, events, courses] = await Promise.all([
      fetchJson(`${API}/content`),
      fetchJson(`${API}/events`),
      fetchJson(`${API}/courses`),
    ]);
  } catch (err) {
    fail(err.message);
  }

  if (!content || typeof content !== "object" || !content.hero_headline) {
    fail("/api/content returned nothing usable (no hero_headline).");
  }
  if (!Array.isArray(events)) fail("/api/events did not return a list.");
  if (!Array.isArray(courses)) fail("/api/courses did not return a list.");

  // Course detail (lesson titles) comes from the per-slug endpoint, which also
  // enforces published=true, so an unpublished course cannot leak in here.
  const courseDetails = [];
  for (const c of courses) {
    try {
      courseDetails.push(await fetchJson(`${API}/courses/${encodeURIComponent(c.slug)}`));
    } catch (err) {
      fail(`course "${c.slug}" is listed but its detail endpoint failed: ${err.message}`);
    }
  }

  // Materials (rules packet, case files, submission link) live behind a
  // separate endpoint and are only readable without a registration when the
  // event is flagged public_materials. Fetch exactly what a visitor could see,
  // so the prerendered HTML never exposes anything gated.
  for (const ev of events) {
    if (!ev.public_materials) continue;
    try {
      ev.materials = await fetchJson(`${API}/events/${encodeURIComponent(ev.id)}/materials`);
    } catch (err) {
      // Supplementary, not load-bearing: the page still has title, about,
      // eligibility, dates and prizes without it.
      log(`  warning: materials for event ${ev.id} unavailable (${err.message})`);
    }
  }

  log(
    `fetched: ${events.length} event(s), ${courses.length} published course(s), content ok`
  );

  const sitemap = [];
  const addToSitemap = (loc, priority, changefreq) =>
    sitemap.push({ loc: `${SITE}${loc}`, priority, changefreq });

  /* ---------------------------------------------------------- home page */

  const homeMeta = ROUTES["/"];
  writeFileEnsured(
    "index.html",
    composePage(template, {
      title: homeMeta.title,
      description: homeMeta.description,
      canonicalPath: "/",
      bodyHtml: homeBody(content, events, courses),
      // Organization + WebSite are injected by composePage for every
      // indexable page, so the home page needs nothing extra.
      jsonLd: [],
    })
  );
  addToSitemap("/", "1.0", "weekly");

  /* ------------------------------------------------------ courses listing */

  if (content.courses_page_visible !== false) {
    const meta = ROUTES["/courses"];
    writeFileEnsured(
      "courses/index.html",
      composePage(template, {
        title: meta.title,
        description: meta.description,
        canonicalPath: "/courses",
        bodyHtml: coursesBody(content, courses),
        jsonLd: [
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: content.courses_headline || "SCALE courses",
            url: `${SITE}/courses`,
            isPartOf: { "@id": `${SITE}/#website` },
            publisher: { "@id": `${SITE}/#organization` },
            inLanguage: "en",
          },
          breadcrumb([
            { name: "Home", path: "/" },
            { name: "Courses", path: "/courses" },
          ]),
        ],
      })
    );
    addToSitemap("/courses", "0.8", "monthly");

    /* -------------------------------------------------- course detail pages */

    for (const course of courseDetails) {
      const override = COURSE_OVERRIDES[course.slug] || {};
      const title = override.title || `${course.title} | Free Course | SCALE`;
      const description =
        override.description || metaText(course.description || course.subtitle);
      const url = `${SITE}/courses/${course.slug}`;

      writeFileEnsured(
        `courses/${course.slug}/index.html`,
        composePage(template, {
          title,
          description,
          canonicalPath: `/courses/${course.slug}`,
          ogType: "article",
          bodyHtml: courseBody(content, course),
          jsonLd: [
            {
              "@context": "https://schema.org",
              "@type": "Course",
              name: course.title,
              description: metaText(course.description || course.subtitle, 300),
              url,
              inLanguage: "en",
              isAccessibleForFree: true,
              provider: { "@id": `${SITE}/#organization` },
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "INR",
                category: "Free",
                availability: "https://schema.org/InStock",
                url,
              },
              hasCourseInstance: {
                "@type": "CourseInstance",
                courseMode: "online",
                courseWorkload: `PT${Math.max(1, (course.lessons || []).length)}H`,
              },
            },
            breadcrumb([
              { name: "Home", path: "/" },
              { name: "Courses", path: "/courses" },
              { name: course.title, path: `/courses/${course.slug}` },
            ]),
          ],
        })
      );
      addToSitemap(`/courses/${course.slug}`, "0.8", "monthly");
    }
  } else {
    log("  courses page is hidden in admin settings: skipping /courses prerender");
  }

  /* ----------------------------------------------------------- event pages */

  for (const ev of events) {
    const override = EVENT_OVERRIDES[ev.id] || {};
    const title = override.title || `${ev.title} | SCALE`;
    const description = override.description || metaText(ev.description || ev.about);
    const canonicalPath = `/events/${ev.id}`;

    writeFileEnsured(
      `events/${ev.id}/index.html`,
      composePage(template, {
        title,
        description,
        canonicalPath,
        ogType: "article",
        bodyHtml: eventBody(content, ev),
        jsonLd: [
          {
            // Deliberately WebPage, not Event: the only date published is a
            // Round 1 submission deadline, which is not a startDate or an
            // endDate, and inventing one would be wrong. No eligibility
            // claim is encoded in markup either.
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: ev.title,
            description: metaText(ev.description || ev.about, 300),
            url: `${SITE}${canonicalPath}`,
            isPartOf: { "@id": `${SITE}/#website` },
            publisher: { "@id": `${SITE}/#organization` },
            about: { "@id": `${SITE}/#organization` },
            inLanguage: "en",
          },
          breadcrumb([
            { name: "Home", path: "/" },
            { name: ev.title, path: canonicalPath },
          ]),
        ],
      })
    );
    addToSitemap(canonicalPath, "0.9", "weekly");
  }

  /* --------------------------------------------- noindex shells + 404 page */

  // A neutral copy of the app shell: boots the SPA exactly as before, but
  // carries noindex so private/flow routes stay out of search results.
  const noindexShell = composePage(template, {
    title: "SCALE",
    description: "SCALE: Society of Commerce, Analytics, Leadership and Entrepreneurship.",
    canonicalPath: null,
    noindex: true,
  });
  writeFileEnsured("app-noindex.html", noindexShell);
  for (const route of NOINDEX_STATIC_ROUTES) {
    writeFileEnsured(`${route.replace(/^\//, "")}/index.html`, noindexShell);
  }

  // Render serves build/404.html with a real 404 status for paths that match
  // no file and no route rule. It intentionally does NOT load the app bundle:
  // the SPA has no catch-all route, so booting it here would blank the page.
  writeFileEnsured(
    "404.html",
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <meta name="robots" content="noindex,follow"/>
    <title>Page not found | SCALE</title>
    <style>
      body{margin:0;background:#0a0a0a;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
           display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}
      h1{font-size:1.6rem;margin:0 0 12px}
      p{color:rgba(255,255,255,.7);margin:0 0 20px}
      a{color:#c8a24a;text-decoration:none;font-weight:600}
      ul{list-style:none;padding:0;display:flex;gap:18px;justify-content:center;flex-wrap:wrap}
    </style>
  </head>
  <body>
    <main>
      <h1>Page not found</h1>
      <p>This page does not exist, or it is no longer available.</p>
      <ul>
        <li><a href="/">Home</a></li>
        <li><a href="/courses">Courses</a></li>
        <li><a href="/#events">Events</a></li>
      </ul>
    </main>
  </body>
</html>
`
  );

  /* ------------------------------------------------------------ robots.txt */

  // No rules are added or removed for AI training crawlers (GPTBot,
  // ClaudeBot, Google-Extended and similar): the site has never had any, and
  // that policy is left exactly as it was.
  //
  // Private routes are NOT disallowed here on purpose. They rely on
  // <meta name="robots" content="noindex">, and a disallowed URL is never
  // fetched, so its noindex tag would never be read.
  writeFileEnsured(
    "robots.txt",
    `# SCALE - https://www.scale-national.com
User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`
  );

  /* ----------------------------------------------------------- sitemap.xml */

  const today = new Date().toISOString().slice(0, 10);
  writeFileEnsured(
    "sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemap
  .map(
    (u) => `  <url>
    <loc>${esc(u.loc)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>
`
  );

  /* -------------------------------------------------------------- llms.txt */

  const eventLines = events
    .map(
      (ev) =>
        `- [${ev.title}](${SITE}/events/${ev.id}): ${metaText(ev.description, 200)}${
          Number(ev.price_inr) === 0 ? " Free to enter." : ""
        }`
    )
    .join("\n");
  const courseLines = courses
    .map(
      (c) =>
        `- [${c.title}](${SITE}/courses/${c.slug}): ${metaText(
          c.description || c.subtitle,
          200
        )} Free.`
    )
    .join("\n");

  writeFileEnsured(
    "llms.txt",
    `# SCALE

> SCALE (Society of Commerce, Analytics, Leadership and Entrepreneurship) is a student organisation in India. It runs business case competitions, expert sessions and free online courses in business, finance and leadership for school students.

Contact: ${content.contact_email || ORG.email}
Instagram: ${content.contact_instagram || "@scale.national"}

## Competitions and events

${eventLines || "- No events are currently listed."}

## Free courses

${courseLines || "- No courses are currently listed."}

## Notes

- Course and competition entry is free unless a fee is stated on the page itself.
- Competition materials, deadlines and rules live on the event page linked above; treat that page as the source of truth.
- Case materials are published for educational use only and are not affiliated with or endorsed by any company referenced in them.
`
  );

  log(`done. ${sitemap.length} URL(s) in sitemap.`);
}

// Only run when invoked directly, so the page builders above can be required
// and exercised from a test without kicking off a real build.
if (require.main === module) {
  main().catch((err) => fail(err && err.stack ? err.stack : String(err)));
}

module.exports = { composePage, homeBody, coursesBody, courseBody, eventBody, dedupeTexts };
