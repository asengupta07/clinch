import { Check, Circle } from "@phosphor-icons/react";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { Address as Addr, Card, CardHeader, cx, Empty, Skeleton, Term, TERMS } from "../../components/ui";
import { useLaunchPreview, type LaunchData, type TokenMeta } from "../../hooks/data";
import { fmtAmount, fmtPrice } from "../../lib/format";
import { toNum } from "../../lib/units";
import { axisPos, humanPrice, priceAxis, type Phase } from "./shared";

/**
 * Every bid as a row: a bar of the tokens it gets (estimated while live, final once settled) and
 * its max price on the shared reserve-to-ceiling axis, with the clearing price as one amber line.
 */
export function BidBook({ l, sale, quote, addr, phase }: { l: LaunchData; sale: TokenMeta; quote: TokenMeta; addr: Address; phase: Phase }) {
  const { address } = useAccount();
  const live = phase === "open" || phase === "ended" || phase === "rescuable";
  const pv = useLaunchPreview(addr, live && l.bids.length > 0);
  const settled = phase === "settled";
  const cancelled = phase === "cancelled";
  const rows = l.bids.map((b, i) => {
    const qty = settled ? b.qty : pv.data?.qty[i];
    const paid = settled ? b.paid : pv.data?.paid[i];
    return { ...b, i, qty, paid };
  });
  // highest max price first; ties by index
  const sorted = [...rows].sort((a, b) => (b.limit === a.limit ? a.i - b.i : b.limit > a.limit ? 1 : -1));
  const maxQty = rows.reduce((m, r) => (r.qty !== undefined && r.qty > m ? r.qty : m), 0n);
  const axis = priceAxis(l, sale, quote);
  const clearRaw = settled ? l.clearingPrice : pv.data?.pFinal;
  const clearPos = clearRaw !== undefined && !cancelled ? axisPos(humanPrice(clearRaw, sale, quote), axis.min, axis.max) : undefined;

  return (
    <Card>
      <CardHeader
        title={
          <>
            {settled ? "Results" : cancelled ? "Bids, all refundable" : "Bid book"} <span className="num ml-1 font-normal text-ink-3">{l.bids.length}</span>
          </>
        }
        sub={
          settled ? (
            <>
              Final allocations stored on chain. Unspent budget is refunded on claim. Each bidder paid the price at which they clinched, so{" "}
              <Term tip={TERMS.nonUniform}>average prices differ</Term>.
            </>
          ) : cancelled ? (
            "The sale was cancelled. Every bid can claim its full budget back."
          ) : (
            <>
              Every bid is public and escrowed. Estimates come from <code className="num">previewSettle()</code> and change as bids arrive. Each bidder
              pays the price at which they clinched, so <Term tip={TERMS.nonUniform}>average prices differ</Term>.
            </>
          )
        }
      />
      {l.bids.length === 0 ? (
        <div className="border-t border-line">
          <Empty title="No bids yet">Bids appear here as soon as they are placed. Each one escrows its full budget until settlement.</Empty>
        </div>
      ) : (
        <>
          {!cancelled && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-5 pb-3 text-[12px] text-ink-3 sm:px-6" aria-hidden>
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-4 rounded-full bg-accent/50" />
                {settled ? "Tokens" : "Estimated tokens"}
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="size-2 rounded-full bg-ink-2" />
                Max price
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-px bg-price" />
                {settled ? "Clearing price" : "Price if settled now"}
              </span>
              <span>Price axis: reserve to ceiling, log scale</span>
            </div>
          )}
          <ul className="border-t border-line">
            {sorted.map((r) => {
              const mine = !!address && r.owner.toLowerCase() === address.toLowerCase();
              const avg = r.qty && r.qty > 0n && r.paid !== undefined ? toNum(r.paid, quote.decimals) / toNum(r.qty, sale.decimals) : null;
              const refund = cancelled ? r.budget : r.paid !== undefined ? r.budget - r.paid : undefined;
              const limitH = humanPrice(r.limit, sale, quote);
              const fill = r.qty !== undefined && maxQty > 0n ? Number((r.qty * 10_000n) / maxQty) / 10_000 : 0;
              const out = clearRaw !== undefined && r.limit < clearRaw && r.qty === 0n;
              return (
                <li
                  key={r.i}
                  className={cx(
                    "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 border-b border-line px-5 py-3.5 last:border-0 sm:px-6",
                    !cancelled && "sm:grid-cols-[minmax(0,150px)_minmax(0,1fr)_minmax(0,224px)] sm:items-center",
                    mine && "bg-accent-soft",
                  )}
                >
                  <div className="min-w-0 text-[13px]">
                    <Addr address={r.owner} you={mine} />
                    <div className="num mt-0.5 text-[12px] text-ink-3">
                      max {fmtPrice(limitH, quote.symbol)}
                      {out && <span className="ml-1.5 text-ink-3">priced out</span>}
                    </div>
                  </div>

                  {!cancelled && (
                    <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:row-start-auto" aria-hidden>
                      <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
                        {r.qty === undefined ? (
                          <Skeleton className="absolute inset-0 h-2 w-full" />
                        ) : (
                          <div
                            className={cx(
                              "absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-200 ease-[var(--ease-out-quint)]",
                              mine ? "bg-accent" : "bg-accent/50",
                            )}
                            style={{ transform: `scaleX(${fill})` }}
                          />
                        )}
                      </div>
                      <div className="relative mt-1.5 h-2.5">
                        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-strong" />
                        {clearPos !== undefined && (
                          <div
                            className="absolute inset-y-0 w-px bg-price transition-[left] duration-200 ease-[var(--ease-out-quint)]"
                            style={{ left: `${clearPos * 100}%` }}
                          />
                        )}
                        <div
                          className={cx(
                            "absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full",
                            out ? "border border-ink-3 bg-surface" : mine ? "bg-accent" : "bg-ink-2",
                          )}
                          style={{ left: `${axisPos(limitH, axis.min, axis.max) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="num min-w-0 text-right text-[13px]">
                    {cancelled ? (
                      <>
                        <div className="text-ink">
                          {fmtAmount(r.budget, quote.decimals, { max: 2 })} <span className="text-ink-3">{quote.symbol}</span>
                        </div>
                        <Claimed claimed={r.claimed} label="refunded" />
                      </>
                    ) : (
                      <>
                        <div className="text-ink">
                          {r.qty === undefined ? <Skeleton className="h-4 w-16" /> : fmtAmount(r.qty, sale.decimals, { max: 0 })}{" "}
                          <span className="text-ink-3">{sale.symbol}</span>
                        </div>
                        <div className="mt-0.5 whitespace-nowrap text-[12px] text-ink-3">
                          {r.paid === undefined ? (
                            <Skeleton className="h-3 w-24" />
                          ) : (
                            <>
                              {settled ? "paid" : "est. paid"} {fmtAmount(r.paid, quote.decimals, { max: 2 })} of {fmtAmount(r.budget, quote.decimals, { max: 0 })}
                            </>
                          )}
                        </div>
                        {avg !== null && <div className="mt-0.5 text-[12px] text-ink-2">avg {fmtPrice(avg, quote.symbol)}</div>}
                        {settled && (
                          <div className="mt-0.5 flex flex-wrap items-center justify-end gap-x-2 text-[12px] text-ink-3">
                            <span>refund {refund === undefined ? "-" : fmtAmount(refund, quote.decimals, { max: 2 })}</span>
                            <Claimed claimed={r.claimed} label="claimed" />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

function Claimed({ claimed, label }: { claimed: boolean; label: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 text-[12px]", claimed ? "text-ink-2" : "text-ink-3")}>
      {claimed ? <Check size={12} weight="bold" aria-hidden /> : <Circle size={10} aria-hidden />}
      {claimed ? label : `not ${label}`}
    </span>
  );
}
