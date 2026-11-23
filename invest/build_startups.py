#!/usr/bin/env python3
"""Build the tracked-company dataset for India Investment.

    python3 invest/build_startups.py --candidates   # write candidates for checking
    python3 invest/build_startups.py --finalise listing_report.json

Rules this enforces, from the brief:
  * the existing company ids and their base prices never change, so nobody's
    portfolio breaks
  * no company and no number is invented: every added company and every
    valuation comes from the cited source file, and a company with no citable
    valuation gets a neutral default price and is marked
  * anything listed on NSE/BSE goes to graduated.json, not the tracked list
  * new starting prices land in Sim 100-1000
"""
import argparse, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "frontend/public/invest/data"
HERE = Path(__file__).resolve().parent

# Two tiers from the same publisher. Unicorns are quoted in USD billions,
# soonicorns in USD millions, and the soonicorn table prints ranges.
SOURCES = [
    {
        "file": HERE / "inc42_unicorns_2026-08-15.tsv",
        "name": "Inc42 Indian Unicorn Tracker",
        "url": "https://inc42.com/features/indian-unicorn-tracker-funding-investors-revenue-and-more/",
        "as_of": "2026-08-15",
        "unit": 1e9,
    },
    {
        "file": HERE / "inc42_soonicorn_placeholder",
        "name": "Inc42 Indian Soonicorn Tracker",
        "url": "https://inc42.com/features/indian-soonicorn-tracker-list-of-indias-unicorns-of-tomorrow/",
        "as_of": "2026-09-08",
        "unit": 1e6,
    },
]
SOURCES[1]["file"] = HERE / "inc42_soonicorns_2026-09-08.tsv"
SOURCE = SOURCES[0]

# Reasons a company cannot be in the tracked list that the NSE/BSE check cannot
# see for itself. Each one is a specific, checkable claim, not a guess.
HARD_EXCLUDE = {
    "5ire": "headquartered in Dubai, not India",
    "Fireflies AI": "headquartered in San Francisco, not India",
    "Hike": "the source lists its valuation as 'Shutdown'",
    "Blinkit": "wholly owned by Eternal Ltd, which is listed on NSE and BSE",
    "Freshworks": "listed on NASDAQ (FRSH)",
    "MakeMyTrip": "listed on NASDAQ (MMYT)",
    "ReNew Power": "listed on NASDAQ (RNW)",
}

# Name matches that are a different company with the same brand word. The check
# works on names, so a short generic brand will collide sooner or later; each
# entry here needs the specific reason it is not the same company, checked by
# hand against the exchange record.
NOT_THE_SAME_COMPANY = {
    "Leap": "NSE 'LEAP India Limited' (LEAPIND, listed 14-Aug-2026) is a pallet "
            "and logistics-equipment leasing company, not the Bengaluru "
            "study-abroad edtech of the same name.",
}

# Legal / alternate names, so the exchange check matches a company that lists
# under a name nobody uses in conversation.
LEGAL_NAMES = {
    "Paytm": ["One97 Communications"],
    "Policybazaar": ["PB Fintech"],
    "Nykaa": ["FSN E-Commerce Ventures"],
    "FirstCry": ["Brainbees Solutions"],
    "MapmyIndia": ["CE Info Systems"],
    "BlackBuck": ["Zinka Logistics Solutions"],
    "EaseMyTrip": ["Easy Trip Planners"],
    "IndiaMART": ["IndiaMART InterMESH"],
    "Info Edge": ["Info Edge (India)"],
    "MobiKwik": ["One MobiKwik Systems"],
    "Digit Insurance": ["Go Digit General Insurance", "Go Digit Infoworks Services"],
    "Dream Sports": ["Sporta Technologies", "Dream11"],
    "Eternal (Zomato)": ["Eternal", "Zomato"],
    "Ola": ["ANI Technologies"],
    "Ola Electric": ["Ola Electric Mobility"],
    "Ather Energy": ["Ather Energy"],
    "Zetwerk": ["Zetwerk Manufacturing Businesses"],
    "Travel Boutique Online": ["TBO Tek"],
    "Swiggy": ["Swiggy"],
    "Delhivery": ["Delhivery"],
    "Physics Wallah": ["PhysicsWallah", "PW"],
}

