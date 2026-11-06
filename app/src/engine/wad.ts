/**
 * Integer (bigint) port of contracts/src/libraries/ClinchEngine.sol, line by line.
 *
 * Every rounding matches the Solidity: FullMath.mulDiv floors, mulDivRoundingUp ceils, and
 * FixedPointMathLib.sqrt floors. Given the same inputs this produces the same allocation as the
 * chain, bit for bit, which is what lets the UI replay a settled launch and check it against
 * the on-chain result.
 *
 * Optionally records a trace of every ladder step (price, per-bid holdings, exits) for the
 * price-ladder replay.
 */

export const WAD = 10n ** 18n;
export const MAX_UINT256 = (1n << 256n) - 1n;

export function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("mulDiv: division by zero");
  return (a * b) / d;
}

export function mulDivUp(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("mulDivUp: division by zero");
  const p = a * b;
  const q = p / d;
  return p % d === 0n ? q : q + 1n;
}

/** floor(sqrt(x)) */
export function isqrt(x: bigint): bigint {
  if (x < 0n) throw new Error("isqrt of negative");
  if (x < 2n) return x;
  // Newton iteration from a power-of-two upper bound
  let z = 1n << BigInt(Math.ceil(x.toString(2).length / 2));
  for (;;) {
    const y = (z + x / z) >> 1n;
    if (y >= z) return z;
    z = y;
  }
}

export interface Bid {
  limit: bigint;
  budget: bigint;
}

export interface Supply {
  kind: 0 | 1;
  S0: bigint;
  x0: bigint;
  y0: bigint;
  p0: bigint;
  M: bigint;
}

export interface Params {
  eps: bigint;
  pMax: bigint;
  maxSteps: number;
}

export interface Result {
  qty: bigint[];
  paid: bigint[];
  X: bigint;
  Y: bigint;
  pFinal: bigint;
  steps: number;
}

export interface TraceStep {
  /** ladder price at this step (WAD) */
  p: bigint;
  /** cumulative quantity per bid after this step */
  qty: bigint[];
  /** cumulative payment per bid after this step */
  paid: bigint[];
  /** bids whose limit was reached at this price and dropped out (indices) */
  exited: number[];
  /** true if this was the terminating (stopping-allocation) step */
  final: boolean;
}

export class LadderExhausted extends Error {
  constructor() {
    super("LadderExhausted");
  }
}

export function fixedSupply(S0: bigint, p0: bigint): Supply {
  return { kind: 0, S0, x0: 0n, y0: 0n, p0, M: 0n };
}

/** T~_M(p, X, Y), rounded down (paper eqs. 11 and 57). */
export function target(s: Supply, p: bigint, X: bigint, Y: bigint): bigint {
  if (s.kind === 0) return s.S0;
  if (p < s.p0) throw new Error("target: p below p0");
  const K = Y - mulDivUp(p, X, WAD) + mulDiv(p - s.p0, s.M, WAD);
  const b = s.y0 + K - mulDiv(p, s.x0, WAD);
  const absK = K >= 0n ? K : -K;
  const pk = p * absK;
  const fourPkx = K >= 0n ? mulDiv(4n * pk, s.x0, WAD) : mulDivUp(4n * pk, s.x0, WAD);
  const absB = b >= 0n ? b : -b;
  const bb = absB * absB;
  let disc: bigint;
  if (K >= 0n) disc = bb + fourPkx;
  else disc = bb > fourPkx ? bb - fourPkx : 0n;
  const sqF = isqrt(disc);
  let z = 0n;
  if (b >= 0n) {
    if (K > 0n) {
      const sqC = sqF * sqF === disc ? sqF : sqF + 1n;
      z = mulDiv(2n * K, s.x0, absB + sqC);
    }
  } else {
    z = mulDiv(sqF + absB, WAD, 2n * p);
  }
  if (z > 0n) z -= 1n;
  const T = s.M + z;
  return T > X ? T : X;
}

/**
 * One-sided clinching on the geometric ladder starting at s.p0. Mirrors ClinchEngine.run.
 * If `trace` is given, one entry is pushed per ladder step.
 */
