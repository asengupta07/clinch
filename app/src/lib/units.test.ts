import { describe, expect, it } from "vitest";
import {
  avgPrice,
  hookPriceToHuman,
  humanToRawPrice,
  invertRawPrice,
  orderParams,
  parseDecimal,
  rawToHumanPrice,
  reverseHookPriceToHuman,
  WAD,
} from "./units";

describe("parseDecimal", () => {
  it("parses and rejects", () => {
    expect(parseDecimal("1.5", 6)).toBe(1_500_000n);
    expect(parseDecimal("1,000", 6)).toBe(1_000_000_000n);
    expect(parseDecimal("", 6)).toBeNull();
    expect(parseDecimal(".", 6)).toBeNull();
    expect(parseDecimal("-1", 6)).toBeNull();
    expect(parseDecimal("1e5", 6)).toBeNull();
    expect(parseDecimal("0.1234567", 6)).toBeNull();
  });
});

describe("raw <-> human prices", () => {
  // base 18 decimals (CLNCH/WETH), quote 6 decimals (USDC)
  it("18-dec base, 6-dec quote (CLNCH in USDC, deploy script values)", () => {
    expect(humanToRawPrice("0.10", 18, 6)).toBe(100_000n); // reservePrice
    expect(humanToRawPrice("2", 18, 6)).toBe(2_000_000n); // maxPrice
    expect(humanToRawPrice("0.42", 18, 6)).toBe(420_000n); // seeded bid
    expect(rawToHumanPrice(100_000n, 18, 6)).toBeCloseTo(0.1, 12);
    expect(rawToHumanPrice(420_000n, 18, 6)).toBeCloseTo(0.42, 12);
  });
  it("18-dec base, 6-dec quote (WETH in USDC)", () => {
    expect(humanToRawPrice("3060", 18, 6)).toBe(3_060_000_000n);
    expect(rawToHumanPrice(3_060_000_000n, 18, 6)).toBe(3060);
  });
  it("6-dec base, 18-dec quote (WETH per USDC)", () => {
    // 1 USDC = 1/3000 WETH: raw = (1/3000) * 1e18 * 10^(18-6) = 1e30/3000
    const raw = humanToRawPrice("0.0005", 6, 18)!; // 0.0005 WETH per USDC
    expect(raw).toBe(5n * 10n ** 26n);
    expect(rawToHumanPrice(raw, 6, 18)).toBeCloseTo(0.0005, 15);
  });
  it("same decimals", () => {
    expect(humanToRawPrice("1.25", 18, 18)).toBe(1_250_000_000_000_000_000n);
    expect(rawToHumanPrice(WAD, 18, 18)).toBe(1);
  });
  it("rounds when the input is finer than raw precision", () => {
    // 18-dec base, 6-dec quote: raw precision is 1e-6 USDC per token
    expect(humanToRawPrice("0.1234567", 18, 6, "down")).toBe(123_456n);
    expect(humanToRawPrice("0.1234567", 18, 6, "up")).toBe(123_457n);
  });
  it("inverts", () => {
    expect(invertRawPrice(2n * WAD)).toBe(WAD / 2n);
    expect(invertRawPrice(3n * WAD, "down")).toBe(333_333_333_333_333_333n);
    expect(invertRawPrice(3n * WAD, "up")).toBe(333_333_333_333_333_334n);
  });
  it("average price from amounts", () => {
    expect(avgPrice(3_000_000_000n, 10n ** 18n, 18, 6)).toBe(3000);
  });
});

