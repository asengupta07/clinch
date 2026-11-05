"""Reference (float) implementation of discretized adaptive clinching.

Follows Zhang, Li, Shi, Zhang, Xia, Han (arXiv 2610.36629), Sections 3-5:
  * clock starts at p0 (spot / reserve price); limits < p0 are ineligible
  * chord target T(p, X, Y) from cumulative state against the INITIAL reserves (eq. 11)
  * water level h = B - pS; restoration purchases (b_i - h)/p (eq. 24)
  * exits land exactly on the ladder; stopping allocation with proportional exit rule (eqs. 20-22)
  * minority fill folded into an extended cost curve (eq. 57)

The continuous clock is replaced by a ladder p_{k+1} = min(p_k (1+eps), next limit above p_k).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Sequence

INF = math.inf


# ---------------------------------------------------------------- AMM geometry
@dataclass(frozen=True)
class CPPool:
    """Constant-product pool. Cost C(z) = Y the pool must receive to release z of X."""
    x0: float
    y0: float

    @property
    def p0(self) -> float:
        return self.y0 / self.x0

    def C(self, z: float) -> float:
        return self.y0 * z / (self.x0 - z)

    def a(self, z: float) -> float:  # marginal ask
        return self.x0 * self.y0 / (self.x0 - z) ** 2

    def Cinv(self, y: float) -> float:  # X released for y of Y paid in
        return self.x0 * y / (self.y0 + y)

    def swapped(self) -> "CPPool":
        return CPPool(self.y0, self.x0)


def cp_larger_root(p: float, K: float, x0: float, y0: float) -> float:
    """Larger root of p z^2 + (y0 + K - p x0) z - K x0 = 0, numerically stable.

    Uses the citardauq form so that the K ~ 0 case (common near spot) does not
    subtract two nearly equal numbers.
    """
    b = y0 + K - p * x0
    c = -K * x0
    disc = b * b - 4 * p * c
    if disc < 0:  # only from float noise at a tangency
        disc = 0.0
    s = math.sqrt(disc)
    if b >= 0:
        q = -(b + s) / 2
        r1 = q / p
        r2 = c / q if q != 0 else 0.0
    else:
        q = -(b - s) / 2
        r1 = q / p
        r2 = c / q if q != 0 else 0.0
    return max(r1, r2)


def cp_chord_target(pool: CPPool, M: float = 0.0, p0: float | None = None) -> Callable[[float, float, float], float]:
    """Extended chord target T~_M(p, X, Y) for a CP pool with minority fill M at spot p0."""
    p0 = pool.p0 if p0 is None else p0

    def T(p: float, X: float, Y: float) -> float:
        K = Y - p * X + (p - p0) * M
        z = cp_larger_root(p, K, pool.x0, pool.y0)
        z = max(z, 0.0)
        return max(M + z, X)  # target never below current allocation

    return T


def fixed_target(S0: float) -> Callable[[float, float, float], float]:
    return lambda p, X, Y: S0


def naive_reserve_target(pool: CPPool) -> Callable[[float, float, float], float]:
    """The FIRST-DRAFT (wrong) target: X - Y/p on reserves updated after each clinch.

    Kept only to quantify how much supply the draft would have withheld.
    Expressed in cumulative terms: reserves are (x0 - X, y0 + Y), target in cumulative units
    is X + max(0, (x0 - X) - (y0 + Y)/p).
    """
    def T(p, X, Y):
        return X + max(0.0, (pool.x0 - X) - (pool.y0 + Y) / p)
    return T


# ---------------------------------------------------------------- engine
@dataclass
class Result:
    x: list[float]          # allocation per bid
    y: list[float]          # payment per bid
    p_final: float
    steps: int
    X: float
    Y: float
    ladder: list[float] = field(default_factory=list)

    @property
    def refunds(self):
        return None


def run(
    bids: Sequence[tuple[float, float]],
    target: Callable[[float, float, float], float],
    p0: float,
    eps: float,
    *,
    fixed_supply: bool = False,
    max_steps: int = 2_000_000,
    record_ladder: bool = False,
) -> Result:
    """One-sided discretized clinching. bids = [(limit v_i, budget q_i)], prices in Y per X."""
    n = len(bids)
    lim = [b[0] for b in bids]
    rem = [b[1] if b[0] >= p0 else 0.0 for b in bids]
    x = [0.0] * n
    y = [0.0] * n
    X = Y = 0.0
    p = p0
    ladder = []

    def buy(i, q, p):
        nonlocal X, Y
        if q <= 0:
            return
        pay = q * p
        if pay > rem[i]:
            pay = rem[i]
            q = pay / p
        x[i] += q
        y[i] += pay
        rem[i] -= pay
        X += q
        Y += pay

    for k in range(max_steps):
        if record_ladder:
            ladder.append(p)
        S = max(0.0, target(p, X, Y) - X)
        act = [i for i in range(n) if rem[i] > 0 and lim[i] > p]
        ext = [i for i in range(n) if rem[i] > 0 and lim[i] <= p]
        dAct = sum(rem[i] for i in act) / p
        if dAct <= S * (1 + 1e-15):
            L = max(0.0, S - dAct)
            BE = sum(rem[i] for i in ext)
            for i in act:
                buy(i, rem[i] / p, p)
            if BE > 0:
                exitQty = min(BE / p, L)
                for i in ext:
                    buy(i, exitQty * (rem[i] / BE), p)
            return Result(x, y, p, k + 1, X, Y, ladder)
        for i in ext:
            rem[i] = 0.0
        if not act:
            return Result(x, y, p, k + 1, X, Y, ladder)
        B = sum(rem[i] for i in act)
        h = B - p * S
        assert h > -1e-9 * max(B, 1.0), (h, B, p, S)
        h = max(h, 0.0)
        for i in act:
            if rem[i] > h:
                buy(i, (rem[i] - h) / p, p)
        if fixed_supply and target(p, X, Y) - X <= 1e-15 * max(1.0, X):
            # capacity saturated: zero-trade tail (Lemma 4.5)
            return Result(x, y, p, k + 1, X, Y, ladder)
        if all(rem[i] <= 0 for i in act):
            return Result(x, y, p, k + 1, X, Y, ladder)
        pn = p * (1 + eps)
        for i in act:
            if rem[i] > 0 and lim[i] < pn:
                pn = lim[i]
        p = pn
    raise RuntimeError("ladder exhausted")


# ---------------------------------------------------------------- two-sided
@dataclass
class TwoSidedResult:
    # sell-Y identities: (S_Y sold, R_X received); sell-X identities: (S_X sold, R_Y received)
    sellY: list[tuple[float, float]]
    sellX: list[tuple[float, float]]
    Xpool: float  # X released by pool (negative = absorbed)
    Ypool: float  # Y received by pool
    dominant: str
    M: float
    steps: int
    p_final: float


def two_sided(pool: CPPool, sellY: Sequence[tuple[float, float]], sellX: Sequence[tuple[float, float]],
              eps: float) -> TwoSidedResult:
    """Section 5. sellY = [(v_i, q_i)] (value Y per X, Y-budget); sellX = [(u_i, r_i)] (value Y per X, X-budget)."""
    p0 = pool.p0
    EY = [i for i, (v, q) in enumerate(sellY) if v >= p0]
    EX = [i for i, (u, r) in enumerate(sellX) if u <= p0]
    DY = sum(sellY[i][1] for i in EY) / p0
    DX = sum(sellX[i][1] for i in EX)
    outY = [(0.0, 0.0)] * len(sellY)
    outX = [(0.0, 0.0)] * len(sellX)
    if DY >= DX:  # sell-Y dominant, sell-X minority (tie -> sell-X minority)
        M = DX
        for i in EX:
            r = sellX[i][1]
            outX[i] = (r, p0 * r)
        bids = [sellY[i] for i in EY]
        res = run(bids, cp_chord_target(pool, M), p0, eps)
        for j, i in enumerate(EY):
            outY[i] = (res.y[j], res.x[j])
        return TwoSidedResult(outY, outX, res.X - M, res.Y - p0 * M, "Y", M, res.steps, res.p_final)
    # sell-X dominant: swap assets. Reverse price is X per Y.
    rpool = pool.swapped()
    Mr = sum(sellY[i][1] for i in EY)  # minority supply of Y, in Y units
    for i in EY:
        q = sellY[i][1]
        outY[i] = (q, q / p0)
    bids = [((1.0 / sellX[i][0]) if sellX[i][0] > 0 else INF, sellX[i][1]) for i in EX]
    res = run(bids, cp_chord_target(rpool, Mr), rpool.p0, eps)
    for j, i in enumerate(EX):
        # x_rev = Y received, y_rev = X paid
        outX[i] = (res.y[j], res.x[j])
    # pool releases (res.X - Mr) of Y and receives (res.Y - Mr/p0) of X
    return TwoSidedResult(outY, outX, -(res.Y - Mr / p0), -(res.X - Mr), "X", Mr / p0, res.steps, res.p_final)


# ---------------------------------------------------------------- utilities
def util_sellY(V: float, Q: float, dX: float, dY: float) -> float:
    """Eq. (5)."""
    tol = 1e-9 * max(1.0, Q)
    if -dY > Q + tol or (-dY < -tol and dX < -tol):
        return -INF
    return V * dX + dY


def util_sellX(U: float, R: float, dX: float, dY: float) -> float:
    """Eq. (6)."""
    tol = 1e-9 * max(1.0, R)
    if -dX > R + tol or (-dX < -tol and dY < -tol):
        return -INF
    return dY + U * dX


def net_flows(res: TwoSidedResult, yIds: Sequence[int], xIds: Sequence[int]) -> tuple[float, float]:
    dX = sum(res.sellY[i][1] for i in yIds) - sum(res.sellX[i][0] for i in xIds)
    dY = sum(res.sellX[i][1] for i in xIds) - sum(res.sellY[i][0] for i in yIds)
    return dX, dY
