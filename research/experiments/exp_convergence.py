"""Prop 7 (convergence in eps), Lemma 6.2 step bound, settlement surplus, draft-target supply loss,
and fixed-supply step counts."""
import json
import math
import random
import sys
from multiprocessing import Pool
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from clinch.engine import CPPool, cp_chord_target, fixed_target, naive_reserve_target, run  # noqa: E402
from clinch.gen import rand_instance  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "results"
EPSS = [1e-1, 3e-2, 1e-2, 3e-3, 1e-3, 3e-4, 1e-4]
REF = 1e-6


def one(seed):
    rng = random.Random(seed)
    depth = 10 ** rng.uniform(-3, 0)       # batch budget relative to pool from 0.1% to 100%
    inst = rand_instance(rng, nY=rng.randint(2, 20), depth=depth / 5)
    pool, bids = inst.pool, inst.sellY
    T = cp_chord_target(pool)
    ref = run(bids, T, pool.p0, REF)
    B0 = sum(q for v, q in bids if v >= pool.p0)
    out = {"seed": seed, "n": len(bids), "B0_over_y0": B0 / pool.y0, "rows": []}
    PB = (pool.y0 + B0) ** 2 / (pool.x0 * pool.y0)
    for e in EPSS:
        r = run(bids, T, pool.p0, e)
        l1x = sum(abs(a - b) for a, b in zip(r.x, ref.x)) / max(ref.X, 1e-12)
        l1y = sum(abs(a - b) for a, b in zip(r.y, ref.y)) / max(ref.Y, 1e-12)
        bound = 2 * math.log1p(B0 / pool.y0) / math.log1p(e) + len(bids) + 1
        out["rows"].append({
            "eps": e, "l1x": l1x, "l1y": l1y, "steps": r.steps, "bound": bound,
            "pfinal_over_PB": r.p_final / PB,
            "surplus_rel": (r.Y - pool.C(r.X)) / max(r.Y, 1e-12),
        })
    # draft target: how much supply it withholds (same bids, eps 1e-4)
    rn = run(bids, naive_reserve_target(pool), pool.p0, 1e-4)
    rc = run(bids, T, pool.p0, 1e-4)
    out["draft_X_ratio"] = rn.X / max(rc.X, 1e-12)
    out["draft_spent_ratio"] = rn.Y / max(rc.Y, 1e-12)
    return out


def fixed_steps(seed):
    rng = random.Random(seed)
    out = []
    for cap in [2, 10, 100, 1000]:
        bids = [(rng.uniform(1.0, cap), rng.uniform(1, 10)) for _ in range(20)]
        for e in [1e-2, 1e-3]:
            r = run(bids, fixed_target(30.0), 1.0, e, fixed_supply=True)
            out.append({"cap": cap, "eps": e, "steps": r.steps,
                        "bound": math.log(cap) / math.log1p(e) + 21})
    return out


if __name__ == "__main__":
    N = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    with Pool(10) as P:
        res = P.map(one, range(N), chunksize=1)
        fx = P.map(fixed_steps, range(10))
    agg = {}
    for e in EPSS:
        rows = [r for o in res for r in o["rows"] if r["eps"] == e]
        agg[e] = {
            "l1x_max": max(r["l1x"] for r in rows), "l1x_med": sorted(r["l1x"] for r in rows)[len(rows) // 2],
            "l1y_max": max(r["l1y"] for r in rows),
            "steps_max": max(r["steps"] for r in rows), "steps_med": sorted(r["steps"] for r in rows)[len(rows) // 2],
            "bound_violations": sum(r["steps"] > r["bound"] for r in rows),
            "pfinal_over_PB_max": max(r["pfinal_over_PB"] for r in rows),
            "surplus_rel_max": max(r["surplus_rel"] for r in rows),
            "surplus_rel_min": min(r["surplus_rel"] for r in rows),
        }
    dx = sorted(o["draft_X_ratio"] for o in res)
    draft = {"X_ratio_min": dx[0], "X_ratio_med": dx[len(dx) // 2], "X_ratio_max": dx[-1]}
    fixed = {}
    for row in [r for f in fx for r in f]:
        k = f"cap={row['cap']},eps={row['eps']}"
        fixed.setdefault(k, {"steps_max": 0, "bound": row["bound"]})
        fixed[k]["steps_max"] = max(fixed[k]["steps_max"], row["steps"])
    print("eps      l1x_max   l1x_med   l1y_max  steps_med steps_max bound_viol pF/PB_max surplus_max")
    for e, a in agg.items():
        print(f"{e:<8g} {a['l1x_max']:.2e} {a['l1x_med']:.2e} {a['l1y_max']:.2e} {a['steps_med']:>8} {a['steps_max']:>8}"
              f" {a['bound_violations']:>8} {a['pfinal_over_PB_max']:.3f}    {a['surplus_rel_max']:.2e}")
    print("draft target X / correct X:", draft)
    print("fixed supply steps:", json.dumps(fixed))
    OUT.mkdir(exist_ok=True)
    (OUT / "convergence.json").write_text(json.dumps({"agg": {str(k): v for k, v in agg.items()}, "draft": draft,
                                                      "fixed": fixed, "raw": res}, indent=1))
