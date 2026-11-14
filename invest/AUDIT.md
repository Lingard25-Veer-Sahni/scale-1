# Eligibility audit - "Indian unlisted startups only"

Audit date: **2026-11-14** (data snapshot). Sources checked programmatically and manually; results below.

## The eligibility rule

A company is tracked only if ALL of these hold:

1. **Founded in India** and **headquartered / primarily operated in India** today.
2. **Not listed on any stock exchange anywhere** (NSE, BSE, or foreign).
3. Its shares cannot be bought on a public exchange.

Edge case kept: **Flipkart** and **PhonePe** are majority-owned by Walmart (NYSE-listed) but are not themselves listed on any exchange and are Indian-operated. They stay tracked because the tracker's rule is about the startup's own listing, and they are the canonical "unlisted" examples. If the owner wants strict independence from listed parents, these two move to `data/pending.json`.

## Removal (graduation) rule

- A startup leaves the tracker **only** on an exact, suffix-stripped match of its name, legal-entity name, or alias against any of:
  - the **NSE mainboard equity master** (`EQUITY_L.csv`, 2,629 names on 2026-11-14) - primary source;
  - the **NSE SME (Emerge) master** (`SME_EQUITY_L.csv`, updated daily by NSE; held 1 name on 2026-11-14 - see limits);
  - the **BSE equity bhavcopy** (4,905 traded names, 2026-11-13).
- Every tracked company carries its registered legal-entity name in `aliases` (e.g. boAt = Imagine Marketing, OYO = Oravel Stays / Prism, Jar = ChangeJar Technologies, Zepto = KiranaKart Technologies), so a listing under the legal issuer name is caught, not only the brand name.
- A news report of a completed listing **never** removes a company on its own. It creates an entry in `data/review.json` for a human to verify (covers name changes and the gap between listing day and master-file updates).
- **Fail-closed:** if the NSE mainboard master is unreachable, that run makes **no** eligibility changes at all. A failed SME or BSE source still blocks nothing but is flagged in `exchange_check`, and the site shows a "listing check incomplete" warning chip instead of the verified chip - companies stay tracked but are not presented as fully verified.
- Substring matching is never used (it false-positives, e.g. neobank *Jupiter* vs listed *Jupiter Wagons*).

## Two-sided verification, 2026-11-14

**Positive evidence (inclusion):** every tracked company carries dated, issuer-level evidence that it is unlisted - see `data/eligibility.json`. Types: unlisted/pre-IPO share-market pages (Planify, Moneycontrol unlisted, Prospera, Notice), live IPO-process status (DRHP filed / SEBI nod with future listing target - by definition pre-listing), fresh private funding, or founder statements against an IPO timeline. Companies whose only evidence was absence-of-match were moved to `data/pending.json`.

**Negative check (exclusion):** all seeds are additionally checked each updater run against the NSE mainboard master, NSE SME master and BSE daily bhavcopy with exact suffix-stripped brand + legal-entity matching. Zero matches on the audit date.

## Manual news evidence (sampled, 2026-11-14)

- Razorpay: SEBI IPO approval reported ~Nov 2026, listing targeted Q1 2027 - still unlisted today (ET Tech).
- Zepto: IPO shelved per ET; confidential DRHP reported - still unlisted.
- Flipkart: IPO deferred to 2028 or later per ET - still unlisted.
- PhonePe: IPO paused March 2026 per ET - still unlisted.
- boAt: IPO deferred despite SEBI approval per ET - still unlisted.
- Meesho (not in seed): listed Dec 2025 - correctly excluded from the universe.
- Shiprocket, Zetwerk, Amagi, Shadowfax etc. (not in seed): listed during 2026 per Inc42/Venture Intelligence trackers - correctly excluded.

## Domicile research (`data/pending.json`, not tracked)

Resolved 2026-11-14 with free public sources (official sites, NCLT/court coverage, company-profile databases):

- **Postman** - EXCLUDED: official site states "headquartered in San Francisco" (founded in Bangalore); parent Postman Inc (US). Postdot Technologies Pvt Ltd is the Indian subsidiary.
- **Icertis** - EXCLUDED: headquartered in Bellevue, Washington (GlobalData, PitchBook, Wikipedia agree); Icertis Inc (US). Pune is the India office.
- **Innovaccer** - EXCLUDED: headquartered in San Francisco (official ONC disclosure); Innovaccer Inc (US SEC filer). Innovaccer Analytics Pvt Ltd (Noida) is the Indian subsidiary.
- **Chargebee** - EXCLUDED: headquarters in California (Walnut / San Francisco); Chargebee Inc (US SEC filer). Chargebee Technologies Pvt Ltd (Chennai) is the R&D and operations centre.
- **MoEngage** - RESOLVED, NOW TRACKED: NCLT Bengaluru sanctioned the merger of MoEngage Inc (Delaware) into **MoEngage India Private Limited** on 12 Jan 2026; the US entity ceases to exist. Still private ($280 Mn Series F Dec 2025 at ~$900 Mn; no formal IPO process, listing expected 2027-28). Added to the tracked set with its legal entity name in aliases.
- **BrowserStack** - STILL PENDING (quarantined): founded and operated from Mumbai (BrowserStack Software Pvt Ltd), but the holding entity is Irish (BrowserStack Limited). A redomicile to India was reported started Jan 2025 (8-12 months per The Arc) with no completion report found as of 2026-11-14. Stays out until the Indian holding entity is confirmed.

**Zeta** legal-entity verification (previously open): the Indian parent entity is **Better World Technologies Private Limited** (FY24 financials covered by YourStory, Nov 2024). Zeta is private (last round $50 Mn from Optum at a $2 Bn valuation, Feb 2025) and is tracked with that legal name in aliases, so a listing under the issuer name is caught.

## Known limits

- The BSE bhavcopy is a *traded-names* file, not a full master of suspended scrips; a BSE-listed company that stopped trading could be missed. BSE publishes no free full scrip master over plain HTTPS (its scrip-master endpoints return bot-walls). A BSE-only-listed company that never trades could be missed; the news review queue and the positive-evidence file are the mitigation, and this residual gap is stated on the site rather than hidden.
- The NSE SME master file was nearly empty (1 company) on the audit date despite NSE's daily-update note; treat SME coverage as weak until the file repopulates. No tracked company is an SME candidate.
- Foreign listings are covered by the news review queue plus manual audit rather than a machine source; none of the 33 has any reported foreign listing as of the audit date.
- News feeds are best-effort, not exhaustive.
- Valuations are last publicly reported figures and may be stale.