describe("orderParams / hookPriceToHuman, both token orderings", () => {
  const wethIs0 = { baseDecimals: 18, quoteDecimals: 6, baseIsToken0: true };
  const wethIs1 = { baseDecimals: 18, quoteDecimals: 6, baseIsToken0: false };

  it("WETH is token0: buy = sell token1 with a max token1/token0 price", () => {
    const o = orderParams("buy", "3060", wethIs0)!;
    expect(o.zeroForOne).toBe(false);
    expect(o.limit).toBe(3_060_000_000n); // matches SeedDemo's raw value
    expect(hookPriceToHuman(o.limit, wethIs0)).toBe(3060);
  });
  it("WETH is token0: sell = sell token0 with a min token1/token0 price", () => {
    const o = orderParams("sell", "2950", wethIs0)!;
    expect(o.zeroForOne).toBe(true);
    expect(o.limit).toBe(2_950_000_000n);
  });
  it("WETH is token1: buy = sell token0 (USDC) with a min WETH-per-USDC price", () => {
    const o = orderParams("buy", "3000", wethIs1)!;
    expect(o.zeroForOne).toBe(true);
    // SeedDemo: 1e18 * 1e18 / (3000e6) = 1e36/3e9
    expect(o.limit).toBe(10n ** 36n / 3_000_000_000n + 1n); // rounded UP (protects the buyer)
    expect(hookPriceToHuman(o.limit, wethIs1)!).toBeCloseTo(3000, 6);
    // the buyer never accepts more than 3000 USDC per WETH
    expect(hookPriceToHuman(o.limit, wethIs1)!).toBeLessThanOrEqual(3000);
  });
  it("WETH is token1: sell = sell token1 (WETH) with a max WETH-per-USDC price", () => {
    const o = orderParams("sell", "3000", wethIs1)!;
    expect(o.zeroForOne).toBe(false);
    expect(o.limit).toBe(10n ** 36n / 3_000_000_000n); // rounded DOWN (protects the seller)
    expect(hookPriceToHuman(o.limit, wethIs1)!).toBeGreaterThanOrEqual(3000);
  });
  it("reverse clock prices", () => {
    // pFinal of a sell-dominant batch is token0 per token1.
    // WETH token0: token0/token1 = WETH per USDC raw = 1e36 / 3000e6
    expect(reverseHookPriceToHuman(10n ** 36n / 3_000_000_000n, wethIs0)!).toBeCloseTo(3000, 6);
    // WETH token1: token0/token1 = USDC per WETH raw = 3000e6
    expect(reverseHookPriceToHuman(3_000_000_000n, wethIs1)).toBe(3000);
  });
  it("zero limit means any price", () => {
    expect(hookPriceToHuman(0n, wethIs0)).toBeNull();
  });
  it("6-dec base, 18-dec quote, base token0", () => {
    const m = { baseDecimals: 6, quoteDecimals: 18, baseIsToken0: true };
    const o = orderParams("buy", "0.0005", m)!;
    expect(o.zeroForOne).toBe(false);
    expect(o.limit).toBe(5n * 10n ** 26n);
    expect(hookPriceToHuman(o.limit, m)!).toBeCloseTo(0.0005, 15);
  });
  it("6-dec base, 18-dec quote, base token1", () => {
    const m = { baseDecimals: 6, quoteDecimals: 18, baseIsToken0: false };
    const o = orderParams("sell", "0.0005", m)!;
    expect(o.zeroForOne).toBe(false);
    expect(hookPriceToHuman(o.limit, m)!).toBeCloseTo(0.0005, 15);
  });
  it("rejects bad input", () => {
    expect(orderParams("buy", "abc", wethIs0)).toBeNull();
    expect(orderParams("buy", "0", wethIs1)).toBeNull();
  });
});

import { dominantSide, fillPrice, finalPriceHuman, orderSide } from "./market";

describe("market language helpers", () => {
  const wethIs0 = { baseDecimals: 18, quoteDecimals: 6, baseIsToken0: true };
  const wethIs1 = { baseDecimals: 18, quoteDecimals: 6, baseIsToken0: false };
  it("order side", () => {
    expect(orderSide(false, true)).toBe("buy"); // sells token1 (USDC) for WETH
    expect(orderSide(true, true)).toBe("sell");
    expect(orderSide(true, false)).toBe("buy"); // sells token0 (USDC) for WETH
    expect(orderSide(false, false)).toBe("sell");
  });
  it("dominant side", () => {
    expect(dominantSide(true, true)).toBe("buy");
    expect(dominantSide(false, true)).toBe("sell");
    expect(dominantSide(true, false)).toBe("sell");
    expect(dominantSide(false, false)).toBe("buy");
  });
  it("final price in both clocks", () => {
    // seeded batch: buyers dominant, pFinal 3015e6 token1/token0, WETH token0
    expect(finalPriceHuman(3_015_000_000n, true, wethIs0)).toBe(3015);
    // sellers of token0 dominant: reverse clock token0/token1. WETH token1 -> USDC per WETH directly
    expect(finalPriceHuman(3_015_000_000n, false, wethIs1)).toBe(3015);
  });
  it("fill price", () => {
    // seeded order 0: spent 30,000 USDC, received 9.9576 WETH
    expect(fillPrice("buy", 30_000_000_000n, 9_957_607_362_511_422_162n, wethIs0)!).toBeCloseTo(3012.77, 1);
    expect(fillPrice("sell", 4n * 10n ** 18n, 12_000_000_000n, wethIs0)).toBe(3000);
  });
});
