import { ArrowLeft, ArrowRight, Gavel, Lifebuoy } from "@phosphor-icons/react";
import { useMemo, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useAccount } from "wagmi";
import { hookAbi } from "../../abi";
import { Address as Addr, Badge, Button, Card, CopyButton, cx, Notice, PageHeader, Skeleton, StatusPill, Term, TERMS } from "../../components/ui";
import { deployments } from "../../config/env";
import {
  orientation,
  useBatch,
  useLastCancellation,
  useLastSettlement,
  useMarkets,
  useMyOrders,
  usePool,
  useToken,
  type MarketInfo,
  type MyOrder,
  type TokenMeta,
} from "../../hooks/data";
import { useChainClock } from "../../hooks/useChain";
import { useTx } from "../../hooks/useTx";
import { fmt, fmtAmount, fmtPct, fmtPrice } from "../../lib/format";
import { boughtDecimals, dominantSide, fillPrice, finalPriceHuman, orderSide, soldDecimals } from "../../lib/market";
import { hookPriceToHuman, toNum, type MarketOrientation } from "../../lib/units";
import { BatchDepth, type DepthRow } from "./BatchDepth";
import { OrderForm, type OpenBatchContext } from "./OrderForm";
import { BlockRing, DefList, PairName, SectionTitle, TokenPair } from "./parts";

const backLink = (
  <Link to="/markets" className="inline-flex h-8 w-fit items-center gap-1.5 rounded-full pr-2 text-[13px] text-ink-3 transition-colors hover:text-ink">
    <ArrowLeft size={14} aria-hidden /> All markets
  </Link>
);

