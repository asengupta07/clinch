"""Adversarial search for profitable deviations (Props 4, 5, 8, 9).

Modes
  amm      one-sided AMM clinching; trader splits into k sell-Y identities, arbitrary values, sum budget <= Q
  fixed    fixed-supply launch, same strategy space
  naive    one-sided AMM with the FIRST-DRAFT target (reserves updated per clinch) - control
  misrep   one-sided AMM, single identity, value misreport only (k = 1)
  cross    two-sided; sell-Y trader adds sell-Y sybils AND sell-X identities with arbitrary budgets
  nfl      two-sided; budget-free bot seeks a free lunch (gain one token, lose neither)

Search: random restarts + hill climbing. Reports max gain normalised by the trader's budget Q
(for nfl: by the bot's total escrow, in Y at spot).
"""
import json
import math
import random
import sys
from multiprocessing import Pool
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from clinch.engine import (INF, CPPool, cp_chord_target, fixed_target, naive_reserve_target,  # noqa: E402
                           net_flows, run, two_sided, util_sellY)
from clinch.gen import rand_instance  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "results"


def one_sided_util(mode, pool, others, V, Q, strat, eps, S0):
    """strat = [(value, budget_fraction)], fractions sum <= 1."""
    ids = [(v, Q * f) for v, f in strat]
    bids = ids + others
    if mode == "fixed":
        bids = [(min(v, pool.p0 * 50), q) for v, q in bids]
        r = run(bids, fixed_target(S0), pool.p0, eps, fixed_supply=True)
    elif mode == "rebate":
        # exact-input residual swap: pool takes all Y, releases Cinv(Y) >= X; surplus X rebated pro-rata to qty
        r = run(bids, cp_chord_target(pool), pool.p0, eps)
        k = len(ids)
        f = (pool.Cinv(r.Y) / r.X) if r.X > 0 else 1.0
        return V * sum(r.x[:k]) * f - sum(r.y[:k])
    elif mode == "naive":
        r = run(bids, naive_reserve_target(pool), pool.p0, eps)
    else:
        r = run(bids, cp_chord_target(pool), pool.p0, eps)
    k = len(ids)
    return V * sum(r.x[:k]) - sum(r.y[:k])


def cross_util(pool, othersY, othersX, V, Q, strat, eps):
    """strat = (Ystrat [(v, frac)], Xstrat [(u, r_abs)])."""
    ys, xs = strat
    sy = [(v, Q * f) for v, f in ys] + othersY
    sx = [(u, r) for u, r in xs] + othersX
    res = two_sided(pool, sy, sx, eps)
    dX, dY = net_flows(res, range(len(ys)), range(len(xs)))
    return util_sellY(V, Q, dX, dY)


def nfl_score(pool, othersY, othersX, strat, eps):
    ys, xs = strat
    sy = list(ys) + othersY
    sx = list(xs) + othersX
    res = two_sided(pool, sy, sx, eps)
    dX, dY = net_flows(res, range(len(ys)), range(len(xs)))
    escrow = sum(q for _, q in ys) + pool.p0 * sum(r for _, r in xs)
    # free lunch iff both >= 0 and one > 0. Score: max(...) when neither is negative, else min(...) (< 0).
    a, b = dX * pool.p0, dY
    tol = 1e-12 * max(escrow, 1.0)
    sc = max(a, b) if (a >= -tol and b >= -tol) else min(a, b)
    return sc / max(escrow, 1e-12), dX, dY


def norm(fr):
    s = sum(f for _, f in fr)
    if s > 1:
        fr = [(v, f / s) for v, f in fr]
    return fr