export function run(bids: Bid[], s: Supply, prm: Params, trace?: TraceStep[]): Result {
  if (prm.eps === 0n || s.p0 === 0n) throw new Error("InvalidParams");
  const n = bids.length;
  const o: Result = { qty: Array(n).fill(0n), paid: Array(n).fill(0n), X: 0n, Y: 0n, pFinal: 0n, steps: 0 };
  const rem: bigint[] = Array(n).fill(0n);
  const lim: bigint[] = Array(n).fill(0n);
  let p = s.p0;
  let B = 0n;
  for (let i = 0; i < n; i++) {
    let l = bids[i].limit;
    if (prm.pMax !== 0n && l > prm.pMax) l = prm.pMax;
    lim[i] = l;
    if (l >= p && bids[i].budget > 0n) {
      rem[i] = bids[i].budget;
      B += rem[i];
    }
  }
  if (B === 0n) {
    o.pFinal = p;
    return o;
  }

  const buy = (i: number, q: bigint, price: bigint): bigint => {
    let pay = mulDivUp(q, price, WAD);
    if (pay > rem[i]) {
      pay = rem[i];
      q = mulDiv(pay, WAD, price);
    }
    o.qty[i] += q;
    o.paid[i] += pay;
    rem[i] -= pay;
    o.X += q;
    o.Y += pay;
    return pay;
  };
  const snap = (price: bigint, exited: number[], final: boolean) => {
    if (trace) trace.push({ p: price, qty: o.qty.slice(), paid: o.paid.slice(), exited, final });
  };

  for (let k = 0; k < prm.maxSteps; k++) {
    o.steps = k + 1;
    const T = target(s, p, o.X, o.Y);
    const S = T > o.X ? T - o.X : 0n;

    let dAct = 0n;
    let BE = 0n;
    for (let i = 0; i < n; i++) {
      const r = rem[i];
      if (r === 0n) continue;
      if (lim[i] > p) dAct += mulDiv(r, WAD, p);
      else BE += r;
    }

    if (dAct <= S) {
      let exitQty = 0n;
      if (BE > 0n) {
        exitQty = mulDiv(BE, WAD, p);
        const L = S - dAct;
        if (L < exitQty) exitQty = L;
      }
      for (let i = 0; i < n; i++) {
        const r = rem[i];
        if (r === 0n) continue;
        const q = lim[i] > p ? mulDiv(r, WAD, p) : mulDiv(exitQty, r, BE);
        buy(i, q, p);
      }
      o.pFinal = p;
      snap(p, [], true);
      return o;
    }

    const exited: number[] = [];
    for (let i = 0; i < n; i++) {
      if (rem[i] > 0n && lim[i] <= p) {
        B -= rem[i];
        rem[i] = 0n;
        exited.push(i);
      }
    }

    const pS = mulDiv(p, S, WAD);
    const h = B > pS ? B - pS : 0n;
    for (let i = 0; i < n; i++) {
      if (rem[i] > h) {
        const q = mulDiv(rem[i] - h, WAD, p);
        if (q > 0n) B -= buy(i, q, p);
      }
    }

    if (B === 0n || (s.kind === 0 && s.S0 <= o.X)) {
      o.pFinal = p;
      snap(p, exited, true);
      return o;
    }

    let pn = mulDiv(p, WAD + prm.eps, WAD);
    if (pn === p) pn = p + 1n;
    let anyActive = false;
    for (let i = 0; i < n; i++) {
      if (rem[i] > 0n) {
        anyActive = true;
        if (lim[i] < pn) pn = lim[i];
      }
    }
    if (!anyActive) {
      o.pFinal = p;
      snap(p, exited, true);
      return o;
    }
    snap(p, exited, false);
    p = pn;
  }
  throw new LadderExhausted();
}

// ------------------------------------------------------------------ two-sided (paper Section 5)

export interface Order {
  zeroForOne: boolean;
  /** token1 per token0 (WAD): buyer's max, seller's min (0 = any) */
  limit: bigint;
  budget: bigint;
}

