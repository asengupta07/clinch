import { ArrowRight } from "@phosphor-icons/react";
import { Link } from "react-router";
import { Card, Notice, PageHeader, Skeleton, StatusPill } from "../components/ui";
import { orientation, useBatch, useMarkets, usePool, useToken, type MarketInfo } from "../hooks/data";
import { useChainClock } from "../hooks/useChain";
import { fmtAmount, fmtPrice } from "../lib/format";
import { orderSide } from "../lib/market";
import { hookPriceToHuman, toNum } from "../lib/units";
import { CompositionBar, PairName, TokenPair } from "./market/parts";

/** Shared column template so rows, header and skeletons line up. */
const COLS = "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)_minmax(0,1.35fr)_minmax(0,1fr)_20px]";

function MarketRowSkeleton() {
  return (
    <div aria-hidden className={`grid grid-cols-2 items-center gap-x-6 gap-y-5 px-5 py-6 ${COLS}`}>
      <div className="col-span-2 flex items-center gap-3 lg:col-span-1">
        <Skeleton className="h-8 w-14 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
      </div>
      <Skeleton className="h-7 w-28" />
      <div className="col-span-2 lg:col-span-1">
        <Skeleton className="h-1.5 w-full rounded-full" />
        <Skeleton className="mt-2 h-3 w-3/4" />
      </div>
      <Skeleton className="h-7 w-32 rounded-full" />
      <span className="hidden lg:block" />
    </div>
  );
}

