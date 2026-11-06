import type { ReactNode } from "react";
import { Badge, cx } from "../../components/ui";
import type { TokenMeta } from "../../hooks/data";
import { fmt, fmtAmount, fmtPrice } from "../../lib/format";
import { hookPriceToHuman, toNum, type MarketOrientation } from "../../lib/units";

export interface DepthRow {
  i: number;
  side: "buy" | "sell";
  owner: string;
  limit: bigint;
  budget: bigint;
  spent?: bigint;
  received?: bigint;
  mine: boolean;
}

/**
 * Two-sided depth around spot: buyers' limits extend left of the spine, sellers' right.
 * Bar length is the escrowed size valued at spot; the solid part is the estimated share
 * of it that trades if the batch settled now. On the dominant side, an amber line marks
 * where the estimated final price falls among the limits.
 */
export function BatchDepth({
  rows,
  o,
  base,
  quote,
  spot,
  dom,
  pF,
}: {
  rows: DepthRow[];
  o: MarketOrientation;
  base: TokenMeta;
  quote: TokenMeta;
  spot: number | null;
  dom: "buy" | "sell" | null;
  pF: number | null;
}) {
  const value = (r: DepthRow) => (r.side === "buy" ? toNum(r.budget, o.quoteDecimals) : toNum(r.budget, o.baseDecimals) * (spot ?? 0));
  const max = Math.max(0, ...rows.map(value)) || 1;
  const lim = (r: DepthRow) => hookPriceToHuman(r.limit, o);
  const dist = (r: DepthRow) => {
    const l = lim(r);
    if (l === null || spot === null) return Infinity;
    return Math.abs(l - spot);
  };
  // Closest to spot first, like an order book.
  const buys = rows.filter((r) => r.side === "buy").sort((a, b) => dist(a) - dist(b));
  const sells = rows.filter((r) => r.side === "sell").sort((a, b) => dist(a) - dist(b));
  const buyTotal = buys.reduce((s, r) => s + value(r), 0);
  const sellTotal = sells.reduce((s, r) => s + value(r), 0);
  const sideMax = Math.max(buyTotal, sellTotal) || 1;

  /** index in the sorted list after which the clock stops, for the dominant side */
  const stopAfter = (list: DepthRow[], side: "buy" | "sell") => {
    if (dom !== side || pF === null) return -1;
    let k = 0;
    for (const r of list) {
      const l = lim(r);
      if (l === null) break;
      if (side === "buy" ? l < pF : l > pF) k++;
      else break;
    }
    return k;
  };

  const column = (list: DepthRow[], side: "buy" | "sell") => {
    const stop = stopAfter(list, side);
    const right = side === "buy";
    const items: ReactNode[] = [];
    list.forEach((r, idx) => {
      if (idx === stop) items.push(<PriceLine key="pf" right={right} pF={pF} quote={quote.symbol} />);
      items.push(bar(r, right));
    });
    if (stop === list.length && list.length > 0) items.push(<PriceLine key="pf" right={right} pF={pF} quote={quote.symbol} />);
    return (
      <ul className={cx("flex flex-col", right ? "items-stretch pr-3 sm:pr-5" : "pl-3 sm:pl-5")} aria-label={side === "buy" ? "Buy orders" : "Sell orders"}>
        {list.length === 0 ? (
          <li className={cx("py-3 text-[12.5px] text-ink-3", right && "text-right")}>No {side === "buy" ? "buyers" : "sellers"} yet</li>
        ) : (
          items
        )}
      </ul>
    );
  };

  const bar = (r: DepthRow, right: boolean) => {
    const l = lim(r);
    const w = Math.max(4, (value(r) / max) * 100);
    const filled = r.spent !== undefined && r.budget > 0n ? Number((r.spent * 10_000n) / r.budget) / 10_000 : 0;
    const off = l !== null && spot ? (l - spot) / spot : null;
    const soldDec = r.side === "buy" ? o.quoteDecimals : o.baseDecimals;
    const soldSym = r.side === "buy" ? quote.symbol : base.symbol;
    return (
      <li key={r.i} className={cx("flex flex-col gap-1.5 py-2.5", right && "items-end text-right")}>
        <div className={cx("flex flex-wrap items-baseline gap-x-2 gap-y-0.5", right && "justify-end")}>
          {r.mine && <Badge tone="accent" className="h-5 px-1.5 text-[11px]">you</Badge>}
          <span className="num text-[13px] text-ink">
            {l === null ? "any price" : `${r.side === "buy" ? "≤" : "≥"} ${fmtPrice(l, quote.symbol)}`}
          </span>
          {off !== null && (
            <span className="num text-[11.5px] text-ink-3">
              {off >= 0 ? "+" : "-"}
              {fmt(Math.abs(off) * 100, { max: 2, min: 2 })}%
            </span>
          )}
        </div>
        <div className="relative h-2 w-full">
          <div
            className={cx(
              "absolute inset-y-0 overflow-hidden rounded-full ring-1 ring-inset transition-[width] duration-200 ease-[var(--ease-out-quint)]",
              right ? "right-0" : "left-0",
              r.mine ? "bg-accent-soft ring-accent-line" : "bg-surface-3 ring-line-strong",
            )}
            style={{ width: `${w}%` }}
          >
            <div
              className={cx(
                "absolute inset-y-0 rounded-full transition-[width] duration-200 ease-[var(--ease-out-quint)]",
                right ? "right-0" : "left-0",
                r.mine ? "bg-accent" : "bg-ink-3",
              )}
              style={{ width: `${filled * 100}%` }}
            />
          </div>
        </div>
        <div className="num text-[11.5px] text-ink-3">
          {fmtAmount(r.budget, soldDec)} {soldSym}
          {r.spent !== undefined && <span>, est. {Math.round(filled * 100)}% trades</span>}
        </div>
      </li>
    );
  };

  return (
    <div>
      {/* Totals: how heavy each side is at spot. */}
      <div className="grid grid-cols-2 text-[12.5px]">
        <div className="pr-3 text-right sm:pr-5">
          <div className="text-ink-2">
            Buyers{dom === "buy" && <span className="text-price">, dominant</span>}
          </div>
          <div className="num mt-0.5 text-ink-3">
            {fmt(buyTotal)} {quote.symbol}
          </div>
        </div>
        <div className="pl-3 sm:pl-5">
          <div className="text-ink-2">
            Sellers{dom === "sell" && <span className="text-price">, dominant</span>}
          </div>
          <div className="num mt-0.5 text-ink-3">
            {fmtAmount(sells.reduce((s, r) => s + r.budget, 0n), o.baseDecimals)} {base.symbol}
            {spot !== null && sellTotal > 0 && <span className="hidden sm:inline">, {fmtPrice(sellTotal, quote.symbol)}</span>}
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2" role="img" aria-label={`Buy demand ${fmt(buyTotal)} ${quote.symbol}, sell supply worth ${fmt(sellTotal)} ${quote.symbol} at spot`}>
        <div className="flex justify-end pr-px">
          <span
            className={cx("h-1.5 rounded-l-full transition-[width] duration-200 ease-[var(--ease-out-quint)]", dom === "buy" ? "bg-price" : "bg-ink-3")}
            style={{ width: `${(buyTotal / sideMax) * 100}%` }}
          />
        </div>
        <div className="flex pl-px">
          <span
            className={cx("h-1.5 rounded-r-full transition-[width] duration-200 ease-[var(--ease-out-quint)]", dom === "sell" ? "bg-price" : "bg-ink-3")}
            style={{ width: `${(sellTotal / sideMax) * 100}%` }}
          />
        </div>
      </div>

      {/* Spine at spot */}
      <div className="relative mt-4">
        <div aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line-strong" />
        <div className="relative flex justify-center">
          <span className="num rounded-full bg-surface px-2.5 py-0.5 text-[11.5px] text-ink-2 ring-1 ring-inset ring-line-strong">
            spot {fmtPrice(spot, quote.symbol)}
          </span>
        </div>
        <div className="relative grid grid-cols-2 pt-1">
          {column(buys, "buy")}
          {column(sells, "sell")}
        </div>
      </div>
    </div>
  );
}

function PriceLine({ right, pF, quote }: { right: boolean; pF: number | null; quote: string }) {
  return (
    <li className={cx("flex items-center gap-2 py-1.5", right ? "flex-row-reverse" : "")}>
      <span aria-hidden className="h-px flex-1 border-t border-dashed border-price/60" />
      <span className="num shrink-0 text-[11.5px] text-price">est. final {fmtPrice(pF, quote)}</span>
    </li>
  );
}