export interface TwoSided {
  buyersDominant: boolean;
  received: bigint[];
  spent: bigint[];
  dominantBought: bigint;
  minoritySupply: bigint;
  poolIn: bigint;
  pFinal: bigint;
  steps: number;
}

export function reverseLimit(u: bigint): bigint {
  if (u === 0n) return MAX_UINT256;
  return mulDiv(WAD, WAD, u);
}

/** Mirrors ClinchEngine.twoSided. r0, r1 are the pool's constant-product reserves. */
export function twoSided(orders: Order[], r0: bigint, r1: bigint, prm: Params): TwoSided {
  const n = orders.length;
  const t: TwoSided = {
    buyersDominant: false,
    received: Array(n).fill(0n),
    spent: Array(n).fill(0n),
    dominantBought: 0n,
    minoritySupply: 0n,
    poolIn: 0n,
    pFinal: 0n,
    steps: 0,
  };
  if (r0 === 0n || r1 === 0n) return t;

  const p0 = mulDiv(r1, WAD, r0);
  const q0 = mulDiv(r0, WAD, r1);
  if (p0 === 0n || q0 === 0n) return t; // price outside WAD precision: nothing trades

  let dBuy = 0n;
  let dSell = 0n;
  let nBuy = 0;
  let nSell = 0;
  for (const od of orders) {
    if (od.budget === 0n) continue;
    if (!od.zeroForOne) {
      if (od.limit >= p0) {
        dBuy += mulDiv(od.budget, WAD, p0);
        nBuy++;
      }
    } else if (reverseLimit(od.limit) >= q0) {
      dSell += od.budget;
      nSell++;
    }
  }
  if (nBuy === 0 && nSell === 0) return t;

  t.buyersDominant = dBuy >= dSell;
  const domIsBuy = t.buyersDominant;

  const dom: Bid[] = [];
  const domIdx: number[] = [];
  let payouts = 0n;
  for (let i = 0; i < n; i++) {
    const od = orders[i];
    if (od.budget === 0n) continue;
    const isBuy = !od.zeroForOne;
    const eligible = isBuy ? od.limit >= p0 : reverseLimit(od.limit) >= q0;
    if (!eligible) continue;
    if (isBuy === domIsBuy) {
      dom.push({ limit: isBuy ? od.limit : reverseLimit(od.limit), budget: od.budget });
      domIdx.push(i);
    } else {
      // minority sells its whole budget at the spot clock (the same p0/q0 the engine charges for M)
      const out = isBuy ? mulDiv(od.budget, q0, WAD) : mulDiv(od.budget, p0, WAD);
      t.spent[i] = od.budget;
      t.received[i] = out;
      t.minoritySupply += od.budget;
      payouts += out;
    }
  }

  const s: Supply = domIsBuy
    ? { kind: 1, S0: 0n, x0: r0, y0: r1, p0, M: t.minoritySupply }
    : { kind: 1, S0: 0n, x0: r1, y0: r0, p0: q0, M: t.minoritySupply };

  const res = run(dom, s, prm);
  for (let k = 0; k < dom.length; k++) {
    const i = domIdx[k];
    t.received[i] = res.qty[k];
    t.spent[i] = res.paid[k];
  }
  t.dominantBought = res.X;
  t.pFinal = res.pFinal;
  t.steps = res.steps;

  if (res.Y >= payouts) {
    t.poolIn = res.Y - payouts;
  } else {
    let deficit = payouts - res.Y;
    for (let i = n; i > 0 && deficit > 0n; i--) {
      const idx = i - 1;
      const od = orders[idx];
      if (od.budget === 0n || !od.zeroForOne === domIsBuy || t.spent[idx] !== od.budget) continue;
      if (t.received[idx] === 0n) continue;
      const cut = t.received[idx] < deficit ? t.received[idx] : deficit;
      t.received[idx] -= cut;
      deficit -= cut;
    }
  }
  return t;
}

/** Launch engine parameters exactly as ClinchLaunch builds them. */
export const LAUNCH_MAX_STEPS = 20_000;
/** Hook engine parameters exactly as ClinchHook builds them. */
export const HOOK_MAX_STEPS = 4_000;
