/**
 * Step-by-step trace of the fixed-supply clinching auction, for the landing page replay.
 * Same loop as engine/float.ts `run`, recording a snapshot after every ladder step.
 */
export interface Frame {
  p: number; // clock price at this step
  x: number[]; // tokens clinched so far, per bidder
  paid: number[];
  out: boolean[]; // dropped out (limit reached, budget cancelled)
  clinching: boolean[]; // bought at this step
  sold: number; // total clinched
}

export function traceFixed(bids: ReadonlyArray<readonly [number, number]>, supply: number, p0: number, eps: number): Frame[] {
  const n = bids.length;
  const lim = bids.map((b) => b[0]);
  const rem = bids.map((b) => (b[0] >= p0 ? b[1] : 0));
  const x = new Array<number>(n).fill(0);
  const y = new Array<number>(n).fill(0);
  const out = rem.map((r) => r <= 0);
  let X = 0;
  let p = p0;
  const frames: Frame[] = [];
  const snap = (clinching: boolean[]) => frames.push({ p, x: [...x], paid: [...y], out: [...out], clinching, sold: X });
  const buy = (i: number, q: number) => {
    if (q <= 0) return false;
    let pay = q * p;
    if (pay > rem[i]) {
      pay = rem[i];
      q = pay / p;
    }
    x[i] += q;
    y[i] += pay;
    rem[i] -= pay;
    X += q;
    return q > 1e-9;
  };
  for (let k = 0; k < 10_000; k++) {
    const S = Math.max(0, supply - X);
    const clinching = new Array<boolean>(n).fill(false);
    let dAct = 0;
    let BE = 0;
    for (let i = 0; i < n; i++) {
      if (rem[i] <= 0) continue;
      if (lim[i] > p) dAct += rem[i] / p;
      else BE += rem[i];
    }
    if (dAct <= S) {
      const L = Math.max(0, S - dAct);
      const exitQty = BE > 0 ? Math.min(BE / p, L) : 0;
      const remSnap = [...rem];
      for (let i = 0; i < n; i++) {
        if (remSnap[i] <= 0) continue;
        clinching[i] = lim[i] > p ? buy(i, remSnap[i] / p) : buy(i, (exitQty * remSnap[i]) / BE);
      }
      for (let i = 0; i < n; i++) if (rem[i] > 0 || lim[i] <= p) out[i] = out[i] || lim[i] <= p;
      snap(clinching);
      return frames;
    }
    for (let i = 0; i < n; i++)
      if (rem[i] > 0 && lim[i] <= p) {
        rem[i] = 0;
        out[i] = true;
      }
    let B = 0;
    for (let i = 0; i < n; i++) if (rem[i] > 0) B += rem[i];
    const h = Math.max(B - p * S, 0);
    for (let i = 0; i < n; i++) if (rem[i] > 0 && rem[i] > h) clinching[i] = buy(i, (rem[i] - h) / p);
    snap(clinching);
    if (supply - X <= 1e-9 || B === 0) return frames;
    let pn = p * (1 + eps);
    for (let i = 0; i < n; i++) if (rem[i] > 0 && lim[i] < pn) pn = lim[i];
    p = pn;
  }
  return frames;
}
