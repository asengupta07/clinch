import { fixedSupply, LAUNCH_MAX_STEPS, run, type Result, type TraceStep } from "../engine/wad";

export interface LaunchParamsLike {
  supply: bigint;
  reservePrice: bigint;
  maxPrice: bigint;
  eps: bigint;
}

export interface BidLike {
  limit: bigint;
  budget: bigint;
}

/** Run the launch auction exactly as ClinchLaunch.settle()/previewSettle() would. */
export function runLaunch(p: LaunchParamsLike, bids: readonly BidLike[], trace?: TraceStep[]): Result {
  return run(
    bids.map((b) => ({ limit: b.limit, budget: b.budget })),
    fixedSupply(p.supply, p.reservePrice),
    { eps: p.eps, pMax: p.maxPrice, maxSteps: LAUNCH_MAX_STEPS },
    trace,
  );
}

export interface ChainOutcome {
  qty: readonly bigint[];
  paid: readonly bigint[];
  X: bigint;
  Y: bigint;
  pFinal: bigint;
}

export interface Verification {
  ok: boolean;
  /** largest per-bid quantity difference, as a fraction of supply */
  maxQtyErr: number;
  /** largest per-bid payment difference in raw quote units */
  maxPaidErr: bigint;
  priceMatch: boolean;
  details: string[];
}

/**
 * Compare a locally computed outcome with the chain's. The engines are the same integer
 * algorithm, so they should agree exactly; we accept rounding of at most 1e-12 of supply in
 * quantity and 2 raw units of payment, and an exact final price.
 */
export function verifyOutcome(local: Result, chain: ChainOutcome, supply: bigint): Verification {
  const details: string[] = [];
  let maxQ = 0n;
  let maxP = 0n;
  const n = Math.max(local.qty.length, chain.qty.length);
  for (let i = 0; i < n; i++) {
    const dq = abs((local.qty[i] ?? 0n) - (chain.qty[i] ?? 0n));
    const dp = abs((local.paid[i] ?? 0n) - (chain.paid[i] ?? 0n));
    if (dq > maxQ) maxQ = dq;
    if (dp > maxP) maxP = dp;
    if (dq > 0n || dp > 0n) details.push(`bid ${i}: qty diff ${dq}, paid diff ${dp}`);
  }
  const maxQtyErr = supply > 0n ? Number(maxQ) / Number(supply) : 0;
  const priceMatch = local.pFinal === chain.pFinal;
  if (!priceMatch) details.push(`final price ${local.pFinal} vs chain ${chain.pFinal}`);
  if (abs(local.X - chain.X) > 0n) details.push(`sold ${local.X} vs chain ${chain.X}`);
  if (abs(local.Y - chain.Y) > 0n) details.push(`raised ${local.Y} vs chain ${chain.Y}`);
  const ok = priceMatch && maxQtyErr <= 1e-12 && maxP <= 2n && abs(local.X - chain.X) * 10n ** 12n <= supply && abs(local.Y - chain.Y) <= 2n * BigInt(n);
  return { ok, maxQtyErr, maxPaidErr: maxP, priceMatch, details };
}

function abs(x: bigint) {
  return x < 0n ? -x : x;
}
