"""Hero figure data: whale allocation vs number of wallets under several launch mechanisms,
and sandwich-bot profit on a plain CP pool vs the Clinch batch.

Launch setting: supply S of a new token, quote asset Y. 30 honest bidders + 1 whale.
Mechanisms
  clinch        fixed-supply adaptive clinching (this build)
  uniform       single-batch uniform-price clearing, no caps (CCA-like, one block)
  uniform_cap   same with a per-wallet cap on tokens
  fixed_cap     fixed price, per-wallet cap, pro-rata if oversubscribed (typical IDO)
Whale strategies: split budget evenly across N wallets with the true limit ("naive split"),
and for clinch also a random-search best split ("adversarial split").
"""
import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from clinch.engine import INF, CPPool, cp_chord_target, fixed_target, run, two_sided, net_flows  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "results"
rng = random.Random(7)

S = 1000.0
P_RES = 1.0
HONEST = [(rng.uniform(1.2, 3.0), rng.uniform(20, 80)) for _ in range(30)]  # (limit, budget in Y)
WV, WQ = 2.5, 1500.0  # whale value, budget
CAP_TOKENS = 40.0
FIXED_P = 1.5
NS = [1, 2, 5, 10, 20, 50, 100]


def uniform_clear(bids, supply, cap=None):
    """Uniform-price clearing with budget bids: demand_i(p) = budget/p for p <= limit (capped)."""
    def demand(p):
        d = []
        for v, q in bids:
            di = q / p if p <= v else 0.0
            if cap is not None:
                di = min(di, cap)
            d.append(di)
        return d
    lo, hi = P_RES, 1e6
    if sum(demand(lo)) <= supply:
        return lo, demand(lo)
    for _ in range(200):
        mid = math.sqrt(lo * hi)
        if sum(demand(mid)) > supply:
            lo = mid
        else:
            hi = mid
    p = hi
    d = demand(p)
    # ration the marginal bids at p_lo (those with limit in [hi, lo]) - at hi demand <= supply; fill leftover pro-rata
    dl = demand(lo)
    left = supply - sum(d)
    extra = [max(0.0, a - b) for a, b in zip(dl, d)]
    se = sum(extra)
    if se > 0 and left > 0:
        d = [a + left * e / se for a, e in zip(d, extra)]
    return p, d


def fixed_cap_sale(bids, supply, price, cap):
    d = [min(q / price, cap) if v >= price else 0.0 for v, q in bids]
    tot = sum(d)
    if tot > supply:
        d = [x * supply / tot for x in d]
    return price, d


def whale_outcome(mech, N, split=None):
    if split is None:
        split = [(WV, WQ / N)] * N
    bids = split + HONEST
    k = len(split)
    if mech == "clinch":
        r = run(bids, fixed_target(S), P_RES, 1e-3, fixed_supply=True)
        x, y = sum(r.x[:k]), sum(r.y[:k])
    elif mech in ("uniform", "uniform_cap"):
        p, d = uniform_clear(bids, S, CAP_TOKENS if mech == "uniform_cap" else None)
        x = sum(d[:k]); y = x * p
    elif mech == "fixed_cap":
        p, d = fixed_cap_sale(bids, S, FIXED_P, CAP_TOKENS)
        x = sum(d[:k]); y = x * p
    return x, y, WV * x - y


def best_clinch_split(N, iters=300):
    best = None
    for _ in range(iters):
        w = [rng.random() for _ in range(N)]
        sw = sum(w)
        split = [(WV * rng.choice([1.0, rng.uniform(1.0, 2.0), rng.uniform(0.5, 1.0)]), WQ * wi / sw) for wi in w]
        o = whale_outcome("clinch", N, split)
        if best is None or o[2] > best[2]:
            best = o
    return best