# The source names a company differently from the tracked list. Mapping these
# by hand stops the build adding a second entry for a company we already have:
# Inc42 lists the parent ("Dream Sports") where the site shows the product
# ("Dream11"), and spells Acko with its suffix. The existing id and display
# name win, because portfolios are keyed on the id.
SOURCE_NAME_TO_ID = {
    "Acko Insurance": "acko",
    "Dream Sports": "dream11",
    "Kuku FM": "kukufm",
}

# Inc42's sector words mapped onto the vocabulary the site already uses.
SECTOR_MAP = {
    "Health Tech": "Healthtech",
    "Healthtech": "Healthtech",
    "Web3": "Web3",
    "Fintech": "Fintech",
    "Enterprise Tech": "SaaS",
    "Enterprise Services": "B2B commerce",
    "Consumer Services": "Consumer services",
    "Clean Tech": "Cleantech",
    "Logistics": "Logistics",
    "Ecommerce": "E-commerce",
    "Edtech": "Edtech",
    "Media & Entertainment": "Media",
    "Travel Tech": "Travel",
    "Artificial Intelligence": "AI",
    "Real Estate Tech": "Real estate",
    "Foodtech": "Foodtech",
    "Spacetech": "Spacetech",
    "Enterprisetech": "SaaS",
    "Agritech": "Agritech",
    "Cleantech": "Cleantech",
    "Advanced Hardware & Technology": "Deep tech",
    "Consumer Services": "Consumer services",
}

SECTOR_LOOKUP = {k.strip().lower(): v for k, v in SECTOR_MAP.items()}

# A few companies sit in a more specific bucket than their source sector.
SECTOR_OVERRIDE = {
    "Acko Insurance": "Insurtech",
    "Digit Insurance": "Insurtech",
    "Cult.fit": "Fitness",
    "boAt": "Consumer electronics",
    "Mamaearth": "Consumer brands",
    "Drools": "Consumer brands",
    "Licious": "Foodtech",
    "Rebel Foods": "Foodtech",
    "Zepto": "Quick commerce",
    "BigBasket": "Quick commerce",
    "ShareChat": "Social media",
    "Verse Innovation": "Media",
    "Rapido": "Mobility",
    "Ola": "Mobility",
    "Porter": "Logistics",
    "CarDekho": "Auto tech",
    "Cars24": "Auto tech",
    "Spinny": "Auto tech",
    "Droom": "Auto tech",
    "OYO": "Hospitality",
    "Mobile Premier League": "Gaming",
    "Games24x7": "Gaming",
    "Dream Sports": "Gaming",
    "Udaan": "B2B commerce",
    "Moglix": "B2B commerce",
    "Jumbotail": "B2B commerce",
    "Infra.Market": "B2B commerce",
    "OfBusiness": "B2B commerce",
    "ElasticRun": "B2B commerce",
    "Ather Energy": "Mobility",
}

# Indian cities we accept as a headquarters. A company whose HQ string names
# none of these is not primarily operated in India, by the dataset's own
# eligibility note, and is dropped.
INDIAN_CITIES = [
    "Delhi NCR", "Bengaluru", "Mumbai", "Pune", "Chennai", "Hyderabad",
    "Ahmedabad", "Jaipur", "Kolkata", "Coimbatore", "Gandhinagar", "Mohali",
    "Gurugram", "Noida", "Kochi", "Indore", "Chandigarh",
]


def india_hq(raw):
    """The Indian city in an HQ string, or None.

    Several companies print a dual headquarters ("San Francisco / Bengaluru",
    "Mountain View/Mumbai"). Those are kept and shown under the Indian city,
    which is what the existing dataset already does for MoEngage. A string with
    no Indian city at all - "San Francisco", "Singapore" - returns None."""
    for city in INDIAN_CITIES:
        if city.lower() in (raw or "").lower():
            return city
    return None

DEFAULT_PRICE = 250.0   # neutral starting price when no valuation can be cited


