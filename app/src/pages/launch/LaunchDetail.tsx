import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { getAddress, isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { launchAbi } from "../../abi";
import { Address as Addr, Badge, Button, buttonStyles, Card, CardHeader, cx, Empty, Notice, Skeleton, Stat, Table, td, Term, TERMS, th } from "../../components/ui";
import { LAUNCH_STATUS, poolIdOf, useLaunch, useLaunchPreview, useToken, type LaunchData, type TokenMeta } from "../../hooks/data";
import { useChainClock } from "../../hooks/useChain";
import { useTx } from "../../hooks/useTx";
import { fmt, fmtAmount, fmtDuration, fmtPct, fmtPrice } from "../../lib/format";
import { rawToHumanPrice, toNum } from "../../lib/units";
import { BidForm } from "./BidForm";
import { LadderReplay } from "./LadderReplay";

type Phase = "pending" | "open" | "ended" | "rescuable" | "settled" | "cancelled";

function phaseOf(l: LaunchData, now: number | undefined): Phase {
  if (l.status === 0) return "pending";
  if (l.status === 2) return "settled";
  if (l.status === 3) return "cancelled";
  const end = Number(l.params.endTime);
  if (now === undefined || now < end) return "open";
  if (now < end + Number(l.params.rescueDelay)) return "ended";
  return "rescuable";
}

const PHASE_BADGE: Record<Phase, { label: string; tone: "accent" | "warn" | "neutral" | "bad" }> = {
  pending: { label: "Pending", tone: "neutral" },
  open: { label: "Bidding open", tone: "accent" },
  ended: { label: "Ended, awaiting settlement", tone: "warn" },
  rescuable: { label: "Ended, rescue available", tone: "warn" },
  settled: { label: "Settled", tone: "neutral" },
  cancelled: { label: "Cancelled, refunds open", tone: "bad" },
};

export default function LaunchDetail() {
  const { address: param } = useParams();
  const launchAddr = param && isAddress(param) ? getAddress(param) : undefined;
  const q = useLaunch(launchAddr);
  const l = q.data;
  const sale = useToken(l?.params.saleToken).token;
  const quote = useToken(l?.params.quoteToken).token;
  const { now } = useChainClock();

  if (!launchAddr) return <PageShell><Notice tone="bad">That is not a valid launch address.</Notice></PageShell>;
  if (q.isError && !l)
    return (
      <PageShell>
        <Notice tone="bad">Could not load this launch. Check that {launchAddr} is a ClinchLaunch on this chain.</Notice>
      </PageShell>
    );
  if (!l || !sale || !quote) return <PageShell><DetailSkeleton /></PageShell>;

  const phase = phaseOf(l, now);
  return (
    <PageShell>
      <Header l={l} sale={sale} quote={quote} phase={phase} now={now} addr={launchAddr} />
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          {(phase === "open" || phase === "ended" || phase === "rescuable") && <LivePreview l={l} sale={sale} quote={quote} addr={launchAddr} phase={phase} />}
          {phase === "settled" && (
            <Card>
              <CardHeader title="Price ladder replay" sub="How the settled auction reached its result, step by step." />
              <LadderReplay launch={l} sale={sale} quote={quote} />
            </Card>
          )}
          <BidBook l={l} sale={sale} quote={quote} addr={launchAddr} phase={phase} />
        </div>
        <aside className="flex flex-col gap-6">
          {phase === "open" && (
            <Card className="p-5">
              <h2 className="mb-4 text-[15px] font-semibold text-ink">Place a bid</h2>
              <BidForm launch={l} address={launchAddr} sale={sale} quote={quote} secondsLeft={Math.max(0, Number(l.params.endTime) - (now ?? 0))} />
            </Card>
          )}
          <Actions l={l} sale={sale} quote={quote} addr={launchAddr} phase={phase} now={now} />
          {phase === "settled" && <PoolCard l={l} sale={sale} quote={quote} />}
          <ParamsCard l={l} sale={sale} quote={quote} addr={launchAddr} />
        </aside>
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-8 sm:px-6">
      <Link to="/launches" className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft size={14} /> All launches
      </Link>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading launch">
      <Skeleton className="h-9 w-64" />
      <div className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-5 w-24" />
          </div>
        ))}
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="h-[360px] w-full rounded-xl" />
        <Skeleton className="h-[360px] w-full rounded-xl" />
      </div>
    </div>
  );
}

