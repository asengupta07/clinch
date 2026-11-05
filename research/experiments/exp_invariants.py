"""Props 1, 2, 3, 4b, 6: conservation, exact settlement, order independence,
equal-value split invariance, individual rationality. Also prices vs spot (eq. 59)."""
import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from clinch.engine import CPPool, INF, cp_chord_target, fixed_target, run, two_sided  # noqa: E402
from clinch.gen import rand_instance  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "results"
N = int(sys.argv[1]) if len(sys.argv) > 1 else 400
EPS = 1e-3
rng = random.Random(1)

worst = {
    "fixed_overalloc": 0.0, "budget_violation": 0.0, "ir_violation": 0.0,
    "settle_gap_neg": 0.0, "settle_gap_pos_rel": 0.0, "order_diff": 0.0,
    "price_below_spot": 0.0, "twosided_settle_rel": 0.0,
    "twosided_price_violation": 0.0,
}

for t in range(N):
    inst = rand_instance(rng, nY=rng.randint(1, 10), nX=0)
    pool, bids = inst.pool, inst.sellY

    # ---- fixed supply (launch)
    S0 = pool.x0 * rng.uniform(0.01, 0.5)
    fb = [(min(v, pool.p0 * 50), q) for v, q in bids]  # finite limits (see finding: launch needs cap)
    r = run(fb, fixed_target(S0), pool.p0, EPS, fixed_supply=True)
    worst["fixed_overalloc"] = max(worst["fixed_overalloc"], (sum(r.x) - S0) / S0)
    for (v, q), xi, yi in zip(fb, r.x, r.y):
        worst["budget_violation"] = max(worst["budget_violation"], (yi - q) / max(q, 1e-12))
        if xi > 0:
            worst["ir_violation"] = max(worst["ir_violation"], (yi / xi - v) / v)

    # ---- AMM one-sided
    T = cp_chord_target(pool)
    r = run(bids, T, pool.p0, EPS)
    gap = r.Y - pool.C(r.X)
    worst["settle_gap_neg"] = max(worst["settle_gap_neg"], -gap / max(r.Y, 1e-12))
    worst["settle_gap_pos_rel"] = max(worst["settle_gap_pos_rel"], gap / max(r.Y, 1e-12))
    for (v, q), xi, yi in zip(bids, r.x, r.y):
        worst["budget_violation"] = max(worst["budget_violation"], (yi - q) / max(q, 1e-12))
        if xi > 0:
            worst["ir_violation"] = max(worst["ir_violation"], (yi / xi - v) / v)
            worst["price_below_spot"] = max(worst["price_below_spot"], (pool.p0 - yi / xi) / pool.p0)

    # order independence
    perm = list(range(len(bids)))
    rng.shuffle(perm)
    r2 = run([bids[i] for i in perm], T, pool.p0, EPS)
    for j, i in enumerate(perm):
        d = abs(r2.x[j] - r.x[i]) / max(r.X, 1e-12)
        worst["order_diff"] = max(worst["order_diff"], d)

    # equal-value split: split bid 0 into k identities with the same limit
    k = rng.randint(2, 8)
    v0, q0 = bids[0]
    w = [rng.random() for _ in range(k)]
    sw = sum(w)
    split = [(v0, q0 * wi / sw) for wi in w] + bids[1:]
    r3 = run(split, T, pool.p0, EPS)
    xs, ys = sum(r3.x[:k]), sum(r3.y[:k])
    if v0 >= pool.p0:
        # utility gain of splitting (should be <= 0): allocations may differ, utility may not rise
        gain = ((v0 * xs - ys) - (v0 * r.x[0] - r.y[0])) / q0
        worst["split_gain"] = max(worst.get("split_gain", -INF), gain)
        worst["split_alloc_diff"] = max(worst.get("split_alloc_diff", 0.0), abs(xs - r.x[0]) / max(r.X, 1e-12))

    # ---- two-sided
    inst2 = rand_instance(rng, nY=rng.randint(1, 6), nX=rng.randint(1, 6))
    res = two_sided(inst2.pool, inst2.sellY, inst2.sellX, EPS)
    g = res.Ypool - inst2.pool.C(res.Xpool)
    scale = max(abs(res.Ypool), 1e-9)
    worst["twosided_settle_rel"] = max(worst["twosided_settle_rel"], -g / scale)  # negative gap = pool underpaid
    p0 = inst2.pool.p0
    for (v, q), (sy, rx) in zip(inst2.sellY, res.sellY):
        if rx > 0:
            worst["twosided_price_violation"] = max(worst["twosided_price_violation"], (p0 - sy / rx) / p0)
    for (u, rr), (sx, ry) in zip(inst2.sellX, res.sellX):
        if sx > 0:
            worst["twosided_price_violation"] = max(worst["twosided_price_violation"], (ry / sx - p0) / p0)

print(json.dumps({k: f"{v:.3e}" for k, v in worst.items()}, indent=1))
OUT.mkdir(exist_ok=True)
(OUT / "invariants.json").write_text(json.dumps({"N": N, "eps": EPS, "worst": worst}, indent=1))
