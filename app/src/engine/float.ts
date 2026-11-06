/**
 * Float reference engine, ported from research/clinch/engine.py.
 * Used for the Whale Lab (fast what-if analysis). On-chain amounts use ./wad.ts instead.
 */

export type Target = (p: number, X: number, Y: number) => number;

export interface FloatResult {
  x: number[];
  y: number[];
  pFinal: number;
  steps: number;
  X: number;
  Y: number;
}

export class CPPool {
  constructor(
    readonly x0: number,
    readonly y0: number,
  ) {}
  get p0() {
    return this.y0 / this.x0;
  }
  /** Y the pool must receive to release z of X */
  C(z: number) {
    return (this.y0 * z) / (this.x0 - z);
  }
  /** X released for y of Y paid in */
  Cinv(y: number) {
    return (this.x0 * y) / (this.y0 + y);
  }
  swapped() {
    return new CPPool(this.y0, this.x0);
  }
}

/** Larger root of p z^2 + (y0 + K - p x0) z - K x0 = 0 (citardauq form). */
export function cpLargerRoot(p: number, K: number, x0: number, y0: number): number {
  const b = y0 + K - p * x0;
  const c = -K * x0;
  let disc = b * b - 4 * p * c;
  if (disc < 0) disc = 0;
  const s = Math.sqrt(disc);
  let r1: number;
  let r2: number;
  if (b >= 0) {
    const q = -(b + s) / 2;
    r1 = q / p;
    r2 = q !== 0 ? c / q : 0;
  } else {
    const q = -(b - s) / 2;
    r1 = q / p;
    r2 = q !== 0 ? c / q : 0;
  }
  return Math.max(r1, r2);
}

export function cpChordTarget(pool: CPPool, M = 0, p0?: number): Target {
  const start = p0 ?? pool.p0;
  return (p, X, Y) => {
    const K = Y - p * X + (p - start) * M;
    const z = Math.max(cpLargerRoot(p, K, pool.x0, pool.y0), 0);
    return Math.max(M + z, X);
  };
}

export function fixedTarget(S0: number): Target {
  return () => S0;
}

export interface RunOptions {
  fixedSupply?: boolean;
  maxSteps?: number;
}

/** One-sided discretized clinching. bids = [limit, budget][], prices in Y per X. */
export function run(bids: ReadonlyArray<readonly [number, number]>, target: Target, p0: number, eps: number, opts: RunOptions = {}): FloatResult {
  const { fixedSupply = false, maxSteps = 2_000_000 } = opts;
  const n = bids.length;
  const lim = bids.map((b) => b[0]);
  const rem = bids.map((b) => (b[0] >= p0 ? b[1] : 0));
  const x = new Array<number>(n).fill(0);
  const y = new Array<number>(n).fill(0);
  let X = 0;
  let Y = 0;
  let p = p0;

  const buy = (i: number, q: number, price: number) => {
    if (q <= 0) return;
    let pay = q * price;
    if (pay > rem[i]) {
      pay = rem[i];
      q = pay / price;
    }
    x[i] += q;
    y[i] += pay;
    rem[i] -= pay;
    X += q;
    Y += pay;
  };
  const done = (k: number): FloatResult => ({ x, y, pFinal: p, steps: k + 1, X, Y });

  for (let k = 0; k < maxSteps; k++) {
    const S = Math.max(0, target(p, X, Y) - X);
    let dActSum = 0;
    let BE = 0;
    let anyAct = false;
    for (let i = 0; i < n; i++) {
      if (rem[i] <= 0) continue;
      if (lim[i] > p) {
        dActSum += rem[i];
        anyAct = true;
      } else BE += rem[i];
    }
    const dAct = dActSum / p;
    if (dAct <= S * (1 + 1e-15)) {
      const L = Math.max(0, S - dAct);
      const actIdx: number[] = [];
      const extIdx: number[] = [];
      for (let i = 0; i < n; i++) {
        if (rem[i] <= 0) continue;
        if (lim[i] > p) actIdx.push(i);
        else extIdx.push(i);
      }
      for (const i of actIdx) buy(i, rem[i] / p, p);
      if (BE > 0) {
        const exitQty = Math.min(BE / p, L);
        const shares = extIdx.map((i) => rem[i] / BE);
        extIdx.forEach((i, j) => buy(i, exitQty * shares[j], p));
      }
      return done(k);
    }
    for (let i = 0; i < n; i++) if (rem[i] > 0 && lim[i] <= p) rem[i] = 0;
    if (!anyAct) return done(k);
    let B = 0;
    for (let i = 0; i < n; i++) if (rem[i] > 0) B += rem[i];
    const h = Math.max(B - p * S, 0);
    for (let i = 0; i < n; i++) {
      if (rem[i] > 0 && lim[i] > p && rem[i] > h) buy(i, (rem[i] - h) / p, p);
    }
    if (fixedSupply && target(p, X, Y) - X <= 1e-15 * Math.max(1, X)) return done(k);
    let allSpent = true;
    for (let i = 0; i < n; i++) if (rem[i] > 0) allSpent = false;
    if (allSpent) return done(k);
    let pn = p * (1 + eps);
    for (let i = 0; i < n; i++) if (rem[i] > 0 && lim[i] < pn) pn = lim[i];
    p = pn;
  }
  throw new Error("ladder exhausted");
}
