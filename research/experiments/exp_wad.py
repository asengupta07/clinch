"""Differential test: integer WAD engine vs float reference.
Checks exact-integer settlement (pool never underpaid), budget, IR, and overflow headroom
across token scales from 1e-6 to 1e12 whole tokens."""
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from clinch import wad  # noqa: E402
from clinch.engine import CPPool, cp_chord_target, fixed_target, run  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "results"
W = wad.W
rng = random.Random(3)
N = int(sys.argv[1]) if len(sys.argv) > 1 else 300
EPS = 1e-3

stats = {"overflow": 0, "pool_underpaid": 0, "budget_violation": 0, "ir_violation": 0,
         "max_rel_diff_X": 0.0, "max_rel_diff_Y": 0.0, "max_bits": 0, "fixed_overalloc": 0, "runs": 0,
         "max_surplus_wei": 0}
for t in range(N):
    scale = 10 ** rng.uniform(-6, 12)         # whole-token scale of reserves
    x0 = scale * 10 ** rng.uniform(0, 1)
    p0 = 10 ** rng.uniform(-6, 6)             # wide price range (e.g. memecoin vs WBTC)
    y0 = x0 * p0
    pool = CPPool(x0, y0)
    n = rng.randint(1, 30)
    bids = [(p0 * (1 + 10 ** rng.uniform(-4, 0.5)), y0 * 10 ** rng.uniform(-4, -0.5)) for _ in range(n)]
    X0i, Y0i = int(x0 * W), int(y0 * W)
    p0i = Y0i * W // X0i  # spot as WAD, floor
    ib = [(int(v * W), int(q * W)) for v, q in bids]
    sup = wad.Supply(1, x0=X0i, y0=Y0i, p0=p0i)
    stats["runs"] += 1
    try:
        qty, paid, pF, steps, Xi, Yi = wad.settle(ib, sup, int(EPS * W))
    except wad.Overflow:
        stats["overflow"] += 1
        continue
    # exact pool check: pool gives Xi, receives Yi; need Yi*(x0 - Xi) >= y0*Xi
    if Yi * (X0i - Xi) < Y0i * Xi:
        stats["pool_underpaid"] += 1
    else:
        # surplus in wei of Y: Yi - ceil(C(Xi))
        cX = -((-Y0i * Xi) // (X0i - Xi))
        stats["max_surplus_wei"] = max(stats["max_surplus_wei"], Yi - cX) if Yi > 0 else stats["max_surplus_wei"]
    for (v, q), qi, pi in zip(ib, qty, paid):
        if pi > q:
            stats["budget_violation"] += 1
        if qi > 0 and pi * W > v * qi + W * 2:   # pay per unit <= limit (2-wei slack)
            stats["ir_violation"] += 1
    fr = run([(v / W, q / W) for v, q in ib], cp_chord_target(CPPool(X0i / W, Y0i / W)), p0i / W, EPS)
    if fr.X > 0:
        stats["max_rel_diff_X"] = max(stats["max_rel_diff_X"], abs(Xi / W - fr.X) / fr.X)
        stats["max_rel_diff_Y"] = max(stats["max_rel_diff_Y"], abs(Yi / W - fr.Y) / fr.Y)

    # fixed supply
    S0 = int(x0 * 0.1 * W)
    ibf = [(min(v, p0i * 50), q) for v, q in ib]
    qty, paid, *_ = wad.settle(ibf, wad.Supply(0, S0=S0, p0=p0i), int(EPS * W))
    if sum(qty) > S0:
        stats["fixed_overalloc"] += 1
stats["max_bits"] = wad.MAXBITS["v"]
print(json.dumps(stats, indent=1))
OUT.mkdir(exist_ok=True)
(OUT / "wad.json").write_text(json.dumps(stats, indent=1))