function Header({ l, sale, quote, phase, now, addr }: { l: LaunchData; sale: TokenMeta; quote: TokenMeta; phase: Phase; now?: number; addr: Address }) {
  const p = l.params;
  const end = Number(p.endTime);
  const b = PHASE_BADGE[phase];
  let timer: React.ReactNode = "-";
  if (now !== undefined) {
    if (phase === "open") timer = <>closes in {fmtDuration(end - now)}</>;
    else if (phase === "ended") timer = <>rescue opens in {fmtDuration(end + Number(p.rescueDelay) - now)}</>;
    else timer = <>ended {new Date(end * 1000).toLocaleString()}</>;
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[28px] font-semibold tracking-tight text-ink">
          {sale.name} <span className="text-ink-3">({sale.symbol})</span>
        </h1>
        <Badge tone={b.tone}>{b.label}</Badge>
      </div>
      <p className="mt-1 text-[13.5px] text-ink-3">
        Sold for {quote.symbol} at <Addr address={addr} copy /> <span className="num ml-1">{timer}</span>
      </p>
      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Supply" value={fmtAmount(p.supply, sale.decimals)} hint={sale.symbol} />
        <Stat label="Reserve price" value={fmtPrice(rawToHumanPrice(p.reservePrice, sale.decimals, quote.decimals), quote.symbol)} />
        <Stat label="Price ceiling" value={fmtPrice(rawToHumanPrice(p.maxPrice, sale.decimals, quote.decimals), quote.symbol)} />
        <Stat label="Bids" value={`${l.bids.length} / ${p.maxBids}`} />
        <Stat label="Escrowed" value={fmtAmount(l.totalBudget, quote.decimals, { max: 0 })} hint={quote.symbol} />
        <Stat
          label={phase === "open" ? "Time left" : "Ends"}
          value={now === undefined ? <Skeleton className="h-5 w-20" /> : phase === "open" ? fmtDuration(end - now) : new Date(end * 1000).toLocaleTimeString()}
        />
      </div>
    </div>
  );
}

function LivePreview({ l, sale, quote, addr, phase }: { l: LaunchData; sale: TokenMeta; quote: TokenMeta; addr: Address; phase: Phase }) {
  const pv = useLaunchPreview(addr, l.bids.length > 0);
  const r = pv.data;
  const pH = r ? rawToHumanPrice(r.pFinal, sale.decimals, quote.decimals) : null;
  return (
    <Card>
      <CardHeader
        title={phase === "open" ? "If the sale settled now" : "Outcome when settled"}
        sub={
          <>
            From the contract's <code className="num">previewSettle()</code>, refreshed every block. Each bidder pays the price at which they{" "}
            <Term tip={TERMS.clinch}>clinched</Term>, so average prices differ.
          </>
        }
      />
      <div className="grid grid-cols-2 gap-6 px-5 py-5 md:grid-cols-4">
        {l.bids.length === 0 ? (
          <div className="col-span-full text-[13px] text-ink-3">No bids yet. The first bid sets the outcome at the reserve price.</div>
        ) : pv.isError ? (
          <div className="col-span-full text-[13px] text-bad">Preview unavailable: the auction would need more ladder steps than fit in one call.</div>
        ) : (
          <>
            <Stat label="Clearing price" value={fmtPrice(pH, quote.symbol)} loading={!r} hint="final ladder price" />
            <Stat label="Sold" value={r ? `${fmtAmount(r.X, sale.decimals, { max: 0 })}` : ""} loading={!r} hint={r ? `${fmtPct(Number((r.X * 10_000n) / l.params.supply) / 10_000, 1)} of supply` : undefined} />
            <Stat label="Raised" value={r ? fmtAmount(r.Y, quote.decimals, { max: 0 }) : ""} hint={quote.symbol} loading={!r} />
            <Stat label="Average price" value={r && r.X > 0n ? fmtPrice(toNum(r.Y, quote.decimals) / toNum(r.X, sale.decimals), quote.symbol) : "-"} loading={!r} hint={r ? `${r.steps.toString()} ladder step${r.steps === 1n ? "" : "s"}` : undefined} />
          </>
        )}
      </div>
    </Card>
  );
}

