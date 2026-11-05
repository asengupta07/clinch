"""Integer (WAD, 1e18) engine that mirrors the planned Solidity ClinchEngine line by line.

Every intermediate is checked against the int256/uint256 range so we learn where Solidity
would overflow. mulDiv is modelled as full-precision (512-bit) like Solady/OZ mulDiv.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import isqrt

W = 10 ** 18
U256 = 2 ** 256 - 1
I256 = 2 ** 255 - 1


class Overflow(Exception):
    pass


MAXBITS = {"v": 0}


def chk(v: int, signed=False) -> int:
    MAXBITS["v"] = max(MAXBITS["v"], abs(v).bit_length())
    if signed:
        if v > I256 or v < -I256 - 1:
            raise Overflow(v)
    elif v < 0 or v > U256:
        raise Overflow(v)
    return v


def mulDiv(a, b, d):          # floor(a*b/d), a,b,d >= 0, 512-bit intermediate
    r = (a * b) // d
    return chk(r)


def mulDivUp(a, b, d):
    r = -((-a * b) // d)
    return chk(r)


def wmul(a, b):
    return mulDiv(a, b, W)


def wdiv(a, b):
    return mulDiv(a, W, b)


def sdiv_floor(a, d):         # signed floor division
    return a // d


@dataclass
class Supply:
    kind: int          # 0 fixed, 1 constant-product chord
    S0: int = 0
    x0: int = 0
    y0: int = 0
    p0: int = 0
    M: int = 0


def target(s: Supply, p: int, X: int, Y: int) -> int:
    """T~_M(p, X, Y), rounded down. Stable root; mulDiv for the p*K*x0 product."""
    if s.kind == 0:
        return s.S0
    # Every rounding below pushes z DOWN (z is increasing in K, decreasing in b).
    K = chk(Y - mulDivUp(p, X, W) + wmul(p - s.p0, s.M), signed=True)   # K rounded down
    b = chk(s.y0 + K - wmul(p, s.x0), signed=True)                      # b rounded up (WAD)
    # disc = b^2 + 4 p K x0   (scale W^2); the K-term rounds toward -inf
    pk = chk(p * abs(K))
    if K >= 0:
        four_pkx = mulDiv(4 * pk, s.x0, W)
    else:
        four_pkx = -mulDivUp(4 * pk, s.x0, W)
    disc = chk(b * b + four_pkx, signed=True)
    if disc < 0:                                                   # tangency / rounding: no supply beyond X
        disc = 0
    sq_f = isqrt(disc)                                             # floor sqrt
    sq_c = sq_f if sq_f * sq_f == disc else sq_f + 1               # ceil sqrt
    if b >= 0:
        # z = 2 K x0 / (b + sqrt)  -> use ceil sqrt in the denominator
        den = b + sq_c
        if den == 0 or K <= 0:
            z = 0
        else:
            z = mulDiv(2 * K, s.x0, den)
    else:
        z = mulDiv(sq_f - b, W, 2 * p)                             # floor sqrt in the numerator
    z = max(z - 1, 0)                                              # 1-wei safety margin, round down
    return max(s.M + z, X)


def settle(bids: list[tuple[int, int]], s: Supply, eps: int, max_steps: int = 10 ** 6, pmax: int = 0):
    if pmax:
        bids = [(min(l, pmax), q) for l, q in bids]
    n = len(bids)
    qty = [0] * n
    paid = [0] * n
    rem = [b[1] if b[0] >= s.p0 else 0 for b in bids]
    p = s.p0
    X = Y = 0
    B = sum(rem)
    steps = 0

    def buy(i, q, p):
        nonlocal X, Y
        pay = mulDivUp(q, p, W)
        if pay > rem[i]:
            pay = rem[i]
            q = mulDiv(pay, W, p)      # recompute qty from capped pay, round down
        qty[i] += q
        paid[i] += pay
        rem[i] -= pay
        X += q
        Y += pay
        return pay

    for k in range(max_steps):
        steps = k + 1
        T = target(s, p, X, Y)
        S = T - X if T > X else 0
        dAct = 0
        BE = 0
        for i in range(n):
            if rem[i] > 0:
                if bids[i][0] > p:
                    dAct += wdiv(rem[i], p)
                else:
                    BE += rem[i]
        if dAct <= S:
            L = S - dAct
            exitQty = min(wdiv(BE, p), L) if BE > 0 else 0
            for i in range(n):
                if rem[i] > 0:
                    q = wdiv(rem[i], p) if bids[i][0] > p else mulDiv(exitQty, rem[i], BE)
                    buy(i, q, p)
            return qty, paid, p, steps, X, Y
        for i in range(n):
            if rem[i] > 0 and bids[i][0] <= p:
                B -= rem[i]
                rem[i] = 0
        pS = wmul(p, S)
        h = B - pS if B > pS else 0                                    # underflow guard
        for i in range(n):
            if rem[i] > h:
                q = wdiv(rem[i] - h, p)
                if q > 0:
                    B -= buy(i, q, p)
        if B == 0:
            return qty, paid, p, steps, X, Y
        if s.kind == 0 and target(s, p, X, Y) <= X:
            return qty, paid, p, steps, X, Y
        pn = wmul(p, W + eps)
        if pn == p:
            pn = p + 1
        anyA = False
        for i in range(n):
            if rem[i] > 0:
                anyA = True
                if bids[i][0] < pn:
                    pn = bids[i][0]
        if not anyA:
            return qty, paid, p, steps, X, Y
        p = pn
    raise RuntimeError("ladder exhausted")