def slug(name):
    s = name.lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = s.replace("&", " and ").replace(".", " ")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def parse_amount(text):
    """Turn a printed figure into a number, keeping the original string.

    The soonicorn table prints ranges ("400-500") and open ends ("200+"). A
    range becomes its midpoint - that is derived from what the page says, not
    invented - and the exact printed text is carried through to the company
    table so a reader can check it."""
    t = (text or "").strip().replace("+", "")
    if not t:
        return None
    if "-" in t:
        lo, _, hi = t.partition("-")
        try:
            return (float(lo) + float(hi)) / 2
        except ValueError:
            return None
    try:
        return float(t)
    except ValueError:
        return None


def read_source():
    rows = []
    for src in SOURCES:
        unit = src["unit"]
        for line in src["file"].read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.startswith("#") or line.startswith("name\t"):
                continue
            parts = line.split("\t")
            while len(parts) < 6:
                parts.append("")
            name, sector, hq, founded, val, fund = [p.strip() for p in parts[:6]]
            v = parse_amount(val)
            f = parse_amount(fund)
            rows.append({
                "name": name, "src_sector": sector, "hq": hq,
                "founded": int(founded) if founded.isdigit() else None,
                "valuation_usd": v * unit if v is not None else None,
                "valuation_reported": val or None,
                "funding_usd": f * unit if f is not None else None,
                "source": src,
            })
    # The unicorn tier wins if a company somehow appears in both.
    seen, out = set(), []
    for r in rows:
        k = r["name"].lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out


def price_from_valuation(val_usd):
    """Map a reported valuation onto the site's Sim-rupee scale.

    Square root, so a 36x bigger company is 6x the price rather than 36x; that
    keeps the whole list inside one readable band instead of three orders of
    magnitude. Clamped to the 100-1000 range the brief asks for."""
    bn = val_usd / 1e9
    p = 220.0 * (bn ** 0.5)
    return round(min(1000.0, max(100.0, p)), 2)


def build_candidates():
    existing = json.loads((DATA / "startups.json").read_text(encoding="utf-8"))
    keep = {s["id"]: s for s in existing["startups"]}
    by_name = {s["name"].lower(): s for s in existing["startups"]}

    cands, skipped = [], []
    for r in read_source():
        if r["name"] in HARD_EXCLUDE:
            skipped.append({"name": r["name"], "reason": HARD_EXCLUDE[r["name"]]})
            continue
        if not india_hq(r["hq"]):
            skipped.append({"name": r["name"], "reason": f"headquarters '{r['hq']}' names no Indian city"})
            continue
        sid = slug(r["name"])
        # Reuse the existing id when this is a company we already track.
        match = keep.get(SOURCE_NAME_TO_ID.get(r["name"], ""))
        if not match:
            match = by_name.get(r["name"].lower())
        if not match:
            for s in existing["startups"]:
                if slug(s["name"]) == sid or s["id"] == sid:
                    match = s
                    break
        cands.append({
            "id": match["id"] if match else sid,
            "name": match["name"] if match else r["name"],
            "aliases": (match.get("aliases") if match else []) or [],
            "legal_names": LEGAL_NAMES.get(r["name"], []),
            "_src": r,
            "_existing": bool(match),
        })
    return cands, skipped, keep


def cmd_candidates():
    cands, skipped, _ = build_candidates()
    out = ROOT / "invest/_candidates.json"
    # The checker only needs names; the rest carries a Path and is internal.
    slim = [{k: c[k] for k in ("id", "name", "aliases", "legal_names")} for c in cands]
    out.write_text(json.dumps(slim, indent=1), encoding="utf-8")
    print(f"{len(cands)} candidates -> {out}")
    print(f"{len(skipped)} excluded before the exchange check:")
    for s in skipped:
        print(f"  - {s['name']}: {s['reason']}")


