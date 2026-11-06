import { ArrowLeft } from "@phosphor-icons/react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { useAccount } from "wagmi";
import { hookAbi } from "../../abi";
import { Address as Addr, Badge, Button, Card, CardHeader, cx, Empty, Notice, Skeleton, Stat, Table, td, Term, TERMS, th } from "../../components/ui";
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
import { OrderForm, type OpenBatchContext } from "./OrderForm";

export default function MarketDetail() {
  const { poolId } = useParams();
  const markets = useMarkets();
  const m = markets.data?.find((x) => x.id.toLowerCase() === poolId?.toLowerCase());
  const base = useToken(m?.base).token;
  const quote = useToken(m?.quote).token;
  const o = m ? orientation(m, base, quote) : undefined;

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-8 sm:px-6">
      <Link to="/markets" className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft size={14} /> All markets
      </Link>
      <div className="mt-4">
        {markets.isError ? (
          <Notice tone="bad">Could not read pools from the hook. Check the RPC and deployment addresses.</Notice>
        ) : markets.data && !m ? (
          <Notice tone="bad">No Clinch pool with id {poolId} on this chain.</Notice>
        ) : !m || !base || !quote || !o ? (
          <div aria-busy="true">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="mt-6 h-[420px] w-full rounded-xl" />
          </div>
        ) : (
          <Market m={m} base={base} quote={quote} o={o} />
        )}
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

  if (pool.isError && !pool.data) return <Notice tone="bad">Could not read this pool.</Notice>;
  if (!st || !reserves || blockNumber === undefined) return <Skeleton className="h-[420px] w-full rounded-xl" />;

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

  // Batches that matter right now: the oldest unsettled (to settle) and the current one.
  const panels: { id: bigint; data: NonNullable<ReturnType<typeof useBatch>["data"]> }[] = [];
  if (pend.data && next !== undefined && next < (current ?? 0n)) panels.push({ id: next, data: pend.data });
  if (cur.data && current && current > 0n && cur.data.batch.status === 1) panels.push({ id: current, data: cur.data });

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[28px] font-semibold tracking-tight text-ink">
          {base.symbol}
          <span className="text-ink-3">/{quote.symbol}</span>
        </h1>
        <Badge>Clinch batch pool</Badge>
      </div>
      <p className="mt-1 text-[13.5px] text-ink-3">
        Swaps are collected for {cfg.windowBlocks} blocks, then cleared together by ascending-price clinching. Anyone can settle.
      </p>
      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Spot price" value={fmtPrice(spot, quote.symbol)} hint={`${quote.symbol} per ${base.symbol}`} />
        <Stat label={`${base.symbol} reserve`} value={fmtAmount(baseRes, base.decimals)} />
        <Stat label={`${quote.symbol} reserve`} value={fmtAmount(quoteRes, quote.decimals)} />
        <Stat label="Current batch" value={current && current > 0n ? `#${current.toString()}` : "none yet"} hint={curOpen ? `open, ${blocksLeft} block${blocksLeft === 1 ? "" : "s"} left` : "next order opens a new batch"} />
        <Stat label="Unsettled from" value={next && current && next <= current ? `#${next.toString()}` : "-"} hint={next && current && next > current ? "all settled" : undefined} />
        <Stat label="Ladder step / depth cap" value={`${fmtPct(toNum(cfg.eps, 18), 2)} / ${fmtPct(cfg.maxDepthBps / 10_000, 0)}`} hint="per side, of reserves" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          {panels.length === 0 ? (
            <Card>
              <CardHeader title="Open batch" />
              <Empty title="No open batch">The next order opens batch #{((current ?? 0n) + 1n).toString()} and starts a {cfg.windowBlocks}-block window.</Empty>
            </Card>
          ) : (
            panels.map((p) => <BatchPanel key={p.id.toString()} m={m} base={base} quote={quote} o={o} id={p.id} data={p.data} blockNumber={blockNumber} isNext={p.id === next} rescueBlocks={cfg.rescueBlocks} />)
          )}
          <CancelledNotice m={m} next={next} />
          <MyOrders m={m} base={base} quote={quote} o={o} blockNumber={blockNumber} />
          <LastSettlement m={m} base={base} quote={quote} o={o} next={next} />
        </div>
        <aside className="flex flex-col gap-6">
          <Card className="p-5">
            <h2 className="mb-4 text-[15px] font-semibold text-ink">Place an order</h2>
            <OrderForm m={m} base={base} quote={quote} o={o} reserves={reserves} cfg={{ ...cfg, maxOrders: Number(cfg.maxOrders), maxDepthBps: Number(cfg.maxDepthBps) }} ctx={ctx} />
          </Card>
          <Card className="p-5 text-[13px]">
            <h3 className="text-[14px] font-semibold text-ink">Pool</h3>
            <dl className="mt-3 flex flex-col gap-2.5">
              {[
                ["Hook", <Addr key="h" address={deployments.hook} copy />],
                ["Pool id", <span key="i" className="num" title={m.id}>{m.id.slice(0, 10)}…</span>],
                [`${base.symbol}`, <Addr key="b" address={base.address} />],
                [`${quote.symbol}`, <Addr key="q" address={quote.address} />],
                ["Window", `${cfg.windowBlocks} blocks`],
                ["Rescue after", `${cfg.rescueBlocks} blocks`],
                ["Max orders per batch", String(cfg.maxOrders)],
              ].map(([k, v]) => (
                <div key={k as string} className="flex items-center justify-between gap-3">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="num text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </aside>
      </div>
    </>
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
}) {
  const { address, isConnected } = useAccount();
  const settleTx = useTx();
  const cancelTx = useTx();
  const { batch, orders, preview } = data;
  const closed = blockNumber + 1n >= batch.endBlock;
  const left = Number(batch.endBlock - (blockNumber + 1n));
  const rescueAt = batch.endBlock + BigInt(rescueBlocks);
  const canRescue = closed && blockNumber + 1n >= rescueAt;
  const dom = preview && preview.steps > 0n ? dominantSide(preview.buyersDominant, m.baseIsToken0) : null;
  const pF = preview && preview.steps > 0n ? finalPriceHuman(preview.pFinal, preview.buyersDominant, o) : null;

  const rows = orders.map((od, i) => {
    const side = orderSide(od.zeroForOne, m.baseIsToken0);
    const spent = preview?.spent[i];
    const received = preview?.received[i];
    return { ...od, i, side, spent, received, avg: spent !== undefined && received !== undefined ? fillPrice(side, spent, received, o) : null };
  });
  const buys = rows.filter((r) => r.side === "buy");
  const sells = rows.filter((r) => r.side === "sell");

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Batch #{id.toString()}
            {closed ? <Badge tone="warn">window closed, awaiting settlement</Badge> : <Badge tone="accent">open, {left} block{left === 1 ? "" : "s"} left</Badge>}
          </span>
        }
        sub={`Blocks ${batch.startBlock.toString()} to ${(batch.endBlock - 1n).toString()}. ${orders.length} order${orders.length === 1 ? "" : "s"}.`}
      />
      <div className="grid grid-cols-2 gap-6 border-b border-line px-5 py-5 md:grid-cols-4">
        <Stat
          label={<Term tip={TERMS.dominant}>Dominant side</Term>}
          value={dom ? (dom === "buy" ? "Buyers" : "Sellers") : "-"}
          hint={dom ? `of ${base.symbol}` : undefined}
          loading={!preview && orders.length > 0}
        />
        <Stat label="Est. final price" value={fmtPrice(pF, quote.symbol)} hint="dominant side's last ladder price" loading={!preview && orders.length > 0} />
        <Stat label="Ladder steps" value={preview ? preview.steps.toString() : "-"} />
        <Stat
          label="Pool swap"
          value={
            preview && preview.poolIn > 0n
              ? `${fmtAmount(preview.poolIn, dom === "buy" ? quote.decimals : base.decimals)} ${dom === "buy" ? quote.symbol : base.symbol} in`
              : "none"
          }
          hint="the one residual swap at settlement"
        />
      </div>
      {orders.length === 0 ? (
        <Empty title="No orders">Orders placed in this window appear here.</Empty>
      ) : (
        <Table>
          <thead className="border-b border-line">
            <tr>
              <th className={th}>Side</th>
              <th className={th}>Trader</th>
              <th className={cx(th, "text-right")}>Limit</th>
              <th className={cx(th, "text-right")}>Budget</th>
              <th className={cx(th, "text-right")}>Est. receive</th>
              <th className={cx(th, "text-right")}>Est. spend</th>
              <th className={cx(th, "text-right")}>Avg price</th>
            </tr>
          </thead>
          <tbody>
            {[...buys, ...sells].map((r) => {
              const mine = !!address && r.owner.toLowerCase() === address.toLowerCase();
              const lim = hookPriceToHuman(r.limit, o);
              return (
                <tr key={r.i} className={cx("border-b border-line last:border-0", mine && "bg-accent-soft/40")}>
                  <td className={td}>
                    <span className={cx("font-medium", r.side === "buy" ? "text-accent" : "text-ink")}>{r.side === "buy" ? "Buy" : "Sell"}</span>
                  </td>
                  <td className={td}>
                    <Addr address={r.owner} you={mine} />
                  </td>
                  <td className={cx(td, "num text-right")}>{lim === null ? "any" : `${r.side === "buy" ? "≤" : "≥"} ${fmtPrice(lim, quote.symbol)}`}</td>
                  <td className={cx(td, "num text-right")}>
                    {fmtAmount(r.budget, soldDecimals(r.side, o))} <span className="text-ink-3">{r.side === "buy" ? quote.symbol : base.symbol}</span>
                  </td>
                  <td className={cx(td, "num text-right")}>
                    {r.received === undefined ? "-" : fmtAmount(r.received, boughtDecimals(r.side, o))}{" "}
                    <span className="text-ink-3">{r.side === "buy" ? base.symbol : quote.symbol}</span>
                  </td>
                  <td className={cx(td, "num text-right")}>{r.spent === undefined ? "-" : fmtAmount(r.spent, soldDecimals(r.side, o))}</td>
                  <td className={cx(td, "num text-right text-ink-2")}>{r.avg === null ? "-" : fmtPrice(r.avg, quote.symbol)}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <div className="border-t border-line px-5 py-3 text-[12px] leading-relaxed text-ink-3">
        Estimates from the hook's <code className="num">previewSettle()</code>, before the dominant side's <Term tip={TERMS.rebate}>rebate</Term>. Prices are{" "}
        <Term tip={TERMS.nonUniform}>not uniform</Term>: each unit fills at the price where it was clinched, which is what makes honest limits optimal.
      </div>
      {isNext && (
        <div className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[52ch] text-[12.5px] leading-relaxed text-ink-2">
            {closed
              ? "The window is closed. Anyone can settle this batch: it runs the auction, swaps once against the pool and makes every order claimable."
              : `Settling opens when the window closes in ${left} block${left === 1 ? "" : "s"}. Anyone can do it.`}
            {closed && !canRescue && <> If it cannot be settled, anyone may cancel it after block {rescueAt.toString()} for full refunds.</>}
          </p>
          <div className="flex shrink-0 gap-2">
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

const STATUS_LABEL: Record<number, string> = { 1: "open", 2: "settled", 3: "cancelled, full refund" };

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
    <Card>
      <CardHeader title="My orders" sub="Across all batches of this pool, from the OrderPlaced events for your address." />
      {!address ? (
        <Empty title="No wallet connected">Connect a wallet to see your orders and claim fills.</Empty>
      ) : q.isLoading ? (
        <div className="p-5">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !q.data?.length ? (
        <Empty title="No orders yet">Orders you place in this pool appear here with what you can claim once their batch settles.</Empty>
      ) : (
        <>
          <Table>
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Batch</th>
                <th className={th}>Side</th>
                <th className={cx(th, "text-right")}>Limit</th>
                <th className={cx(th, "text-right")}>Budget</th>
                <th className={th}>Status</th>
                <th className={cx(th, "text-right")}>Claimable</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => {
                const side = orderSide(r.zeroForOne, m.baseIsToken0);
                const lim = hookPriceToHuman(r.limit, o);
                const sDec = soldDecimals(side, o);
                const bDec = boughtDecimals(side, o);
                const sSym = side === "buy" ? quote.symbol : base.symbol;
                const bSym = side === "buy" ? base.symbol : quote.symbol;
                return (
                  <tr key={`${r.batchId}-${r.index}`} className="border-b border-line last:border-0">
                    <td className={cx(td, "num")}>#{r.batchId.toString()}</td>
                    <td className={td}>{side === "buy" ? "Buy" : "Sell"}</td>
                    <td className={cx(td, "num text-right")}>{lim === null ? "any" : fmtPrice(lim, quote.symbol)}</td>
                    <td className={cx(td, "num text-right")}>
                      {fmtAmount(r.budget, sDec)} <span className="text-ink-3">{sSym}</span>
                    </td>
                    <td className={cx(td, "text-ink-2")}>{r.claimed ? "claimed" : STATUS_LABEL[r.status] ?? "-"}</td>
                    <td className={cx(td, "num text-right")}>
                      {r.status === 1 ? (
                        <span className="text-ink-3">after settlement</span>
                      ) : r.claimed ? (
                        <span className="text-ink-3">-</span>
                      ) : (
                        <>
                          {fmtAmount(r.proceeds, bDec)} <span className="text-ink-3">{bSym}</span>
                          {r.refund > 0n && (
                            <div className="text-[11.5px] text-ink-3">
                              + {fmtAmount(r.refund, sDec)} {sSym} refund
                            </div>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          {groups.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
              <p className="text-[12.5px] text-ink-3">Claimable amounts come from the hook's claimable(), which already includes the rebate.</p>
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
  );
}

function LastSettlement({ m, base, quote, o, next }: { m: MarketInfo; base: TokenMeta; quote: TokenMeta; o: MarketOrientation; next?: bigint }) {
  const q = useLastSettlement(m, next);
  const s = q.data;
  return (
    <Card>
      <CardHeader title="Last settlement" sub="From the hook's BatchSettled event." />
      {q.isLoading ? (
        <div className="p-5">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !s ? (
        <Empty title="No batch settled yet">After the first settlement this shows the dominant side, final price, pool swap and rebate.</Empty>
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
          return (
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 py-5 md:grid-cols-4">
              <Stat label="Batch" value={`#${s.batchId.toString()}`} hint={`block ${s.blockNumber.toString()}`} />
              <Stat label={<Term tip={TERMS.dominant}>Dominant side</Term>} value={dom === "buy" ? "Buyers" : "Sellers"} hint={`of ${base.symbol}`} />
              <Stat label="Final price" value={fmtPrice(finalPriceHuman(s.pFinal, s.buyersDominant, o), quote.symbol)} hint={`${s.steps.toString()} ladder steps`} />
              <Stat
                label={<Term tip={TERMS.rebate}>Rebate</Term>}
                value={factor === null ? "-" : `${factor >= 1 ? "+" : "-"}${fmtPct(Math.abs(factor - 1), 4)}`}
                hint="(pool out + minority) / engine bought, minus 1"
              />
              <Stat label="Pool in" value={`${fmtAmount(s.poolIn, pDec)} ${pSym}`} />
              <Stat label="Pool out" value={`${fmtAmount(s.poolOut, bDec)} ${bSym}`} />
              <Stat label="From minority" value={`${fmtAmount(s.minoritySupply, bDec)} ${bSym}`} />
              <Stat label="Settled by" value={<Addr address={s.settler} />} hint={`engine bought ${fmt(toNum(s.engineBought, bDec))} ${bSym}`} />
            </div>
          );
        })()
      )}
    </Card>
  );
}
