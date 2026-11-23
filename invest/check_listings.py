#!/usr/bin/env python3
"""Check candidate companies against the live exchange masters.

    python3 invest/check_listings.py candidates.json

Mirrors the rule the data worker already uses: normalise the name, strip
corporate suffixes, and look for an exact match against

  * the NSE main-board listed-company master
  * the NSE SME master
  * the BSE daily bhavcopy (most recent available date)

A match means the company has listed and belongs in graduated.json, not in the
tracked list.

Known coverage gaps, unchanged from AUDIT.md:
  * the NSE SME master file is served nearly empty (one row), so SME listings
    are effectively unchecked
  * the BSE bhavcopy only carries scrips that traded that day, so a suspended
    BSE-only scrip can be missed
  * listings on foreign exchanges are not covered at all
"""
import csv, io, json, re, sys, urllib.request
from datetime import date, timedelta

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")
NSE_EQ = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv"
NSE_SME = "https://nsearchives.nseindia.com/content/equities/SME_EQUITY_L.csv"
BSE = "https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_{}_F_0000.CSV"

SUFFIXES = set(("limited ltd private pvt technologies technology tech solutions services "
                "india ventures holdings holding corporation corp inc software labs global "
                "group enterprises international company co").split())


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def norm(s):
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def strip_suffix(name):
    toks = norm(name).split()
    while len(toks) > 1 and toks[-1] in SUFFIXES:
        toks.pop()
    return " ".join(toks)


def keys(name):
    """Match keys for one name.

    Two forms, because spacing around digits is not consistent between
    registries: NSE carries Paytm as "One 97 Communications Limited" while
    everyone writes "One97", and matching on the spaced form alone let a listed
    company through as unlisted. The space-free key catches that pair.
    """
    base = strip_suffix(name)
    if not base:
        return set()
    return {base, base.replace(" ", "")}


def nse_names(url):
    txt = fetch(url)
    out = set()
    for row in csv.DictReader(io.StringIO(txt)):
        n = (row.get("NAME OF COMPANY") or "").strip()
        if n:
            out |= keys(n)
    return out


def bse_names():
    """Walk back from today to the most recent published bhavcopy."""
    for back in range(0, 8):
        d = (date.today() - timedelta(days=back)).strftime("%Y%m%d")
        try:
            txt = fetch(BSE.format(d))
        except Exception:
            continue
        out = set()
        for row in csv.DictReader(io.StringIO(txt)):
            n = (row.get("FinInstrmNm") or "").strip()
            if n:
                out |= keys(n)
        if out:
            return out, d
    return set(), None


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: check_listings.py candidates.json")
    cands = json.load(open(sys.argv[1], encoding="utf-8"))
    if isinstance(cands, dict):
        cands = cands.get("startups") or cands.get("candidates") or []

    report = {"sources": {}, "listed": [], "clear": []}

    try:
        eq = nse_names(NSE_EQ)
        report["sources"]["nse_main"] = {"ok": True, "rows": len(eq)}
    except Exception as e:
        eq = set(); report["sources"]["nse_main"] = {"ok": False, "error": str(e)}
    try:
        sme = nse_names(NSE_SME)
        report["sources"]["nse_sme"] = {"ok": True, "rows": len(sme),
                                       "note": "served nearly empty; SME effectively unchecked" if len(sme) < 50 else ""}
    except Exception as e:
        sme = set(); report["sources"]["nse_sme"] = {"ok": False, "error": str(e)}
    bse, bse_date = bse_names()
    report["sources"]["bse_bhavcopy"] = {"ok": bool(bse), "rows": len(bse), "date": bse_date}

    # Fail closed: without the NSE main master there is no meaningful check.
    if not eq:
        report["verdict"] = "ABORT: NSE main master unreachable, cannot verify anything"
        print(json.dumps(report, indent=2))
        sys.exit(2)

    for c in cands:
        names = [c["name"]] + list(c.get("aliases") or []) + list(c.get("legal_names") or [])
        hits = []
        for n in names:
            ks = keys(n)
            if not ks:
                continue
            if ks & eq:
                hits.append(("NSE", n))
            if ks & sme:
                hits.append(("NSE SME", n))
            if ks & bse:
                hits.append(("BSE", n))
        row = {"id": c.get("id"), "name": c["name"]}
        if hits:
            row["matched"] = [{"exchange": e, "as": n} for e, n in hits]
            report["listed"].append(row)
        else:
            report["clear"].append(row)

    report["verdict"] = f"{len(report['clear'])} clear, {len(report['listed'])} appear listed"
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