function MarketRow({ m }: { m: MarketInfo }) {
  const base = useToken(m.base).token;
  const quote = useToken(m.quote).token;
  const pool = usePool(m.key);
  const { blockNumber } = useChainClock();
  const cur = useBatch(m.key, pool.data?.state.currentBatch);
  const o = orientation(m, base, quote);
  if (!base || !quote || !o || !pool.data) return <MarketRowSkeleton />;
  const [r0, r1] = pool.data.reserves;
  const spot = r0 > 0n ? hookPriceToHuman((r1 * 10n ** 18n) / r0, o) : null;
  const b = cur.data?.batch;
  const open = b && b.status === 1 && blockNumber !== undefined && blockNumber + 1n < b.endBlock;
  const awaiting = pool.data.state.nextToSettle <= pool.data.state.currentBatch;
  const left = open && b && blockNumber !== undefined ? Number(b.endBlock - (blockNumber + 1n)) : 0;
  const baseRes = m.baseIsToken0 ? r0 : r1;
  const quoteRes = m.baseIsToken0 ? r1 : r0;
  const showOrders = (open || awaiting) && b;
  const orders = showOrders ? cur.data?.orders ?? [] : [];
  const nBuy = orders.filter((x) => orderSide(x.zeroForOne, m.baseIsToken0) === "buy").length;
  const nSell = orders.length - nBuy;
  // Batch demand at spot, in quote terms: buyers escrow quote, sellers escrow base.
  let buyVal = 0;
  let sellVal = 0;
  for (const x of orders) {
    if (orderSide(x.zeroForOne, m.baseIsToken0) === "buy") buyVal += toNum(x.budget, quote.decimals);
    else sellVal += toNum(x.budget, base.decimals) * (spot ?? 0);
  }
  const buyShare = buyVal + sellVal > 0 ? buyVal / (buyVal + sellVal) : 0;
  const batchId = pool.data.state.currentBatch;
  const windowBlocks = pool.data.state.cfg.windowBlocks;

  return (
    <Link
      to={`/markets/${m.id}`}
      className={`group grid grid-cols-2 items-center gap-x-6 gap-y-5 px-5 py-6 transition-colors duration-200 ease-[var(--ease-out-quint)] hover:bg-surface-2 focus-visible:[outline-offset:-2px] ${COLS}`}
    >
      <div className="col-span-2 flex min-w-0 items-center gap-3 lg:col-span-1">
        <TokenPair base={base.symbol} quote={quote.symbol} />
        <div className="min-w-0">
          <h2 className="truncate text-[16px] font-medium tracking-[-0.01em] text-ink">
            <PairName base={base.symbol} quote={quote.symbol} />
          </h2>
          <p className="mt-0.5 truncate text-[12.5px] text-ink-3">
            {windowBlocks}-block window{batchId > 0n ? `, batch #${batchId.toString()}` : ""}
          </p>
        </div>
      </div>

      <div className="min-w-0">
        <div className="text-[12px] text-ink-3 lg:hidden">Spot</div>
        <div className="num truncate text-[22px] leading-tight text-ink">{fmtPrice(spot, quote.symbol)}</div>
        <div className="mt-0.5 text-[12px] text-ink-3">
          {quote.symbol} per {base.symbol}
        </div>
      </div>

      <div className="order-last col-span-2 min-w-0 lg:order-none lg:col-span-1">
        <div className="mb-2 text-[12px] text-ink-3 lg:hidden">Batch demand at spot</div>
        {buyVal + sellVal > 0 ? (
          <CompositionBar
            a={buyVal}
            b={sellVal}
            aClass="bg-accent"
            bClass="bg-chart-3"
            label={`Batch demand: ${Math.round(buyShare * 100)}% buy, ${Math.round((1 - buyShare) * 100)}% sell, valued at spot`}
            aLabel={`Buy ${fmtAmount(BigInt(Math.round(buyVal * 100)), 2)} ${quote.symbol} ${Math.round(buyShare * 100)}%`}
            bLabel={`Sell ${fmtAmount(BigInt(Math.round(sellVal * 100)), 2)} ${quote.symbol} ${Math.round((1 - buyShare) * 100)}%`}
          />
        ) : (
          <p className="text-[12.5px] text-ink-3">
            No orders in the current batch. Reserves {fmtAmount(baseRes, base.decimals)} {base.symbol} and {fmtAmount(quoteRes, quote.decimals)} {quote.symbol}.
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col items-end gap-1.5 lg:items-start">
        {open ? (
          <StatusPill tone="live">
            Open, {left} block{left === 1 ? "" : "s"} left
          </StatusPill>
        ) : awaiting ? (
          <StatusPill tone="waiting">Awaiting settlement</StatusPill>
        ) : (
          <StatusPill tone="idle">Idle</StatusPill>
        )}
        <span className="text-[12.5px] text-ink-3">
          {showOrders ? (
            <>
              <span className="num text-ink-2">{b!.nOrders}</span> order{b!.nOrders === 1 ? "" : "s"}
              {orders.length > 0 && (
                <>
                  , <span className="num">{nBuy}</span> buy <span className="num">{nSell}</span> sell
                </>
              )}
            </>
          ) : (
            "No orders waiting"
          )}
        </span>
      </div>

      <ArrowRight
        size={16}
        aria-hidden
        className="hidden text-ink-3 transition-[transform,color] duration-200 ease-[var(--ease-out-quint)] group-hover:translate-x-0.5 group-hover:text-ink lg:block"
      />
    </Link>
  );
}

export default function Markets() {
  const q = useMarkets();
  const n = q.data?.length;
  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-20 sm:px-6">
      <PageHeader
        title={
          <>
            Batch <em>markets</em>
          </>
        }
        meta={
          <>
            <p className="max-w-[64ch] leading-relaxed">
              Uniswap v4 pools behind the Clinch hook. Direct swaps are disabled; orders are escrowed and cleared together each window, so reordering and
              sandwiching earn nothing.
            </p>
          </>
        }
        actions={
          n !== undefined && n > 0 ? (
            <span className="text-[13px] text-ink-3">
              <span className="num text-ink">{n}</span> pool{n === 1 ? "" : "s"}
            </span>
          ) : undefined
        }
      />

      {q.isError && <Notice tone="bad">Could not read pools from the hook. Check the RPC connection and try again.</Notice>}

      {!q.isError && (
        <Card className="overflow-hidden">
          <div aria-hidden className={`hidden gap-x-6 border-b border-line px-5 pb-3 pt-4 text-[12px] text-ink-3 lg:grid ${COLS}`}>
            <span>Pair</span>
            <span>Spot</span>
            <span>Batch demand at spot</span>
            <span>Current batch</span>
            <span />
          </div>
          {q.isLoading ? (
            <div aria-busy="true" aria-label="Loading pools" className="divide-y divide-line">
              <MarketRowSkeleton />
              <MarketRowSkeleton />
            </div>
          ) : q.data && q.data.length === 0 ? (
            <div className="px-5 py-14 sm:px-10">
              <p className="text-[15px] font-medium text-ink">No pools yet</p>
              <p className="mt-2 max-w-[60ch] text-[13.5px] leading-relaxed text-ink-2">
                A pool appears here as soon as it is initialized through the Clinch hook. Every launch seeds one when it settles, so settling a finished launch
                is the quickest way to create the first market.
              </p>
              <Link to="/launches" className="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-surface-2 px-5 text-[14px] font-medium text-ink ring-1 ring-inset ring-line-strong transition-colors hover:bg-surface-3">
                See launches <ArrowRight size={14} aria-hidden />
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {q.data?.map((m) => (
                <li key={m.id}>
                  <MarketRow m={m} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