def cmd_finalise(report_path):
    report = json.loads(Path(report_path).read_text(encoding="utf-8"))
    if not report["sources"]["nse_main"]["ok"]:
        sys.exit("NSE master was unreachable for the listing check: refusing to build")
    listed = {r["name"]: r["matched"] for r in report["listed"]}

    cands, skipped, keep = build_candidates()
    existing = json.loads((DATA / "startups.json").read_text(encoding="utf-8"))
    old_by_id = {s["id"]: s for s in existing["startups"]}

    startups, graduated_new, table = [], [], []
    unmapped = set()
    overridden = []
    for c in cands:
        r = c["_src"]
        if c["name"] in listed and c["name"] in NOT_THE_SAME_COMPANY:
            overridden.append({"name": c["name"], "reason": NOT_THE_SAME_COMPANY[c["name"]]})
        elif c["name"] in listed:
            graduated_new.append({
                "id": c["id"], "name": c["name"],
                "matched": listed[c["name"]],
                "reason": "matched a listed-company name on " +
                          ", ".join(sorted({m["exchange"] for m in listed[c["name"]]})),
            })
            continue

        old = old_by_id.get(c["id"])
        # Case-insensitive: the two source pages capitalise sector names
        # differently ("Artificial Intelligence" vs "Artificial intelligence"),
        # which silently dropped five AI companies into "Other".
        sector = (SECTOR_OVERRIDE.get(r["name"])
                  or SECTOR_LOOKUP.get(r["src_sector"].strip().lower()))
        if not sector:
            unmapped.add(r["src_sector"])
            sector = "Other"
        has_val = r["valuation_usd"] is not None

        if old:
            # Existing company: id, name and price are frozen.
            base = old["base_price"]
            basis = old.get("price_basis", "legacy")
        elif has_val:
            base = price_from_valuation(r["valuation_usd"])
            basis = "valuation"
        else:
            base = DEFAULT_PRICE
            basis = "default"

        entry = {
            "id": c["id"],
            "name": c["name"],
            "sector": sector,
            "hq": india_hq(r["hq"]),
            "founded": r["founded"],
            "valuation_usd": int(r["valuation_usd"]) if has_val else None,
            "funding_usd": int(r["funding_usd"]) if r["funding_usd"] is not None else None,
            "base_price": base,
            "price_basis": basis,
            "aliases": c["aliases"],
            "ipo_watch": bool(old and old.get("ipo_watch")),
        }
        if old:
            for k in ("investors", "blurb", "ipo_watch"):
                if old.get(k):
                    entry[k] = old[k]
        if has_val:
            entry["valuation_source"] = r["source"]["url"]
            entry["valuation_as_of"] = r["source"]["as_of"]
            entry["valuation_source_name"] = r["source"]["name"]
            if r.get("valuation_reported"):
                entry["valuation_reported"] = r["valuation_reported"]
        else:
            entry["valuation_source"] = None
            entry["valuation_note"] = "No valuation we can cite; starting price is a neutral default."
        startups.append(entry)
        table.append(entry)

    # Any company we already tracked that the source does not mention stays put.
    have = {s["id"] for s in startups}
    for s in existing["startups"]:
        if s["id"] not in have and s["name"] not in listed:
            s.setdefault("price_basis", "legacy")
            s.setdefault("valuation_source", None)
            startups.append(s)
            table.append(s)

    startups.sort(key=lambda s: s["name"].lower())

    payload = {
        "updated": None,
        "note": existing["note"],
        "sources": [{k: v for k, v in s.items() if k != "file"} for s in SOURCES],
        "startups": startups,
    }
    (ROOT / "invest/_startups_built.json").write_text(json.dumps(payload, indent=1), encoding="utf-8")

    print(f"tracked: {len(startups)}")
    print(f"sent to graduated: {len(graduated_new)}")
    for g in graduated_new:
        print(f"  - {g['name']}: {g['reason']}")
    if unmapped:
        print("WARNING: source sectors with no mapping, filed as Other: " + ", ".join(sorted(unmapped)))
    print(f"excluded before the check: {len(skipped)}")
    if overridden:
        print(f"name matches overruled as a different company: {len(overridden)}")
        for o in overridden:
            print(f"  - {o['name']}: {o['reason']}")
    cited = sum(1 for s in startups if s.get("valuation_source"))
    print(f"with a cited valuation: {cited}; on the neutral default: {len(startups) - cited}")
    (ROOT / "invest/_graduated_new.json").write_text(json.dumps(graduated_new, indent=1), encoding="utf-8")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", action="store_true")
    ap.add_argument("--finalise")
    a = ap.parse_args()
    if a.candidates:
        cmd_candidates()
    elif a.finalise:
        cmd_finalise(a.finalise)
    else:
        ap.print_help()
