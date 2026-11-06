/**
 * Launch baselines from research/experiments/exp_baselines.py, ported exactly, plus the
 * whale setup used for the hero figure. The 30 honest bidders are the exact values drawn by
 * Python's random.Random(7) in that script (copied from research/results/baselines.json), so
 * the Whale Lab reproduces the research numbers.
 */
import { fixedTarget, run } from "./float";

export const SUPPLY = 1000;
export const P_RES = 1.0;
export const WHALE_VALUE = 2.5;
export const WHALE_BUDGET = 1500;
export const CAP_TOKENS = 40;
export const FIXED_PRICE = 1.5;
export const CLINCH_EPS = 1e-3;

/** (limit, budget) for the 30 honest bidders, from research/results/baselines.json "setup.honest". */
export const HONEST: ReadonlyArray<readonly [number, number]> = [
  [1.782898976699692, 29.050950435470114],
  [2.371682051471737, 24.346177200052566],
  [2.1645876077520407, 41.94133501475513],
  [1.3043980645944722, 50.44614399136522],
  [1.2674921851955727, 46.01874101974315],
  [1.3257397624343141, 25.4427808006319],
  [1.9641345404565251, 69.61112748032228],
  [1.422843530069362, 33.39433787642087],
  [2.3293798003300608, 76.86253654742035],
  [2.2387853075114976, 43.800828479046814],
  [2.957259190067256, 22.794960837065375],
  [2.745243226287623, 37.37655717990057],
  [1.4596591500433875, 27.067534284702102],
  [1.755267283383482, 68.96758154720189],
  [1.5253074838630873, 54.896009819747974],
  [2.3500442440671314, 42.34385256354388],
  [2.185940038277204, 23.76733849839939],
  [1.3072821059392188, 32.357522769159594],
  [2.424719951727215, 45.65553834016417],
  [1.7654649066782246, 55.13371181045832],
  [2.0157318774673953, 37.98601981182094],
  [2.6298830667404838, 61.93966602377428],
  [1.6393737192998752, 54.46542261552026],
  [2.1453537068606128, 72.50824973440574],
  [2.5130015209905916, 37.27626589341119],
  [2.9643147254866475, 27.083946695297726],
  [1.9526210792134089, 65.42845577391496],
  [1.4735721623889084, 49.33778602854834],
  [1.2705730626853877, 60.09295139206371],
  [2.5762275591830637, 54.381556416643036],
];

type Bids = ReadonlyArray<readonly [number, number]>;

/** Uniform-price clearing with budget bids: demand_i(p) = budget/p for p <= limit (optionally capped). */
export function uniformClear(bids: Bids, supply: number, cap?: number): { p: number; d: number[] } {
  const demand = (p: number) =>
    bids.map(([v, q]) => {
      let di = p <= v ? q / p : 0;
      if (cap !== undefined) di = Math.min(di, cap);
      return di;
    });
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  let lo = P_RES;
  let hi = 1e6;
  if (sum(demand(lo)) <= supply) return { p: lo, d: demand(lo) };
  for (let k = 0; k < 200; k++) {
    const mid = Math.sqrt(lo * hi);
    if (sum(demand(mid)) > supply) lo = mid;
    else hi = mid;
  }
  const p = hi;
  let d = demand(p);
  const dl = demand(lo);
  const left = supply - sum(d);
  const extra = dl.map((a, i) => Math.max(0, a - d[i]));
  const se = sum(extra);
  if (se > 0 && left > 0) d = d.map((a, i) => a + (left * extra[i]) / se);
  return { p, d };
}

/** Fixed price, per-wallet cap, pro-rata if oversubscribed (typical IDO). */
export function fixedCapSale(bids: Bids, supply: number, price: number, cap: number): { p: number; d: number[] } {
  let d = bids.map(([v, q]) => (v >= price ? Math.min(q / price, cap) : 0));
  const tot = d.reduce((s, v) => s + v, 0);
  if (tot > supply) d = d.map((x) => (x * supply) / tot);
  return { p: price, d };
}

export type Mechanism = "clinch" | "uniform" | "uniform_cap" | "fixed_cap";

export interface WhaleOutcome {
  /** tokens the whale's wallets receive in total */
  x: number;
  /** quote the whale pays in total */
  paid: number;
  /** utility measured with the TRUE value: V * x - paid */
  util: number;
  /** clearing / final price */
  price: number;
}

/**
 * Whale outcome. `split` overrides the default even split; each element is the (reported limit,
 * budget) of one whale wallet. Utility always uses the whale's true value WHALE_VALUE.
 */
export function whaleOutcome(mech: Mechanism, N: number, split?: Bids): WhaleOutcome {
  const s: Bids = split ?? Array.from({ length: N }, () => [WHALE_VALUE, WHALE_BUDGET / N] as const);
  const bids = [...s, ...HONEST];
  const k = s.length;
  let x: number;
  let y: number;
  let price: number;
  if (mech === "clinch") {
    const r = run(bids, fixedTarget(SUPPLY), P_RES, CLINCH_EPS, { fixedSupply: true });
    x = r.x.slice(0, k).reduce((a, b) => a + b, 0);
    y = r.y.slice(0, k).reduce((a, b) => a + b, 0);
    price = r.pFinal;
  } else if (mech === "uniform" || mech === "uniform_cap") {
    const { p, d } = uniformClear(bids, SUPPLY, mech === "uniform_cap" ? CAP_TOKENS : undefined);
    x = d.slice(0, k).reduce((a, b) => a + b, 0);
    y = x * p;
    price = p;
  } else {
    const { p, d } = fixedCapSale(bids, SUPPLY, FIXED_PRICE, CAP_TOKENS);
    x = d.slice(0, k).reduce((a, b) => a + b, 0);
    y = x * p;
    price = p;
  }
  return { x, paid: y, util: WHALE_VALUE * x - y, price };
}

/** A single whale wallet that reports a shaded value and budget (fractions of the truth). */
export function shadedOutcome(mech: "clinch" | "uniform", valueFrac: number, budgetFrac: number): WhaleOutcome {
  return whaleOutcome(mech, 1, [[WHALE_VALUE * valueFrac, WHALE_BUDGET * budgetFrac]]);
}
