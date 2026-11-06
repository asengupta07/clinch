import { ArrowRight } from "@phosphor-icons/react";
import { Link } from "react-router";
import { Badge, Card, Empty, Notice, Skeleton } from "../components/ui";
import { orientation, useBatch, useMarkets, usePool, useToken, type MarketInfo } from "../hooks/data";
import { useChainClock } from "../hooks/useChain";
import { fmtAmount, fmtPrice } from "../lib/format";
import { hookPriceToHuman } from "../lib/units";

function MarketRow({ m }: { m: MarketInfo }) {
  const base = useToken(m.base).token;
  const quote = useToken(m.quote).token;
  const pool = usePool(m.key);
  const { blockNumber } = useChainClock();
  const cur = useBatch(m.key, pool.data?.state.currentBatch);
  const o = orientation(m, base, quote);
  if (!base || !quote || !o || !pool.data) return <Skeleton className="h-[112px] w-full rounded-xl" />;
  const [r0, r1] = pool.data.reserves;
  const spot = r0 > 0n ? hookPriceToHuman((r1 * 10n ** 18n) / r0, o) : null;
  const b = cur.data?.batch;
  const open = b && b.status === 1 && blockNumber !== undefined && blockNumber + 1n < b.endBlock;
  const awaiting = pool.data.state.nextToSettle <= pool.data.state.currentBatch;
  return (
    <Link to={`/markets/${m.id}`} className="group block rounded-xl border border-line bg-surface p-5 transition-colors hover:border-line-strong">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-[16px] font-semibold text-ink">
            {base.symbol}
            <span className="text-ink-3">/{quote.symbol}</span>
          </h2>
          {open ? (
            <Badge tone="accent">batch #{pool.data.state.currentBatch.toString()} open</Badge>
          ) : awaiting ? (
            <Badge tone="warn">awaiting settlement</Badge>
          ) : (
            <Badge>idle</Badge>
          )}
        </div>
        <ArrowRight size={16} className="text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-ink-3">Spot</dt>
          <dd className="num text-ink">{fmtPrice(spot, quote.symbol)}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Reserves</dt>
          <dd className="num text-ink">
            {fmtAmount(m.baseIsToken0 ? r0 : r1, base.decimals)} {base.symbol}
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">&nbsp;</dt>
          <dd className="num text-ink">
            {fmtAmount(m.baseIsToken0 ? r1 : r0, quote.decimals)} {quote.symbol}
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">{open ? "Orders in open batch" : awaiting ? "Orders awaiting settlement" : "Orders in open batch"}</dt>
          <dd className="num text-ink">{(open || awaiting) && b ? b.nOrders : "-"}</dd>
        </div>
      </dl>
    </Link>
  );
}

export default function Markets() {
  const q = useMarkets();
  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-10 sm:px-6">
      <h1 className="text-[28px] font-semibold tracking-tight text-ink">Batch markets</h1>
      <p className="mt-2 max-w-[65ch] text-[15px] leading-relaxed text-ink-2">
        Uniswap v4 pools behind the Clinch hook. Direct swaps are disabled; orders are escrowed and cleared together each window, so reordering and
        sandwiching earn nothing.
      </p>
      <div className="mt-8 flex flex-col gap-4">
        {q.isError && <Notice tone="bad">Could not read pools from the hook.</Notice>}
        {q.isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-[112px] w-full rounded-xl" />)}
        {q.data && q.data.length === 0 && (
          <Card>
            <Empty title="No pools yet">Pools appear when they are initialized through the hook, including the pool each launch seeds when it settles.</Empty>
          </Card>
        )}
        {q.data?.map((m) => <MarketRow key={m.id} m={m} />)}
      </div>
    </div>
  );
}