function BidBook({ l, sale, quote, addr, phase }: { l: LaunchData; sale: TokenMeta; quote: TokenMeta; addr: Address; phase: Phase }) {
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
  // largest budget first is a stable, useful order; ties by index
  const sorted = [...rows].sort((a, b) => (b.limit === a.limit ? a.i - b.i : b.limit > a.limit ? 1 : -1));
  return (
    <Card>
      <CardHeader
        title={settled ? "Results" : cancelled ? "Bids (refundable)" : "Bid book"}
        sub={
          settled
            ? "Final allocations stored on chain. Unspent budget is refunded on claim."
            : cancelled
              ? "The sale was cancelled. Every bid can claim its full budget back."
              : "Every bid is public and escrowed. Estimated fills come from previewSettle() and change as bids arrive."
        }
      />
      {l.bids.length === 0 ? (
        <Empty title="No bids yet">Bids appear here as soon as they are placed. Each one escrows its full budget.</Empty>
      ) : (
        <Table>
          <thead className="border-b border-line">
            <tr>
              <th className={th}>Bidder</th>
              <th className={cx(th, "text-right")}>Max price</th>
              <th className={cx(th, "text-right")}>Budget</th>
              {!cancelled && <th className={cx(th, "text-right")}>{settled ? "Tokens" : "Est. tokens"}</th>}
              {!cancelled && <th className={cx(th, "text-right")}>{settled ? "Paid" : "Est. paid"}</th>}
              {!cancelled && <th className={cx(th, "text-right")}>Avg price</th>}
              {(settled || cancelled) && <th className={cx(th, "text-right")}>Refund</th>}
              {(settled || cancelled) && <th className={th}>Claimed</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const mine = !!address && r.owner.toLowerCase() === address.toLowerCase();
              const avg = r.qty && r.qty > 0n && r.paid !== undefined ? toNum(r.paid, quote.decimals) / toNum(r.qty, sale.decimals) : null;
              const refund = cancelled ? r.budget : r.paid !== undefined ? r.budget - r.paid : undefined;
              return (
                <tr key={r.i} className={cx("border-b border-line last:border-0", mine && "bg-accent-soft/40")}>
                  <td className={td}>
                    <Addr address={r.owner} you={mine} />
                  </td>
                  <td className={cx(td, "num text-right")}>{fmtPrice(rawToHumanPrice(r.limit, sale.decimals, quote.decimals), quote.symbol)}</td>
                  <td className={cx(td, "num text-right")}>{fmtAmount(r.budget, quote.decimals, { max: 0 })}</td>
                  {!cancelled && <td className={cx(td, "num text-right")}>{r.qty === undefined ? <Skeleton className="h-4 w-16" /> : fmtAmount(r.qty, sale.decimals, { max: 0 })}</td>}
                  {!cancelled && <td className={cx(td, "num text-right")}>{r.paid === undefined ? <Skeleton className="h-4 w-14" /> : fmtAmount(r.paid, quote.decimals, { max: 2 })}</td>}
                  {!cancelled && <td className={cx(td, "num text-right text-ink-2")}>{avg === null ? "-" : fmtPrice(avg, quote.symbol)}</td>}
                  {(settled || cancelled) && <td className={cx(td, "num text-right")}>{refund === undefined ? "-" : fmtAmount(refund, quote.decimals, { max: 2 })}</td>}
                  {(settled || cancelled) && <td className={cx(td, "text-ink-2")}>{r.claimed ? "yes" : "no"}</td>}
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function Actions({ l, sale, quote, addr, phase, now }: { l: LaunchData; sale: TokenMeta; quote: TokenMeta; addr: Address; phase: Phase; now?: number }) {
  const { address, isConnected } = useAccount();
  const settleTx = useTx();
  const cancelTx = useTx();
  const claimTx = useTx();
  const withdrawTx = useTx();
  const mine = useMemo(
    () => (address ? l.bids.map((b, i) => ({ ...b, i })).filter((b) => b.owner.toLowerCase() === address.toLowerCase()) : []),
    [l.bids, address],
  );
  const unclaimed = mine.filter((b) => !b.claimed);
  const isIssuer = !!address && address.toLowerCase() === l.issuer.toLowerCase();
  const final = phase === "settled" || phase === "cancelled";
  const owedTokens = phase === "settled" ? unclaimed.reduce((a, b) => a + b.qty, 0n) : 0n;
  const owedRefund = unclaimed.reduce((a, b) => a + (phase === "settled" ? b.budget - b.paid : b.budget), 0n);

  const blocks: React.ReactNode[] = [];

  if (phase === "ended" || phase === "rescuable") {
    blocks.push(
      <div key="settle">
        <h3 className="text-[14px] font-semibold text-ink">Settle the sale</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          Bidding is over. Anyone can settle: it runs the auction on chain, fixes every allocation and seeds the {sale.symbol}/{quote.symbol} pool at
          the clearing price. Whoever calls it pays the gas; the result is the same no matter who does.
        </p>
        <Button
          variant="primary"
          className="mt-3 w-full"
          loading={settleTx.busy}
          disabled={!isConnected}
          onClick={() => settleTx.send({ label: "Settle sale", address: addr, abi: launchAbi, functionName: "settle", args: [], success: "Settled. Allocations are final and claimable." })}
        >
          Settle sale
        </Button>
        {!isConnected && <p className="mt-2 text-[12px] text-ink-3">Connect any wallet to settle.</p>}
      </div>,
    );
  }
  if (phase === "ended" && now !== undefined) {
    blocks.push(
      <p key="rescue-later" className="text-[12.5px] leading-relaxed text-ink-3">
        If nobody manages to settle, anyone can cancel after{" "}
        <span className="num">{fmtDuration(Number(l.params.endTime) + Number(l.params.rescueDelay) - now)}</span> and every bidder gets a full refund.
      </p>,
    );
  }
  if (phase === "rescuable") {
    blocks.push(
      <div key="cancel">
        <h3 className="text-[14px] font-semibold text-ink">Rescue: cancel the sale</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          The settlement window has passed. Anyone may cancel instead: all bids become fully refundable and the issuer recovers the tokens. Settling is
          still possible until someone cancels.
        </p>
        <Button
          variant="danger"
          className="mt-3 w-full"
          loading={cancelTx.busy}
          disabled={!isConnected}
          onClick={() => cancelTx.send({ label: "Cancel sale", address: addr, abi: launchAbi, functionName: "cancel", args: [], success: "Cancelled. Every bid can now claim a full refund." })}
        >
          Cancel and refund everyone
        </Button>
      </div>,
    );
  }
  if (final && isConnected) {
    blocks.push(
      <div key="claim">
        <h3 className="text-[14px] font-semibold text-ink">Your bids</h3>
        {mine.length === 0 ? (
          <p className="mt-1 text-[13px] text-ink-3">This wallet has no bids in this sale.</p>
        ) : unclaimed.length === 0 ? (
          <p className="mt-1 text-[13px] text-ink-3">All {mine.length} of your bids are claimed.</p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Stat label="Tokens" value={`${fmtAmount(owedTokens, sale.decimals, { max: 2 })} ${sale.symbol}`} />
              <Stat label="Refund" value={`${fmtAmount(owedRefund, quote.decimals, { max: 2 })} ${quote.symbol}`} />
            </div>
            <Button
              variant="primary"
              className="mt-3 w-full"
              loading={claimTx.busy}
              onClick={() =>
                unclaimed.length === 1
                  ? claimTx.send({ label: "Claim", address: addr, abi: launchAbi, functionName: "claim", args: [BigInt(unclaimed[0].i)], success: "Claimed to your wallet." })
                  : claimTx.send({ label: `Claim ${unclaimed.length} bids`, address: addr, abi: launchAbi, functionName: "claimMany", args: [unclaimed.map((b) => BigInt(b.i))], success: "Claimed to your wallet." })
              }
            >
              Claim {unclaimed.length > 1 ? `${unclaimed.length} bids` : ""}
            </Button>
          </>
        )}
      </div>,
    );
  }
  if (final && isIssuer) {
    const has = l.issuerSale > 0n || l.issuerQuote > 0n;
    blocks.push(
      <div key="issuer">
        <h3 className="text-[14px] font-semibold text-ink">Issuer</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          {has ? (
            <>
              Withdrawable: <span className="num">{fmtAmount(l.issuerQuote, quote.decimals, { max: 2 })}</span> {quote.symbol} and{" "}
              <span className="num">{fmtAmount(l.issuerSale, sale.decimals, { max: 2 })}</span> {sale.symbol}.
            </>
          ) : (
            "Nothing left to withdraw."
          )}
        </p>
        {has && (
          <Button
            className="mt-3 w-full"
            loading={withdrawTx.busy}
            onClick={() => withdrawTx.send({ label: "Issuer withdraw", address: addr, abi: launchAbi, functionName: "issuerWithdraw", args: [], success: "Proceeds withdrawn to the issuer." })}
          >
            Withdraw proceeds
          </Button>
        )}
      </div>,
    );
  }
  if (blocks.length === 0) return null;
  return <Card className="flex flex-col gap-5 p-5">{blocks}</Card>;
}

function PoolCard({ l, sale, quote }: { l: LaunchData; sale: TokenMeta; quote: TokenMeta }) {
  const id = poolIdOf(l.poolKey);
  return (
    <Card className="p-5">
      <h3 className="text-[14px] font-semibold text-ink">Seeded pool</h3>
      {l.poolSeeded ? (
        <>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
            {fmtPct(Number(l.params.lpQuoteBps) / 10_000, 0)} of the proceeds and the unsold plus reserved {sale.symbol} now sit in a Clinch batch pool at
            the clearing price of {fmtPrice(rawToHumanPrice(l.clearingPrice, sale.decimals, quote.decimals), quote.symbol)}. That liquidity is locked in
            the launch contract.
          </p>
          <Link to={`/markets/${id}`} className={buttonStyles("secondary", "md", "mt-3 w-full")}>
            Trade {sale.symbol}/{quote.symbol} <ArrowRight size={14} />
          </Link>
        </>
      ) : (
        <p className="mt-1 text-[13px] text-ink-3">No pool was seeded (nothing sold, or no proceeds set aside).</p>
      )}
    </Card>
  );
}

function ParamsCard({ l, sale, quote, addr }: { l: LaunchData; sale: TokenMeta; quote: TokenMeta; addr: Address }) {
  const p = l.params;
  const rows: [string, React.ReactNode][] = [
    ["Contract", <Addr key="a" address={addr} copy />],
    ["Issuer", <Addr key="i" address={l.issuer} />],
    ["Sale token", <Addr key="s" address={sale.address} />],
    ["Ladder step", <Term key="e" tip={TERMS.ladder}>{fmtPct(toNum(p.eps, 18), 2)}</Term>],
    ["Minimum bid", `${fmtAmount(p.minBid, quote.decimals)} ${quote.symbol}`],
    ["Reserved for pool", `${fmtAmount(p.lpTokens, sale.decimals)} ${sale.symbol} + ${fmtPct(Number(p.lpQuoteBps) / 10_000, 0)} of proceeds`],
    ["Rescue delay", fmtDuration(Number(p.rescueDelay))],
  ];
  if (l.status === 2) {
    rows.push(["Clearing price", fmtPrice(rawToHumanPrice(l.clearingPrice, sale.decimals, quote.decimals), quote.symbol)]);
    rows.push(["Sold", `${fmtAmount(l.sold, sale.decimals, { max: 0 })} ${sale.symbol}`]);
    rows.push(["Raised", `${fmtAmount(l.proceeds, quote.decimals, { max: 2 })} ${quote.symbol}`]);
    rows.push(["Ladder steps", fmt(Number(l.steps))]);
  }
  return (
    <Card className="p-5">
      <h3 className="text-[14px] font-semibold text-ink">Details</h3>
      <dl className="mt-3 flex flex-col gap-2.5 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3">
            <dt className="text-ink-3">{k}</dt>
            <dd className="num min-w-0 truncate text-right text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export { LAUNCH_STATUS };
