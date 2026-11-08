/**
 * Single source of truth for everything the prerenderer needs to know that is
 * NOT already in the backend data: the canonical host, the organisation
 * identity block, and the per-page <title> / meta description wording.
 *
 * IMPORTANT (process rule): every string in TITLES / DESCRIPTIONS / ORG below
 * is *proposed copy pending approval*. It is listed verbatim in
 * SEO-PROPOSED-COPY.md at the repo root so it can be reviewed before this
 * branch is merged or deployed. Nothing here is live until that happens.
 *
 * Facts used here are limited to the verified list: SCALE = Society of
 * Commerce, Analytics, Leadership and Entrepreneurship; contact
 * scalesupportteam2@gmail.com; Instagram @scale.national; the case competition
 * is free, individual-only, online, Lenskart FY26 case, Round 1 deck deadline
 * 20 January 2027, top 10 pitch live in Round 2, prize pool 15,000 rupees;
 * the Personal Finance course is free. No superlatives, no comparative claims,
 * no invented dates, partners or rankings.
 */

const SITE = "https://www.scale-national.com";

// Must stay in sync with frontend/src/lib/brand.js (LOGO_URL). Social
// previews and schema.org `logo` both want a raster image at an absolute URL;
// the local /scale-logo.svg is used as the favicon only, because most social
// platforms will not render an SVG preview.
const LOGO_URL =
  "https://customer-assets.emergentagent.com/job_scale-talent-network/artifacts/olf8hf08_ChatGPT%20Image%20May%202%2C%202026%2C%2008_44_41%20PM.png";

const ORG = {
  name: "SCALE",
  legalName: "Society of Commerce, Analytics, Leadership and Entrepreneurship",
  alternateName: "Society of Commerce, Analytics, Leadership and Entrepreneurship",
  url: SITE,
  logo: LOGO_URL,
  email: "scalesupportteam2@gmail.com",
  sameAs: ["https://www.instagram.com/scale.national/"],
  // Factual, non-comparative. Used for the Organization JSON-LD description.
  description:
    "SCALE (Society of Commerce, Analytics, Leadership and Entrepreneurship) is a student organisation in India that runs business case competitions, expert sessions and free online courses for school students.",
};

/** Fixed-route metadata. Keys are URL paths. */
const ROUTES = {
  "/": {
    title: "SCALE | Business Case Competitions for Students in India",
    description:
      "SCALE runs business case competitions, expert sessions and free online courses in business, finance and leadership for school students in India.",
  },
  "/courses": {
    title: "Free Online Courses for School Students | SCALE",
    description:
      "Free, self-paced SCALE courses for school students. Each lesson has a video, slides, a written summary and a quiz. No fees and no paid upgrades.",
  },
};

/**
 * Per-record metadata overrides, keyed by event id or course slug. Anything
 * not listed here falls back to a formula built from the backend's own
 * title/description fields, so new events and courses still get sane,
 * non-duplicated metadata without a code change.
 */
const EVENT_OVERRIDES = {
  "67365362-6e51-4339-b5e1-0e1e2468d710": {
    title: "SCALE Business Case Competition | Free Online Case Competition",
    description:
      "A free online business case competition for school students in India. Solve the Lenskart FY26 case on your own; Round 1 decks are due 20 January 2027.",
  },
};

const COURSE_OVERRIDES = {
  "personal-finance-money-decisions": {
    title: "Personal Finance & Money Decisions | Free Course | SCALE",
    description:
      "A free SCALE course on managing money: budgeting, banking and UPI, earning and taxes, debt, insurance, scams, and building a personal financial plan.",
  },
};

/**
 * Routes that exist for logged-in users or payment flows. They are prerendered
 * (or rewritten) to a shell carrying <meta name="robots" content="noindex">.
 *
 * Deliberately NOT blocked in robots.txt: a URL that is disallowed in
 * robots.txt can never be crawled, so its noindex tag is never read, and the
 * URL can still surface as a bare link in search results. Blocking and
 * noindexing the same URL is self-defeating, so we noindex only.
 */
const NOINDEX_STATIC_ROUTES = [
  "/login",
  "/signup",
  "/admin",
  "/payment-success",
  // Hidden in admin settings today: non-admins are redirected to the home
  // page, so these must not be indexed and must not appear in the sitemap.
  // The URLs keep working for signed-in admins.
  "/community",
  "/our-team",
];

module.exports = {
  SITE,
  LOGO_URL,
  ORG,
  ROUTES,
  EVENT_OVERRIDES,
  COURSE_OVERRIDES,
  NOINDEX_STATIC_ROUTES,
};