def sandwich_plain(pool: CPPool, victim_y: float, slip: float):
    """Victim swaps victim_y Y->X with min-out = (1-slip)*quote. Bot picks front-run size to max profit (in Y)."""
    quote = pool.Cinv(victim_y)
    min_out = (1 - slip) * quote
    best = (0.0, 0.0)
    lo, hi = 0.0, pool.y0 * 5
    for _ in range(200):
        f = (lo + hi) / 2
        x0, y0 = pool.x0, pool.y0
        bx = x0 * f / (y0 + f); x1, y1 = x0 - bx, y0 + f
        vx = x1 * victim_y / (y1 + victim_y)
        if vx >= min_out:
            lo = f
        else:
            hi = f
    f = lo
    x0, y0 = pool.x0, pool.y0
    bx = x0 * f / (y0 + f); x1, y1 = x0 - bx, y0 + f
    vx = x1 * victim_y / (y1 + victim_y); x2, y2 = x1 - vx, y1 + victim_y
    back_y = y2 * bx / (x2 + bx)
    return back_y - f, f


if __name__ == "__main__":
    table = {}
    for mech in ["clinch", "uniform", "uniform_cap", "fixed_cap"]:
        table[mech] = []
        for N in NS:
            x, y, u = whale_outcome(mech, N)
            table[mech].append({"N": N, "share": x / S, "x": x, "paid": y, "util": u})
    table["clinch_adversarial"] = []
    for N in NS:
        x, y, u = best_clinch_split(N) if N > 1 else whale_outcome("clinch", 1)
        table["clinch_adversarial"].append({"N": N, "share": x / S, "x": x, "paid": y, "util": u})
    print("whale share of supply / utility by wallets N")
    print("mech                 " + "".join(f"N={n:<11}" for n in NS))
    for m, rows in table.items():
        print(f"{m:20s} " + "".join(f"{r['share']:.3f}/{r['util']:<7.0f}" for r in rows))

    # sandwich
    pool = CPPool(10_000.0, 10_000.0)
    sw = []
    for vy, slip in [(100, 0.005), (100, 0.01), (500, 0.01), (500, 0.03), (1000, 0.05)]:
        prof, f = sandwich_plain(pool, vy, slip)
        # Clinch batch: victim bids with limit = spot*(1+slip); bot tries both directions (exhaustive grid)
        best = -INF
        p0 = pool.p0
        for fy in [0, 10, 100, 1000, 5000]:
            for fx in [0, 10, 100, 1000, 5000]:
                for vb in [p0 * 1.0001, p0 * 1.01, p0 * 1.1, INF]:
                    for ub in [0.0, p0 * 0.9, p0 * 0.9999]:
                        sy = ([(vb, fy)] if fy else []) + [(p0 * (1 + slip), vy)]
                        sx = ([(ub, fx)] if fx else [])
                        res = two_sided(pool, sy, sx, 1e-3)
                        dX, dY = net_flows(res, range(1 if fy else 0), range(1 if fx else 0))
                        # bot P&L marked at spot (in Y); positive only matters if not offset
                        pnl_spot = dY + p0 * dX
                        free = (dX >= -1e-9 and dY >= -1e-9 and (dX > 1e-9 or dY > 1e-9))
                        best = max(best, (1.0 if free else 0.0) * max(dX * p0, dY) + (0 if free else -0.0))
        sw.append({"victim_y": vy, "slip": slip, "plain_profit_Y": prof, "frontrun_Y": f, "clinch_free_lunch_Y": best})
        print(f"victim {vy:>5} slip {slip:.3f}: plain-pool sandwich profit {prof:8.3f} Y  | clinch free lunch {best:.3e}")
    OUT.mkdir(exist_ok=True)
    (OUT / "baselines.json").write_text(json.dumps({"whale": table, "sandwich": sw,
                                                    "setup": {"S": S, "honest": HONEST, "whale": [WV, WQ],
                                                              "cap": CAP_TOKENS, "fixed_price": FIXED_P}}, indent=1))
