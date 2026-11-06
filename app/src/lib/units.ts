/**
 * Price and amount unit helpers.
 *
 * On-chain prices are WAD (1e18-scaled) ratios of RAW token units:
 *   raw = (quote raw units per base raw unit) * 1e18
 * so for a human price P (quote per base, in whole tokens):
 *   raw = P * 1e18 * 10^(quoteDecimals - baseDecimals)
 *   P   = raw / 1e18 * 10^(baseDecimals - quoteDecimals)
 *
 * Hook limits are always token1 per token0. A market is presented as "quote per base"
 * (e.g. USDC per WETH) whichever of the two is token0.
 */
import { formatUnits, parseUnits } from "viem";

export const WAD = 10n ** 18n;
const WAD2 = WAD * WAD;

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** Parse a user-typed decimal string. Returns null if it is not a valid non-negative number. */
export function parseDecimal(s: string, decimals: number): bigint | null {
  const t = s.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [, frac = ""] = t.split(".");
  if (frac.length > decimals) return null;
  try {
    return parseUnits(t, decimals);
  } catch {
    return null;
  }
}

/**
 * Human price string (quote per base) -> raw WAD price (quote raw per base raw).
 * `round` controls the direction when the exact value is not representable.
 */
export function humanToRawPrice(human: string, baseDecimals: number, quoteDecimals: number, round: "down" | "up" = "down"): bigint | null {
  const e = 18 + quoteDecimals - baseDecimals;
  if (e >= 0) {
    // exact when the typed precision fits; otherwise reject so we never silently round
    const v = parseDecimal(human, e);
    if (v !== null) return v;
    // too many decimals for exact representation: parse at 36 dp then scale with rounding
    const hi = parseDecimal(human, 36);
    if (hi === null) return null;
    const d = pow10(36 - e);
    const q = hi / d;
    return round === "up" && hi % d !== 0n ? q + 1n : q;
  }
  const v = parseDecimal(human, 36);
  if (v === null) return null;
  const d = pow10(36 - e);
  const q = v / d;
  return round === "up" && v % d !== 0n ? q + 1n : q;
}

/** Raw WAD price (quote raw per base raw) -> human number (quote per base). */
export function rawToHumanPrice(raw: bigint, baseDecimals: number, quoteDecimals: number): number {
  // raw / 1e18 * 10^(base - quote) computed as a decimal string to keep precision
  const shift = 18 - (baseDecimals - quoteDecimals);
  if (shift >= 0) return Number(formatUnits(raw, shift));
  return Number(raw * pow10(-shift));
}

/** Invert a raw WAD price: token1/token0 <-> token0/token1. floor or ceil. */
export function invertRawPrice(raw: bigint, round: "down" | "up" = "down"): bigint {
  if (raw === 0n) throw new Error("cannot invert zero price");
  const q = WAD2 / raw;
  return round === "up" && WAD2 % raw !== 0n ? q + 1n : q;
}

export interface MarketOrientation {
  /** decimals of the base asset (the thing being bought/sold, e.g. WETH) */
  baseDecimals: number;
  /** decimals of the quote asset (what prices are quoted in, e.g. USDC) */
  quoteDecimals: number;
  /** true if the base asset is the pool's token0 */
  baseIsToken0: boolean;
}

export type Side = "buy" | "sell";

/**
 * Convert a market-language order (buy/sell base at a human quote-per-base price) into the
 * hook's (zeroForOne, raw token1/token0 limit).
 *
 * - buy base  = sell quote; the price is the MAXIMUM quote per base the user accepts.
 * - sell base = sell base;  the price is the MINIMUM quote per base the user accepts.
 *
 * Rounding always protects the user: a buyer's maximum never rounds up past what they typed,
 * a seller's minimum never rounds down below it.
 */
export function orderParams(side: Side, humanPrice: string, m: MarketOrientation): { zeroForOne: boolean; limit: bigint } | null {
  const sellsToken0 = side === "buy" ? !m.baseIsToken0 : m.baseIsToken0;
  const zeroForOne = sellsToken0;
  if (m.baseIsToken0) {
    // token1/token0 = quote per base: same orientation as the human price.
    // buyer (zeroForOne=false) max -> round down; seller (zeroForOne=true) min -> round up.
    const raw = humanToRawPrice(humanPrice, m.baseDecimals, m.quoteDecimals, side === "buy" ? "down" : "up");
    if (raw === null) return null;
    return { zeroForOne, limit: raw };
  }
  // token1/token0 = base per quote. Express the user's price in that orientation by inverting.
  // Compute the exact quote-per-base raw at high precision, then invert with protective rounding.
  // buy base  -> sells token0 (quote): limit is a MIN of base-per-quote = 1/P_max -> round UP
  // sell base -> sells token1 (base):  limit is a MAX of base-per-quote = 1/P_min -> round DOWN
  const direct = humanToRawPrice(humanPrice, m.baseDecimals, m.quoteDecimals, side === "buy" ? "down" : "up");
  if (direct === null || direct === 0n) return null;
  const limit = invertRawPrice(direct, side === "buy" ? "up" : "down");
  return { zeroForOne, limit };
}

/** Raw token1/token0 hook price -> human quote per base for this market. 0 -> null. */
export function hookPriceToHuman(raw: bigint, m: MarketOrientation): number | null {
  if (raw === 0n) return null;
  if (m.baseIsToken0) return rawToHumanPrice(raw, m.baseDecimals, m.quoteDecimals);
  // raw is base-per-quote with base = token1: human(base per quote) then invert
  const basePerQuote = rawToHumanPrice(raw, m.quoteDecimals, m.baseDecimals);
  return basePerQuote === 0 ? null : 1 / basePerQuote;
}

/**
 * Raw token0/token1 price (the hook's REVERSE clock, used for pFinal when sellers of token0
 * are dominant) -> human quote per base.
 */
export function reverseHookPriceToHuman(raw: bigint, m: MarketOrientation): number | null {
  if (raw === 0n) return null;
  // raw is token0 per token1
  if (m.baseIsToken0) {
    // base per quote
    const basePerQuote = rawToHumanPrice(raw, m.quoteDecimals, m.baseDecimals);
    return basePerQuote === 0 ? null : 1 / basePerQuote;
  }
  // token0 = quote, token1 = base: quote per base directly
  return rawToHumanPrice(raw, m.baseDecimals, m.quoteDecimals);
}

/** Ratio of two raw amounts expressed as a human price (quote per base). */
export function avgPrice(quoteRaw: bigint, baseRaw: bigint, baseDecimals: number, quoteDecimals: number): number | null {
  if (baseRaw === 0n) return null;
  return Number(formatUnits(quoteRaw, quoteDecimals)) / Number(formatUnits(baseRaw, baseDecimals));
}

/** Raw amount -> human number (for display and charts only). */
export function toNum(raw: bigint, decimals: number): number {
  return Number(formatUnits(raw, decimals));
}