def search(args):
    mode, seed, eps, iters = args
    rng = random.Random(seed)
    inst = rand_instance(rng, nY=rng.randint(2, 6), nX=(rng.randint(1, 5) if mode in ("cross", "nfl") else 0))
    pool = inst.pool
    p0 = pool.p0
    S0 = pool.x0 * rng.uniform(0.01, 0.3)
    V = p0 * (1 + 10 ** rng.uniform(-2, 0.3))
    Q = pool.y0 * 0.05 * 10 ** rng.uniform(-1, 0.5)

    def rand_val():
        c = rng.random()
        if c < 0.2:
            return V
        if c < 0.6:
            return p0 + (V - p0) * rng.random()
        return V * (1 + rng.random() * 2)

    if mode == "nfl":
        def rand_strat():
            ys = [(p0 * (1 + 10 ** rng.uniform(-3, 0.5)), pool.y0 * 0.05 * 10 ** rng.uniform(-2, 0.5))
                  for _ in range(rng.randint(0, 3))]
            xs = [(p0 / (1 + 10 ** rng.uniform(-3, 0.5)) if rng.random() < .8 else 0.0,
                   pool.x0 * 0.05 * 10 ** rng.uniform(-2, 0.5)) for _ in range(rng.randint(0, 3))]
            if not ys and not xs:
                ys = [(p0 * 1.01, pool.y0 * 0.01)]
            return ys, xs

        def score(s):
            return nfl_score(pool, inst.sellY, inst.sellX, s, eps)[0]

        def perturb(s):
            ys, xs = s
            ys = [(max(p0 * 0.5, v * math.exp(rng.gauss(0, .05))), q * math.exp(rng.gauss(0, .1))) for v, q in ys]
            xs = [(max(0.0, u * math.exp(rng.gauss(0, .05))), r * math.exp(rng.gauss(0, .1))) for u, r in xs]
            return ys, xs
        base = 0.0
    elif mode == "cross":
        DY = sum(q for v, q in inst.sellY if v >= p0) / p0 + Q / p0

        def rand_strat():
            ys = norm([(rand_val(), rng.random()) for _ in range(rng.randint(1, 4))])
            xs = [(p0 * rng.random() ** 0.2, DY * 10 ** rng.uniform(-2, 0.7)) for _ in range(rng.randint(0, 3))]
            return ys, xs

        def score(s):
            return (cross_util(pool, inst.sellY, inst.sellX, V, Q, s, eps) - base_u) / Q

        def perturb(s):
            ys, xs = s
            ys = norm([(max(0.0, v * math.exp(rng.gauss(0, .05))), min(1.0, f * math.exp(rng.gauss(0, .1)))) for v, f in ys])
            xs = [(min(p0, u * math.exp(rng.gauss(0, .05))), r * math.exp(rng.gauss(0, .2))) for u, r in xs]
            return ys, xs
        base_u = cross_util(pool, inst.sellY, inst.sellX, V, Q, ([(V, 1.0)], []), eps)
    else:
        kmax = 1 if mode == "misrep" else 8

        def rand_strat():
            k = rng.randint(1, kmax)
            fr = norm([(rand_val(), rng.random() if k > 1 else 1.0) for _ in range(k)])
            return fr

        def score(s):
            return (one_sided_util(mode, pool, inst.sellY, V, Q, s, eps, S0) - base_u) / Q

        def perturb(s):
            return norm([(max(0.0, v * math.exp(rng.gauss(0, .05))), min(1.0, f * math.exp(rng.gauss(0, .1)))) for v, f in s])
        base_u = one_sided_util(mode, pool, inst.sellY, V, Q, [(V, 1.0)], eps, S0)

    best, best_s = -INF, None
    for _ in range(iters // 2):
        s = rand_strat()
        sc = score(s)
        if sc > best:
            best, best_s = sc, s
    cur, cur_s = best, best_s
    for _ in range(iters // 2):
        s = perturb(cur_s)
        sc = score(s)
        if sc >= cur:
            cur, cur_s = sc, s
    best = max(best, cur)
    return mode, eps, seed, best, repr(cur_s)[:300]


if __name__ == "__main__":
    n_inst = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    iters = int(sys.argv[2]) if len(sys.argv) > 2 else 120
    modes = sys.argv[3].split(",") if len(sys.argv) > 3 else ["amm", "fixed", "misrep", "naive", "cross", "nfl"]
    epss = [1e-2, 1e-3]
    jobs = [(m, s, e, iters) for m in modes for e in epss for s in range(n_inst)]
    with Pool(10) as P:
        res = P.map(search, jobs, chunksize=1)
    summary = {}
    for m in modes:
        for e in epss:
            g = sorted((r for r in res if r[0] == m and r[1] == e), key=lambda r: -r[3])
            vals = [r[3] for r in g]
            summary[f"{m}@eps={e}"] = {
                "max_gain": vals[0], "p95": vals[max(0, len(vals) // 20 - 1)],
                "n_positive_over_eps": sum(v > e for v in vals), "n": len(vals),
                "worst_seed": g[0][2], "worst_strategy": g[0][4],
            }
    print(json.dumps({k: {kk: (f"{vv:.3e}" if isinstance(vv, float) else vv) for kk, vv in v.items() if kk != "worst_strategy"}
                      for k, v in summary.items()}, indent=1))
    OUT.mkdir(exist_ok=True)
    (OUT / "sybil.json").write_text(json.dumps(summary, indent=1))
