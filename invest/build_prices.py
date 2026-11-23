#!/usr/bin/env python3
"""Add daily-close history for companies that do not have any yet.

    python3 invest/build_prices.py

Existing series are copied through untouched - the brief is explicit that past
daily history must not be rewritten, and portfolios are valued against it.
New companies get a deterministic walk over exactly the same dates as the
existing series, so every company's chart starts and ends on the same day.

The walk mirrors the worker's own buildSeries: a seeded pseudo-random path,
anchored near the company's base price, clamped to +/-6% a day.
"""
import hashlib, json, struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "frontend/public/invest/data"


def rng(*parts):
    """Deterministic stream of floats in [0,1) keyed on the parts.

    The block counter is what makes this a stream rather than a loop. Keying
    the refill on len(buf) instead meant every refill after the first hashed
    the same input, so the sequence repeated every four draws - and a repeating
    cycle of returns compounds, which sent one generated company to Sim 14,992.
    """
    seed = "|".join(str(p) for p in parts).encode()
    buf, i, block = b"", 0, 0

    def nxt():
        nonlocal buf, i, block
        if i + 8 > len(buf):
            buf = hashlib.sha256(seed + b"|" + str(block).encode()).digest()
            block += 1
            i = 0
        v = struct.unpack_from(">Q", buf, i)[0]
        i += 8
        return (v >> 11) / float(1 << 53)
    return nxt


def gauss(nxt):
    import math
    u = max(1e-9, nxt()); v = nxt()
    return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * v)


def main():
    startups = json.loads((ROOT / "invest/_startups_built.json").read_text(encoding="utf-8"))["startups"]
    prices = json.loads((DATA / "prices.json").read_text(encoding="utf-8"))
    series = prices["series"]

    # The date spine every series shares.
    spine = None
    for s in series.values():
        if s:
            spine = [p["d"] for p in s]
            break
    if not spine:
        raise SystemExit("no existing series to take the date spine from")

    added = 0
    for st in startups:
        sid = st["id"]
        if series.get(sid):
            continue                      # never touch an existing path
        nxt = rng(sid, "seed-v2")
        vol = 0.018 + nxt() * 0.014
        price = st["base_price"] / (1 + (nxt() * 0.16 - 0.08))
        out = []
        for d in spine:
            g = gauss(nxt)
            ret = max(-0.06, min(0.06, g * vol))
            price = max(1.0, price * (1 + ret))
            out.append({"d": d, "c": round(price, 2)})
        # A generated path should wander, not wander off. Anything this far
        # from the starting level means the random stream is broken rather than
        # the market being exciting.
        lo, hi = min(p["c"] for p in out), max(p["c"] for p in out)
        if hi > st["base_price"] * 4 or lo < st["base_price"] / 4:
            raise SystemExit(
                f"{sid}: generated path ran from {lo} to {hi} against a base of "
                f"{st['base_price']}. Check the random stream before shipping this.")
        series[sid] = out
        added += 1

    # Drop series for companies no longer tracked, so the file does not grow
    # forever. Their history is preserved in graduated.json's own record.
    tracked = {s["id"] for s in startups}
    dropped = [k for k in list(series) if k not in tracked]
    for k in dropped:
        del series[k]

    prices["series"] = series
    prices["note"] = ("Simulated prices for learning. Unlisted startups have no live market price; "
                      "the daily close is produced by the same engine that drives the live intraday "
                      "price, and past days are never rewritten.")
    (ROOT / "invest/_prices_built.json").write_text(json.dumps(prices, indent=1), encoding="utf-8")
    print(f"series: {len(series)} (added {added}, dropped {len(dropped)})")
    print(f"spine: {spine[0]} .. {spine[-1]} ({len(spine)} days)")
    if dropped:
        print("dropped:", ", ".join(sorted(dropped)))


if __name__ == "__main__":
    main()
