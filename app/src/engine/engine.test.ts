import { describe, expect, it } from "vitest";
import { CPPool, cpChordTarget, fixedTarget, run as frun } from "./float";
import { fixedSupply, isqrt, MAX_UINT256, mulDivUp, run, twoSided, WAD, type TraceStep } from "./wad";
import { shadedOutcome, whaleOutcome } from "./baselines";

describe("bigint primitives", () => {
  it("isqrt floors", () => {
    for (const x of [0n, 1n, 2n, 3n, 4n, 15n, 16n, 17n, 10n ** 36n, 10n ** 36n + 1n, (1n << 255n) + 12345n]) {
      const r = isqrt(x);
      expect(r * r <= x).toBe(true);
      expect((r + 1n) * (r + 1n) > x).toBe(true);
    }
  });
  it("mulDivUp ceils", () => {
    expect(mulDivUp(10n, 1n, 3n)).toBe(4n);
    expect(mulDivUp(9n, 1n, 3n)).toBe(3n);
  });
});

describe("AMM path: single bidder, infinite limit, x0 = y0 = 1000, budget 100", () => {
  it("float engine matches a plain constant-product swap (~90.909 X)", () => {
    const pool = new CPPool(1000, 1000);
    const r = frun([[Infinity, 100]], cpChordTarget(pool), 1, 1e-3);
    expect(r.Y).toBeCloseTo(100, 9);
    expect(r.X).toBeCloseTo(pool.Cinv(100), 2); // 90.909...
    expect(r.X).toBeCloseTo(90.90888225896218, 9); // research/clinch/engine.py
    expect(r.X).toBeLessThanOrEqual(pool.Cinv(100)); // never better than the curve
  });
  it("WAD engine matches research/clinch/wad.py bit for bit", () => {
    const r = run(
      [{ limit: MAX_UINT256, budget: 100n * WAD }],
      { kind: 1, S0: 0n, x0: 1000n * WAD, y0: 1000n * WAD, p0: WAD, M: 0n },
      { eps: 10n ** 15n, pMax: 0n, maxSteps: 10_000 },
    );
    expect(r.X).toBe(90908882250531151269n);
    expect(r.Y).toBe(100n * WAD);
    expect(r.pFinal).toBe(1210343935724110096n);
    expect(r.steps).toBe(192);
  });
});

describe("fixed supply: two bidders", () => {
  // supply 10 at reserve 1; A (limit 2, budget 10), B (limit 4, budget 30), eps 1%
  it("float engine", () => {
    const r = frun([[2, 10], [4, 30]], fixedTarget(10), 1, 1e-2, { fixedSupply: true });
    expect(r.x[0]).toBeCloseTo(0, 12);
    expect(r.x[1]).toBeCloseTo(10, 12);
    expect(r.y[1]).toBeCloseTo(16.96596010178918, 9);
    expect(r.pFinal).toBe(2);
  });
  it("WAD engine matches wad.py, and the trace ends at the result", () => {
    const trace: TraceStep[] = [];
    const r = run(
      [{ limit: 2n * WAD, budget: 10n * WAD }, { limit: 4n * WAD, budget: 30n * WAD }],
      fixedSupply(10n * WAD, WAD),
      { eps: 10n ** 16n, pMax: 0n, maxSteps: 10_000 },
      trace,
    );
    expect(r.qty).toEqual([0n, 10n * WAD]);
    expect(r.paid).toEqual([0n, 16965960101789182841n]);
    expect(r.pFinal).toBe(2n * WAD);
    expect(r.steps).toBe(71);
    expect(trace.length).toBe(71);
    const last = trace[trace.length - 1];
    expect(last.final).toBe(true);
    expect(last.qty).toEqual(r.qty);
    expect(trace.some((t) => t.exited.includes(0))).toBe(true); // A drops out at its limit
    // prices never fall along the ladder
    for (let i = 1; i < trace.length; i++) expect(trace[i].p >= trace[i - 1].p).toBe(true);
  });
  it("order of bids does not matter", () => {
    const prm = { eps: 10n ** 16n, pMax: 0n, maxSteps: 10_000 };
    const a = run([{ limit: 2n * WAD, budget: 10n * WAD }, { limit: 4n * WAD, budget: 30n * WAD }], fixedSupply(10n * WAD, WAD), prm);
    const b = run([{ limit: 4n * WAD, budget: 30n * WAD }, { limit: 2n * WAD, budget: 10n * WAD }], fixedSupply(10n * WAD, WAD), prm);
    expect(b.qty).toEqual([a.qty[1], a.qty[0]]);
    expect(b.paid).toEqual([a.paid[1], a.paid[0]]);
  });
});