export default function MarketDetail() {
  const { poolId } = useParams();
  const markets = useMarkets();
  const m = markets.data?.find((x) => x.id.toLowerCase() === poolId?.toLowerCase());
  const base = useToken(m?.base).token;
  const quote = useToken(m?.quote).token;
  const o = m ? orientation(m, base, quote) : undefined;

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-20 sm:px-6">
      {markets.isError ? (
        <>
          <PageHeader back={backLink} title="Market unavailable" />
          <Notice tone="bad">Could not read pools from the hook. Check the RPC and deployment addresses.</Notice>
        </>
      ) : markets.data && !m ? (
        <>
          <PageHeader back={backLink} title="Market not found" />
          <Notice tone="bad">
            No Clinch pool with id <span className="num break-all">{poolId}</span> on this chain. A launch's pool appears once the launch settles.
          </Notice>
        </>
      ) : !m || !base || !quote || !o ? (
        <DetailSkeleton />
      ) : (
        <Market m={m} base={base} quote={quote} o={o} />
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading market">
      <PageHeader back={backLink} title={<Skeleton className="h-11 w-64" />} meta={<Skeleton className="h-6 w-80 max-w-full" />} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="h-[460px] w-full rounded-[18px]" />
        <Skeleton className="h-[460px] w-full rounded-[18px]" />
      </div>
    </div>
  );
}

function Market({ m, base, quote, o }: { m: MarketInfo; base: TokenMeta; quote: TokenMeta; o: MarketOrientation }) {
  const pool = usePool(m.key);
  const { blockNumber } = useChainClock();
  const st = pool.data?.state;
  const reserves = pool.data?.reserves;
  const current = st?.currentBatch;
  const next = st?.nextToSettle;
  const cur = useBatch(m.key, current);
  const pend = useBatch(m.key, next !== undefined && current !== undefined && next < current ? next : undefined);

  if (pool.isError && !pool.data)
    return (
      <>
        <PageHeader back={backLink} title={<PairName base={base.symbol} quote={quote.symbol} />} />
        <Notice tone="bad">Could not read this pool.</Notice>
      </>
    );
  if (!st || !reserves || blockNumber === undefined) return <DetailSkeleton />;

  const [r0, r1] = reserves;
  const spotRaw = r0 > 0n ? (r1 * 10n ** 18n) / r0 : 0n;
  const spot = hookPriceToHuman(spotRaw, o);
  const baseRes = m.baseIsToken0 ? r0 : r1;
  const quoteRes = m.baseIsToken0 ? r1 : r0;
  const cfg = st.cfg;

  // Can an order land in the current batch? It does if it is mined before endBlock.
  const curBatch = cur.data?.batch;
  const curOpen = !!curBatch && curBatch.status === 1 && blockNumber + 1n < curBatch.endBlock;
  const blocksLeft = curBatch ? Number(curBatch.endBlock - (blockNumber + 1n)) : 0;
  const ctx: OpenBatchContext = curOpen
    ? { orders: cur.data!.orders, sum0: curBatch!.sum0, sum1: curBatch!.sum1, nOrders: Number(curBatch!.nOrders), joinsNew: false, batchId: current! }
    : { orders: [], sum0: 0n, sum1: 0n, nOrders: 0, joinsNew: true, batchId: current ?? 0n };
  const awaiting = next !== undefined && current !== undefined && next <= current;

  // Batches that matter right now: the oldest unsettled (to settle) and the current one.
  const panels: { id: bigint; data: NonNullable<ReturnType<typeof useBatch>["data"]> }[] = [];
  if (pend.data && next !== undefined && next < (current ?? 0n)) panels.push({ id: next, data: pend.data });
  if (cur.data && current && current > 0n && cur.data.batch.status === 1) panels.push({ id: current, data: cur.data });

  return (
    <>
      <PageHeader
        back={backLink}
        title={
          <span className="flex items-center gap-4">
            <TokenPair base={base.symbol} quote={quote.symbol} size={40} />
            <PairName base={base.symbol} quote={quote.symbol} />
          </span>
        }
        meta={
          <>
            {curOpen ? (
              <StatusPill tone="live">
                Batch #{current!.toString()} open, {blocksLeft} block{blocksLeft === 1 ? "" : "s"} left
              </StatusPill>
            ) : awaiting ? (
              <StatusPill tone="waiting">Awaiting settlement</StatusPill>
            ) : (
              <StatusPill tone="idle">Idle, next order opens a batch</StatusPill>
            )}
            <span>
              Reserves <span className="num text-ink-2">{fmtAmount(baseRes, base.decimals)}</span> {base.symbol} and{" "}
              <span className="num text-ink-2">{fmtAmount(quoteRes, quote.decimals)}</span> {quote.symbol}
            </span>
            <span>
              Cleared every <span className="num text-ink-2">{cfg.windowBlocks}</span> blocks
            </span>
          </>
        }
        actions={
          <div className="text-left sm:text-right">
            <div className="text-[12px] text-ink-3">Spot price</div>
            <div className="num text-[26px] leading-tight text-ink sm:text-[32px]">{fmtPrice(spot, quote.symbol)}</div>
            <div className="text-[12px] text-ink-3">
              {quote.symbol} per {base.symbol}
            </div>
          </div>
        }
      />

      <div className="grid gap-x-6 gap-y-10 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr]">
        {/* Hero: the open batch(es) */}
        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1">
          {panels.length === 0 ? (
            <Card>
              <div className="px-5 py-12 sm:px-8">
                <StatusPill tone="idle">No open batch</StatusPill>
                <p className="mt-4 text-[15px] font-medium text-ink">The next order opens batch #{((current ?? 0n) + 1n).toString()}</p>
                <p className="mt-1.5 max-w-[58ch] text-[13.5px] leading-relaxed text-ink-2">
                  It starts a {cfg.windowBlocks}-block window. Every order placed in that window is escrowed and cleared together at the end, so nobody
                  can jump the queue. Place an order to start it.
                </p>
              </div>
            </Card>
          ) : (
            panels.map((p) => (
              <BatchPanel
                key={p.id.toString()}
                m={m}
                base={base}
                quote={quote}
                o={o}
                id={p.id}
                data={p.data}
                blockNumber={blockNumber}
                isNext={p.id === next}
                rescueBlocks={cfg.rescueBlocks}
                spot={spot}
              />
            ))
          )}
          <CancelledNotice m={m} next={next} />
        </div>

        {/* Action panel */}
        <aside className="lg:col-start-2 lg:row-span-2 lg:row-start-1" aria-labelledby="order-title">
          <Card className="p-5 sm:p-6 lg:sticky lg:top-24">
            <h2 id="order-title" className="mb-5 text-[15px] font-medium tracking-[-0.01em] text-ink">
              Place an order
            </h2>
            <OrderForm m={m} base={base} quote={quote} o={o} reserves={reserves} cfg={{ ...cfg, maxOrders: Number(cfg.maxOrders), maxDepthBps: Number(cfg.maxDepthBps) }} ctx={ctx} />
          </Card>
        </aside>

        {/* Below the hero */}
        <div className="flex min-w-0 flex-col gap-12 lg:col-start-1 lg:row-start-2">
          <MyOrders m={m} base={base} quote={quote} o={o} blockNumber={blockNumber} />
          <LastSettlement m={m} base={base} quote={quote} o={o} next={next} />
          <section aria-labelledby="pool-details">
            <SectionTitle id="pool-details" title="Pool details" sub="Read from the hook's poolState() and reserves()." />
            <DefList
              className="mt-3"
              items={[
                ["Hook", <Addr key="h" address={deployments.hook} copy />],
                [
                  "Pool id",
                  <span key="i" className="inline-flex items-center gap-1">
                    <span className="num" title={m.id}>
                      {m.id.slice(0, 10)}…
                    </span>
                    <CopyButton value={m.id} label="Copy pool id" />
                  </span>,
                ],
                [base.symbol, <Addr key="b" address={base.address} />],
                [quote.symbol, <Addr key="q" address={quote.address} />],
                ["Window", `${cfg.windowBlocks} blocks`],
                ["Rescue after", `${cfg.rescueBlocks} blocks`],
                ["Max orders per batch", String(cfg.maxOrders)],
                [<Term key="t" tip={TERMS.ladder}>Ladder step</Term>, fmtPct(toNum(cfg.eps, 18), 2)],
                ["Depth cap per side", `${fmtPct(cfg.maxDepthBps / 10_000, 0)} of reserves`],
                ["Current batch", current && current > 0n ? `#${current.toString()}` : "none yet"],
                ["Unsettled from", next && current && next <= current ? `#${next.toString()}` : "all settled"],
              ]}
            />
          </section>
        </div>
      </div>
    </>
  );
}

function ReadoutItem({ label, children, hint, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="num mt-1 text-[15px] leading-snug text-ink [overflow-wrap:anywhere] sm:text-[17px]">{children}</div>
      {hint && <div className="mt-0.5 text-[12px] text-ink-3">{hint}</div>}
    </div>
  );
}

function BatchPanel({
  m,
  base,
  quote,
  o,
  id,
  data,
  blockNumber,
  isNext,
  rescueBlocks,
  spot,
}: {
  m: MarketInfo;
  base: TokenMeta;
  quote: TokenMeta;
  o: MarketOrientation;
  id: bigint;
  data: NonNullable<ReturnType<typeof useBatch>["data"]>;
  blockNumber: bigint;
  isNext: boolean;
  rescueBlocks: number;
  spot: number | null;
}) {
  const { address, isConnected } = useAccount();
  const settleTx = useTx();
  const cancelTx = useTx();
  const { batch, orders, preview, previewError } = data;
  const closed = blockNumber + 1n >= batch.endBlock;
  const left = Number(batch.endBlock - (blockNumber + 1n));
  const span = Number(batch.endBlock - batch.startBlock);
  const rescueAt = batch.endBlock + BigInt(rescueBlocks);
  const canRescue = closed && blockNumber + 1n >= rescueAt;
  const dom = preview && preview.steps > 0n ? dominantSide(preview.buyersDominant, m.baseIsToken0) : null;
  const pF = preview && preview.steps > 0n ? finalPriceHuman(preview.pFinal, preview.buyersDominant, o) : null;
  const previewLoading = !preview && !previewError && orders.length > 0;
  const noPreview = !preview && !!previewError;

  const rows = orders.map((od, i) => {
    const side = orderSide(od.zeroForOne, m.baseIsToken0);
    const spent = preview?.spent[i];
    const received = preview?.received[i];
    const mine = !!address && od.owner.toLowerCase() === address.toLowerCase();
    return { ...od, i, side, spent, received, mine, avg: spent !== undefined && received !== undefined ? fillPrice(side, spent, received, o) : null };
  });
  const buys = rows.filter((r) => r.side === "buy");
  const sells = rows.filter((r) => r.side === "sell");
  const depthRows: DepthRow[] = rows.map((r) => ({ i: r.i, side: r.side, owner: r.owner, limit: r.limit, budget: r.budget, spent: r.spent, received: r.received, mine: r.mine }));

  return (
    <Card as="article" className="overflow-hidden">
      {/* Header: identity, state, countdown */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 pb-5 pt-5 sm:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[17px] font-medium tracking-[-0.01em] text-ink">Batch #{id.toString()}</h2>
            {closed ? <StatusPill tone="waiting">Window closed, awaiting settlement</StatusPill> : <StatusPill tone="live">Open</StatusPill>}
          </div>
          <p className="mt-1 text-[13px] text-ink-3">
            Blocks <span className="num">{batch.startBlock.toString()}</span> to <span className="num">{(batch.endBlock - 1n).toString()}</span>,{" "}
            <span className="num">{orders.length}</span> order{orders.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <BlockRing total={span} left={closed ? 0 : left} closed={closed} size={56} />
          <div className="text-[12.5px] leading-snug">
            <div className="text-ink">{closed ? "Window closed" : `${left} block${left === 1 ? "" : "s"} left`}</div>
            <div className="text-ink-3">{closed ? "ready to settle" : `of ${span} in this window`}</div>
          </div>
        </div>
      </div>

      {/* What the auction would do now */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-line bg-surface-2/50 px-5 py-5 sm:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))] sm:px-6">
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <div className="text-[12px] text-ink-3">Est. final price</div>
          <div className="num mt-1 truncate text-[26px] leading-tight text-price">
            {previewLoading ? <Skeleton className="h-7 w-32" /> : noPreview ? <span className="text-ink-3">unavailable</span> : fmtPrice(pF, quote.symbol)}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-3">dominant side's last ladder price</div>
        </div>
        <ReadoutItem label={<Term tip={TERMS.dominant}>Dominant side</Term>} hint={dom ? `of ${base.symbol}` : undefined}>
          {previewLoading ? <Skeleton className="h-5 w-20" /> : dom ? (dom === "buy" ? "Buyers" : "Sellers") : "-"}
        </ReadoutItem>
        <ReadoutItem label="Pool swap" hint="the one residual swap">
          {previewLoading ? (
            <Skeleton className="h-5 w-24" />
          ) : preview && preview.poolIn > 0n ? (
            `${fmtAmount(preview.poolIn, dom === "buy" ? quote.decimals : base.decimals)} ${dom === "buy" ? quote.symbol : base.symbol} in`
          ) : (
            "none"
          )}
        </ReadoutItem>
        <ReadoutItem label={<Term tip={TERMS.ladder}>Ladder steps</Term>}>{preview ? preview.steps.toString() : "-"}</ReadoutItem>
      </div>

      {/* Depth view */}
      <div className="px-5 py-6 sm:px-6">
        {orders.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-[14px] font-medium text-ink">No orders in this window yet</p>
            <p className="mx-auto mt-1.5 max-w-[46ch] text-[13px] leading-relaxed text-ink-3">
              Buyers will appear left of spot and sellers right of it. Place the first order from the panel.
            </p>
          </div>
        ) : (
          <>
            <BatchDepth rows={depthRows} o={o} base={base} quote={quote} spot={spot} dom={dom} pF={pF} />
            <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
              Bar length is each order's escrow, valued at spot. The solid part is the estimated share that trades if the batch settled now.
            </p>
          </>
        )}
      </div>

      {/* Per-order estimated fills */}
      {orders.length > 0 && (
        <div className="border-t border-line">
          <div className="px-5 pb-2 pt-5 sm:px-6">
            <h3 className="text-[14px] font-medium text-ink">Estimated fills</h3>
            <p className="mt-1 max-w-[72ch] text-[12.5px] leading-relaxed text-ink-3">
              From the hook's <code className="num">previewSettle()</code>, before the dominant side's <Term tip={TERMS.rebate}>rebate</Term>. Prices are{" "}
              <Term tip={TERMS.nonUniform}>not uniform</Term>: each unit fills at the price where it was clinched, which is what makes honest limits
              optimal.
            </p>
          </div>
          <div aria-hidden className="hidden grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] gap-x-4 px-5 pb-2 pt-3 text-[12px] text-ink-3 sm:grid sm:px-6">
            <span>Order</span>
            <span className="text-right">Budget</span>
            <span className="text-right">Est. receive</span>
            <span className="text-right">Est. spend</span>
            <span className="text-right">Avg price</span>
          </div>
          <ul className="divide-y divide-line border-t border-line">
            {[...buys, ...sells].map((r) => {
              const lim = hookPriceToHuman(r.limit, o);
              return (
                <li
                  key={r.i}
                  className={cx(
                    "grid grid-cols-2 gap-x-4 gap-y-2 px-5 py-3 text-[13px] sm:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] sm:items-center sm:px-6",
                    r.mine && "bg-accent-soft",
                  )}
                >
                  <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 sm:col-span-1">
                    <span className={cx("font-medium", r.side === "buy" ? "text-ink" : "text-ink-2")}>{r.side === "buy" ? "Buy" : "Sell"}</span>
                    <span className="num text-[12.5px] text-ink-3">{lim === null ? "any" : `${r.side === "buy" ? "≤" : "≥"} ${fmtPrice(lim, quote.symbol)}`}</span>
                    <span className="text-[12.5px]">
                      <Addr address={r.owner} you={r.mine} />
                    </span>
                  </div>
                  <Cell label="Budget">
                    {fmtAmount(r.budget, soldDecimals(r.side, o))} <span className="text-ink-3">{r.side === "buy" ? quote.symbol : base.symbol}</span>
                  </Cell>
                  <Cell label="Est. receive">
                    {r.received === undefined ? "-" : fmtAmount(r.received, boughtDecimals(r.side, o))}{" "}
                    <span className="text-ink-3">{r.side === "buy" ? base.symbol : quote.symbol}</span>
                  </Cell>
                  <Cell label="Est. spend">{r.spent === undefined ? "-" : fmtAmount(r.spent, soldDecimals(r.side, o))}</Cell>
                  <Cell label="Avg price" className="text-ink-2">
                    {r.avg === null ? "-" : fmtPrice(r.avg, quote.symbol)}
                  </Cell>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Permissionless settlement */}
      {isNext && (
        <div className="flex flex-col gap-4 border-t border-line bg-surface-2/50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 gap-3">
            <span
              aria-hidden
              className={cx("mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", closed ? "bg-price-soft text-price ring-price/30" : "bg-surface-3 text-ink-3 ring-line")}
            >
              {canRescue ? <Lifebuoy size={16} /> : <Gavel size={16} />}
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-ink">{closed ? "Anyone can settle this batch" : "Settlement opens when the window closes"}</p>
              <p className="mt-1 max-w-[56ch] text-[12.5px] leading-relaxed text-ink-2">
                {closed
                  ? "The window is closed. Anyone can settle this batch: it runs the auction, swaps once against the pool and makes every order claimable."
                  : `Settling opens when the window closes in ${left} block${left === 1 ? "" : "s"}. Anyone can do it.`}
                {closed && !canRescue && <> If it cannot be settled, anyone may cancel it after block {rescueAt.toString()} for full refunds.</>}
                {canRescue && <> The rescue window has passed, so anyone may also cancel it for full refunds.</>}
              </p>
              {!isConnected && <p className="mt-1 text-[12px] text-ink-3">Connect a wallet to send the transaction.</p>}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {canRescue && (
              <Button
                variant="danger"
                loading={cancelTx.busy}
                disabled={!isConnected}
                onClick={() => cancelTx.send({ label: `Cancel batch #${id}`, address: deployments.hook, abi: hookAbi, functionName: "cancelStuck", args: [m.key], success: "Batch cancelled. Every order is fully refundable." })}
              >
                Cancel stuck batch
              </Button>
            )}
            <Button
              variant="primary"
              loading={settleTx.busy}
              disabled={!closed || !isConnected}
              onClick={() => settleTx.send({ label: `Settle batch #${id}`, address: deployments.hook, abi: hookAbi, functionName: "settle", args: [m.key], success: `Batch #${id} finalized. Orders are claimable.` })}
            >
              Settle batch
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx("num min-w-0 sm:text-right", className)}>
      <span className="mr-1.5 font-sans text-[12px] text-ink-3 sm:hidden">{label}</span>
      {children}
    </div>
  );
}

function CancelledNotice({ m, next }: { m: MarketInfo; next?: bigint }) {
  const c = useLastCancellation(m, next).data;
  const s = useLastSettlement(m, next).data;
  // only the most recent finalized batch matters here
  if (!c || (s && s.batchId > c.batchId)) return null;
  return (
    <Notice tone="warn">
      {c.overDepth ? (
        <>
          Batch #{c.batchId.toString()} was cancelled at settlement because pool liquidity changed and the batch became too deep for one block. All orders
          are refunded in full; claim to withdraw.
        </>
      ) : (
        <>
          Batch #{c.batchId.toString()} was cancelled through the rescue path after it could not be settled in time. All orders are refunded in full;
          claim to withdraw.
        </>
      )}
    </Notice>
  );
}

function OrderStatus({ r }: { r: MyOrder }) {
  if (r.claimed) return <StatusPill tone="idle">Claimed</StatusPill>;
  if (r.status === 1) return <StatusPill tone="live">Open</StatusPill>;
  if (r.status === 2) return <StatusPill tone="done">Settled</StatusPill>;
  if (r.status === 3) return <StatusPill tone="stopped">Cancelled, full refund</StatusPill>;
  return <span className="text-ink-3">-</span>;
}

function MyOrders({ m, base, quote, o, blockNumber }: { m: MarketInfo; base: TokenMeta; quote: TokenMeta; o: MarketOrientation; blockNumber: bigint }) {
  const { address } = useAccount();
  const q = useMyOrders(m, address, blockNumber);
  const claimTx = useTx();
  const groups = useMemo(() => {
    const g = new Map<bigint, MyOrder[]>();
    for (const r of q.data ?? []) if ((r.status === 2 || r.status === 3) && !r.claimed && (r.refund > 0n || r.proceeds > 0n)) g.set(r.batchId, [...(g.get(r.batchId) ?? []), r]);
    return g;
  }, [q.data]);

  return (
    <section aria-labelledby="my-orders">
      <SectionTitle id="my-orders" title="My orders" sub="Across all batches of this pool, from the OrderPlaced events for your address." />
      <Card className="mt-4 overflow-hidden">
        {!address ? (
          <TeachEmpty title="No wallet connected">Connect a wallet to see your orders and claim fills.</TeachEmpty>
        ) : q.isLoading ? (
          <div className="flex flex-col gap-3 p-5" aria-busy="true">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
        ) : !q.data?.length ? (
          <TeachEmpty title="No orders yet">Orders you place in this pool appear here with what you can claim once their batch settles.</TeachEmpty>
        ) : (
          <>
            <div aria-hidden className="hidden grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)] gap-x-4 border-b border-line px-5 pb-2.5 pt-4 text-[12px] text-ink-3 md:grid">
              <span>Batch</span>
              <span>Order</span>
              <span className="text-right">Budget</span>
              <span>Status</span>
              <span className="text-right">Claimable</span>
            </div>
            <ul className="divide-y divide-line">
              {q.data.map((r) => {
                const side = orderSide(r.zeroForOne, m.baseIsToken0);
                const lim = hookPriceToHuman(r.limit, o);
                const sDec = soldDecimals(side, o);
                const bDec = boughtDecimals(side, o);
                const sSym = side === "buy" ? quote.symbol : base.symbol;
                const bSym = side === "buy" ? base.symbol : quote.symbol;
                return (
                  <li
                    key={`${r.batchId}-${r.index}`}
                    className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-5 py-3.5 text-[13px] md:grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)] md:items-center"
                  >
                    <span className="num text-ink-2">#{r.batchId.toString()}</span>
                    <span className="min-w-0">
                      <span className="font-medium text-ink">{side === "buy" ? "Buy" : "Sell"}</span>{" "}
                      <span className="num text-ink-3">{lim === null ? "any" : `${side === "buy" ? "≤" : "≥"} ${fmtPrice(lim, quote.symbol)}`}</span>
                    </span>
                    <span className="num col-start-2 md:col-start-auto md:text-right">
                      <span className="mr-1.5 font-sans text-[12px] text-ink-3 md:hidden">Budget</span>
                      {fmtAmount(r.budget, sDec)} <span className="text-ink-3">{sSym}</span>
                    </span>
                    <span className="col-start-2 md:col-start-auto">
                      <OrderStatus r={r} />
                    </span>
                    <span className="num col-start-2 md:col-start-auto md:text-right">
                      {r.status === 1 ? (
                        <span className="font-sans text-ink-3">after settlement</span>
                      ) : r.claimed ? (
                        <span className="text-ink-3">-</span>
                      ) : (
                        <>
                          <span className="text-ink">{fmtAmount(r.proceeds, bDec)}</span> <span className="text-ink-3">{bSym}</span>
                          {r.refund > 0n && (
                            <div className="text-[11.5px] text-ink-3">
                              + {fmtAmount(r.refund, sDec)} {sSym} refund
                            </div>
                          )}
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {groups.size > 0 && (
              <div className="flex flex-col gap-3 border-t border-line bg-surface-2/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-[48ch] text-[12.5px] leading-relaxed text-ink-3">Claimable amounts come from the hook's claimable(), which already includes the rebate.</p>
                <div className="flex flex-wrap gap-2">
                  {[...groups.entries()].map(([b, rs]) => (
                    <Button
                      key={b.toString()}
                      variant="primary"
                      size="sm"
                      loading={claimTx.busy}
                      onClick={() =>
                        rs.length === 1
                          ? claimTx.send({ label: `Claim batch #${b}`, address: deployments.hook, abi: hookAbi, functionName: "claim", args: [m.key, b, rs[0].index], success: "Claimed to your wallet." })
                          : claimTx.send({ label: `Claim batch #${b}`, address: deployments.hook, abi: hookAbi, functionName: "claimMany", args: [m.key, b, rs.map((r) => r.index)], success: "Claimed to your wallet." })
                      }
                    >
                      Claim batch #{b.toString()}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </section>
  );
}

function TeachEmpty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-5 py-10 sm:px-8">
      <p className="text-[14px] font-medium text-ink">{title}</p>
      <p className="mt-1.5 max-w-[56ch] text-[13px] leading-relaxed text-ink-3">{children}</p>
    </div>
  );
}

function LastSettlement({ m, base, quote, o, next }: { m: MarketInfo; base: TokenMeta; quote: TokenMeta; o: MarketOrientation; next?: bigint }) {
  const q = useLastSettlement(m, next);
  const s = q.data;
  return (
    <section aria-labelledby="last-settlement">
      <SectionTitle id="last-settlement" title="Last settlement" sub="From the hook's BatchSettled event, verified on chain." />
      <Card className="mt-4">
        {q.isLoading ? (
          <div className="grid gap-4 p-5 sm:grid-cols-3" aria-busy="true">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : !s ? (
          <TeachEmpty title="No batch settled yet">
            After the first settlement this shows the dominant side, final price, pool swap and rebate. When an open batch's window closes, anyone can settle it.
          </TeachEmpty>
        ) : (
          (() => {
            const dom = dominantSide(s.buyersDominant, m.baseIsToken0);
            // dominant side pays `paid` asset and buys the other
            const boughtIsBase = dom === "buy";
            const bDec = boughtIsBase ? base.decimals : quote.decimals;
            const bSym = boughtIsBase ? base.symbol : quote.symbol;
            const pDec = boughtIsBase ? quote.decimals : base.decimals;
            const pSym = boughtIsBase ? quote.symbol : base.symbol;
            const factor = s.engineBought > 0n ? Number(((s.poolOut + s.minoritySupply) * 10n ** 12n) / s.engineBought) / 1e12 : null;
            const rebate = factor === null ? "-" : `${factor >= 1 ? "+" : "-"}${fmtPct(Math.abs(factor - 1), 4)}`;
            return (
              <div>
                <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-5 pb-5 pt-5 sm:px-6">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-medium text-ink">Batch #{s.batchId.toString()}</span>
                      <Badge tone="neutral">
                        <Term tip={TERMS.dominant}>{dom === "buy" ? "Buyers" : "Sellers"} dominant</Term>
                      </Badge>
                    </div>
                    <div className="mt-3 text-[12px] text-ink-3">Final price</div>
                    <div className="num text-[26px] leading-tight text-price">{fmtPrice(finalPriceHuman(s.pFinal, s.buyersDominant, o), quote.symbol)}</div>
                    <div className="mt-0.5 text-[12px] text-ink-3">
                      after <span className="num">{s.steps.toString()}</span> ladder steps, block <span className="num">{s.blockNumber.toString()}</span>
                    </div>
                  </div>
                  <div className="text-[12.5px] sm:text-right">
                    <div className="text-ink-3">Settled by</div>
                    <div className="mt-1">
                      <Addr address={s.settler} />
                    </div>
                  </div>
                </div>

                {/* Pool swap as a flow, then the rebate as its arithmetic */}
                <div className="grid gap-px border-t border-line bg-line sm:grid-cols-2">
                  <div className="bg-surface px-5 py-4 sm:px-6">
                    <div className="text-[12px] text-ink-3">Swap against the pool</div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[14px]">
                      <span className="num text-ink">
                        {fmtAmount(s.poolIn, pDec)} <span className="text-ink-3">{pSym}</span>
                      </span>
                      <ArrowRight size={14} className="text-ink-3" aria-label="for" />
                      <span className="num text-ink">
                        {fmtAmount(s.poolOut, bDec)} <span className="text-ink-3">{bSym}</span>
                      </span>
                    </div>
                    <div className="mt-1 text-[12px] text-ink-3">
                      plus <span className="num text-ink-2">{fmtAmount(s.minoritySupply, bDec)}</span> {bSym} from the minority side
                    </div>
                  </div>
                  <div className="bg-surface px-5 py-4 sm:px-6">
                    <div className="text-[12px] text-ink-3">
                      <Term tip={TERMS.rebate}>Rebate</Term> to the dominant side
                    </div>
                    <div className={cx("num mt-2 text-[17px]", factor !== null && factor >= 1 ? "text-accent" : "text-ink")}>{rebate}</div>
                    <div className="mt-1 text-[12px] text-ink-3">
                      (pool out + minority) / engine bought <span className="num text-ink-2">{fmt(toNum(s.engineBought, bDec))}</span> {bSym}, minus 1
                    </div>
                  </div>
                </div>
              </div>
            );
          })()
        )}
      </Card>
    </section>
  );
}
