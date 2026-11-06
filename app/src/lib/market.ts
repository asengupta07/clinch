import { hookPriceToHuman, reverseHookPriceToHuman, toNum, type MarketOrientation } from "./units";

/** Market-language side of a hook order. */
export function orderSide(zeroForOne: boolean, baseIsToken0: boolean): "buy" | "sell" {
  // zeroForOne sells token0. If base is token0 that is a sell of base; otherwise it sells the quote, i.e. buys base.
  return zeroForOne === baseIsToken0 ? "sell" : "buy";
}

/** Which market side the hook's `buyersDominant` flag refers to. */
export function dominantSide(buyersDominant: boolean, baseIsToken0: boolean): "buy" | "sell" {
  // buyersDominant: token1 sellers (buyers of token0) dominate.
  return buyersDominant === baseIsToken0 ? "buy" : "sell";
}

/** The dominant side's final clock price, as quote per base. */
export function finalPriceHuman(pFinal: bigint, buyersDominant: boolean, m: MarketOrientation): number | null {
  return buyersDominant ? hookPriceToHuman(pFinal, m) : reverseHookPriceToHuman(pFinal, m);
}

/**
 * Average execution price (quote per base) of a fill: `spent` is in the order's sold token,
 * `received` in the other.
 */
export function fillPrice(side: "buy" | "sell", spent: bigint, received: bigint, m: MarketOrientation): number | null {
  const base = side === "buy" ? received : spent;
  const quote = side === "buy" ? spent : received;
  if (base === 0n) return null;
  return toNum(quote, m.quoteDecimals) / toNum(base, m.baseDecimals);
}

/** Decimals of the token an order sells / receives. */
export function soldDecimals(side: "buy" | "sell", m: MarketOrientation) {
  return side === "buy" ? m.quoteDecimals : m.baseDecimals;
}
export function boughtDecimals(side: "buy" | "sell", m: MarketOrientation) {
  return side === "buy" ? m.baseDecimals : m.quoteDecimals;
}