describe("launch on the seeded demo chain state (static snapshot)", () => {
  // ClinchLaunch: supply 1,000,000 CLNCH (18 dp), USDC (6 dp), reserve $0.10, ceiling $2, eps 1%
  const bids = [
    [420_000n, 60_000_000_000n],
    [300_000n, 30_000_000_000n],
    [650_000n, 45_000_000_000n],
    [220_000n, 20_000_000_000n],
    [180_000n, 15_000_000_000n],
    [550_000n, 150_000_000_000n],
  ].map(([limit, budget]) => ({ limit, budget }));
  it("matches the chain's previewSettle() exactly", () => {
    const r = run(bids, fixedSupply(1_000_000n * WAD, 100_000n), { eps: 10n ** 16n, pMax: 2_000_000n, maxSteps: 20_000 });
    expect(r.qty).toEqual([199847301914007296325462n, 0n, 147940291487827157426505n, 0n, 0n, 652212406598165546248033n]);
    expect(r.paid).toEqual([57509331230n, 0n, 45000000000n, 0n, 0n, 150000000000n]);
    expect(r.X).toBe(1_000_000n * WAD);
    expect(r.Y).toBe(252509331230n);
    expect(r.pFinal).toBe(420_000n);
    expect(r.steps).toBe(148);
  });
});

describe("two-sided batch on the seeded WETH/USDC pool (static snapshot)", () => {
  // Snapshot taken from the first deployment's previewSettle(). The minority side is paid at the
  // spot clock (budget * p0 / 1e18), exactly as ClinchEngine does.
  it("matches the hook's previewSettle()", () => {
    const orders = [
      { zeroForOne: false, limit: 3060000000n, budget: 30000000000n },
      { zeroForOne: false, limit: 3015000000n, budget: 18000000000n },
      { zeroForOne: false, limit: 3120000000n, budget: 12000000000n },
      { zeroForOne: true, limit: 2950000000n, budget: 4000000000000000000n },
      { zeroForOne: true, limit: 2990000000n, budget: 2500000000000000000n },
    ];
    const t = twoSided(orders, 998999999999999986592n, 2996999999999n, { eps: 10n ** 15n, pMax: 0n, maxSteps: 4000 });
    expect(t.buyersDominant).toBe(true);
    expect(t.received).toEqual([9957607362511422162n, 608781381269672364n, 3980099502487562189n, 11999999996n, 7499999997n]);
    expect(t.spent).toEqual([30000000000n, 1835475865n, 12000000000n, 4000000000000000000n, 2500000000000000000n]);
    expect(t.dominantBought).toBe(14546488246268656715n);
    expect(t.minoritySupply).toBe(6500000000000000000n);
    expect(t.poolIn).toBe(24335475872n);
    expect(t.pFinal).toBe(3015000000n);
    expect(t.steps).toBe(6);
  });
});

describe("Whale Lab baselines reproduce research/results/baselines.json", () => {
  it("one honest whale wallet", () => {
    expect(whaleOutcome("clinch", 1).util).toBeCloseTo(679.7, 0);
    expect(whaleOutcome("uniform", 1).util).toBeCloseTo(275.5, 0);
    expect(whaleOutcome("uniform_cap", 1).util).toBeCloseTo(49.3, 0);
    expect(whaleOutcome("fixed_cap", 1).util).toBeCloseTo(40.0, 0);
  });
  it("splitting", () => {
    expect(whaleOutcome("clinch", 100).util).toBeCloseTo(270.4, 0);
    expect(whaleOutcome("clinch", 50).util).toBeCloseTo(275.7, 0);
    expect(whaleOutcome("uniform", 50).util).toBeCloseTo(275.5, 0);
    expect(whaleOutcome("uniform_cap", 10).util).toBeCloseTo(360.7, 0);
    expect(whaleOutcome("fixed_cap", 50).util).toBeCloseTo(601.9, 0);
    expect(whaleOutcome("clinch", 1).x / 1000).toBeCloseTo(0.872, 3);
    expect(whaleOutcome("uniform", 1).x / 1000).toBeCloseTo(0.71, 2);
  });
  it("shading: uniform price rewards it (+44%), Clinch does not", () => {
    const truthU = shadedOutcome("uniform", 1, 1).util;
    const shadedU = shadedOutcome("uniform", 0.8, 0.675).util;
    expect(shadedU).toBeCloseTo(396, -1);
    expect(shadedU / truthU - 1).toBeGreaterThan(0.43);
    expect(shadedU / truthU - 1).toBeLessThan(0.45);
    const truthC = shadedOutcome("clinch", 1, 1).util;
    for (const [v, b] of [[0.8, 0.675], [0.9, 1], [1, 0.5], [0.7, 0.8], [1.2, 1]]) {
      expect(shadedOutcome("clinch", v, b).util).toBeLessThanOrEqual(truthC + 1e-6 * 1500);
    }
  });
});
