import { ArrowLeft, ArrowRight, Drop, Gavel, Lifebuoy, Wallet } from "@phosphor-icons/react";
import { useMemo, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { getAddress, isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { launchAbi } from "../../abi";
import { Address as Addr, Button, buttonStyles, Card, cx, Notice, PageHeader, Progress, RangeBar, Skeleton, StatusPill, Term, TERMS, TokenMark } from "../../components/ui";
import { LAUNCH_STATUS, poolIdOf, useLaunch, useLaunchPreview, useToken, type LaunchData, type TokenMeta } from "../../hooks/data";
import { useChainClock } from "../../hooks/useChain";
import { useTx } from "../../hooks/useTx";
import { fmt, fmtAmount, fmtDuration, fmtPct, fmtPrice } from "../../lib/format";
import { toNum } from "../../lib/units";
import { BidBook } from "./BidBook";
import { BidForm } from "./BidForm";
import { LadderReplay } from "./LadderReplay";
import { fmtWhen, humanPrice, PHASE_META, phaseOf, priceAxis, share, timingText, type Phase } from "./shared";

const BACK = (
  <Link to="/launches" className={buttonStyles("ghost", "sm", "-ml-3 w-fit text-ink-3")}>
    <ArrowLeft size={14} aria-hidden /> All launches
  </Link>
);

export default function LaunchDetail() {
  const { address: param } = useParams();
  const launchAddr = param && isAddress(param) ? getAddress(param) : undefined;
  const q = useLaunch(launchAddr);
  const l = q.data;
  const sale = useToken(l?.params.saleToken).token;
  const quote = useToken(l?.params.quoteToken).token;
  const { now } = useChainClock();

  if (!launchAddr)
    return (
      <PageShell>
        <PageHeader back={BACK} title="Launch not found" />
        <Notice tone="bad">That is not a valid launch address.</Notice>
      </PageShell>
    );
  if (q.isError && !l)
    return (
      <PageShell>
        <PageHeader back={BACK} title="Launch unavailable" />
        <Notice tone="bad">Could not load this launch. Check that {launchAddr} is a ClinchLaunch on this chain.</Notice>
      </PageShell>
    );
  if (!l || !sale || !quote)
    return (
      <PageShell>
        <DetailSkeleton />
      </PageShell>
    );

  const phase = phaseOf(l, now);
  const meta = PHASE_META[phase];
  const when = timingText(l, phase, now);
  const live = phase === "open" || phase === "ended" || phase === "rescuable";

  return (
    <PageShell>
      <PageHeader
        back={BACK}
        title={
          <span className="flex items-center gap-4">
            <TokenMark symbol={sale.symbol} size={44} />
            <span className="min-w-0">
              {sale.name} <span className="text-ink-3">{sale.symbol}</span>
            </span>
          </span>
        }
        meta={
          <>
            <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
            {when === null ? <Skeleton className="h-4 w-28" /> : <span className="num text-ink-2">{when}</span>}
            <span>Sold for {quote.symbol}</span>
            <span className="inline-flex items-center gap-1.5">
              Contract <Addr address={launchAddr} copy />
            </span>
          </>
        }
      />

      {/* Mobile order: hero, action panel, book, details. On lg the panel sits in its own sticky column. */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_auto_1fr] lg:gap-x-8">
        <div className="min-w-0 lg:col-start-1">
          {live && <LiveHero l={l} sale={sale} quote={quote} addr={launchAddr} phase={phase} />}
          {phase === "settled" && (
            <Card>
              <LadderReplay launch={l} sale={sale} quote={quote} />
            </Card>
          )}
          {phase === "cancelled" && (
            <Card className="p-5 sm:p-6">
              <p className="text-[15px] font-medium text-ink">This sale was cancelled</p>
              <p className="mt-1.5 max-w-[60ch] text-[13.5px] leading-relaxed text-ink-2">
                Nothing was sold. Every bid can claim its full budget back, and the issuer recovers the tokens.
              </p>
            </Card>
          )}
          {phase === "pending" && (
            <Card className="p-5 sm:p-6">
              <p className="text-[15px] font-medium text-ink">Not open yet</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">This launch is not accepting bids yet.</p>
            </Card>
          )}
        </div>

        <aside className="min-w-0 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-3 lg:row-start-1" aria-label="Actions">
          <ActionPanel l={l} sale={sale} quote={quote} addr={launchAddr} phase={phase} now={now} />
        </aside>

        <div className="min-w-0 lg:col-start-1">
          <BidBook l={l} sale={sale} quote={quote} addr={launchAddr} phase={phase} />
        </div>

        <div className="min-w-0 lg:col-start-1">
          <Details l={l} sale={sale} quote={quote} addr={launchAddr} />
        </div>
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[1240px] px-4 pb-20 sm:px-6">{children}</div>;
}

function DetailSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        Loading launch
      </span>
      <div className="flex flex-col gap-5 pb-8 pt-10 sm:pt-12" aria-hidden>
        <Skeleton className="h-8 w-28 rounded-full" />
        <div className="flex items-center gap-4">
          <Skeleton className="size-11 rounded-full" />
          <Skeleton className="h-11 w-64 max-w-[60vw]" />
        </div>
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-7 w-28 rounded-full" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-x-8" aria-hidden>
        <Card className="p-5 sm:p-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-11 w-52" />
          <Skeleton className="mt-8 h-[3px] w-full" />
          <div className="mt-8 grid gap-6 border-t border-line pt-5 sm:grid-cols-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </Card>
        <Card className="p-5 sm:p-6">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="mt-6 h-12 w-full rounded-xl" />
          <Skeleton className="mt-4 h-12 w-full rounded-xl" />
          <Skeleton className="mt-6 h-24 w-full rounded-2xl" />
          <Skeleton className="mt-6 h-12 w-full rounded-full" />
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ hero: the live auction */

function LiveHero({ l, sale, quote, addr, phase }: { l: LaunchData; sale: TokenMeta; quote: TokenMeta; addr: Address; phase: Phase }) {
  const pv = useLaunchPreview(addr, l.bids.length > 0);
  const r = pv.data;
  const axis = priceAxis(l, sale, quote);
  const noBids = l.bids.length === 0;
  const pH = r ? humanPrice(r.pFinal, sale, quote) : undefined;
  const avg = r && r.X > 0n ? toNum(r.Y, quote.decimals) / toNum(r.X, sale.decimals) : null;
  const soldShare = r ? share(r.X, l.params.supply) : 0;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-[13.5px] text-ink-2">{phase === "open" ? "Price if the sale settled now" : "Price when settled"}</h2>
          <div className="num mt-2 text-[36px] leading-none tracking-[-0.03em] text-ink sm:text-[44px]">
            {noBids ? (
              <span className="text-ink-3">{fmtPrice(axis.min, quote.symbol)}</span>
            ) : pv.isError ? (
              <span className="text-ink-3">-</span>
            ) : r ? (
              fmtPrice(pH, quote.symbol)
            ) : (
              <Skeleton className="h-10 w-48" />
            )}
          </div>
          <p className="num mt-2.5 text-[12.5px] text-ink-3">
            {noBids
              ? "No bids yet. The first bid sets the outcome at the reserve price."
              : r
                ? `${avg === null ? "Nothing sold yet" : `Average paid ${fmtPrice(avg, quote.symbol)}`}, ${r.steps.toString()} ladder step${r.steps === 1n ? "" : "s"}`
                : " "}
          </p>
        </div>
        <p className="flex items-center gap-2 text-[12px] text-ink-3">
          {phase === "open" && <span aria-hidden className="live-pulse inline-block size-1.5 rounded-full bg-accent" />}
          Estimate from <code className="num">previewSettle()</code>, every block
        </p>
      </div>

      {pv.isError && !noBids && (
        <Notice tone="bad" className="mt-5">
          Preview unavailable: the auction would need more ladder steps than fit in one call.
        </Notice>
      )}

      <div className="mt-6">
        <RangeBar
          min={axis.min}
          max={axis.max}
          value={pH}
          log
          minLabel={`Reserve ${fmtPrice(axis.min, quote.symbol)}`}
          maxLabel={axis.capped ? `Ceiling ${fmtPrice(axis.max, quote.symbol)}` : "No ceiling"}
        />
      </div>

      <div className="mt-6 grid gap-6 border-t border-line pt-5 sm:grid-cols-2 sm:gap-10">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12.5px] text-ink-3">Sold if settled now</span>
            <span className="num text-[13px] text-ink">{r ? fmtPct(soldShare, 1) : noBids ? fmtPct(0, 1) : ""}</span>
          </div>
          <div className="mt-2.5">
            <Progress
              value={soldShare}
              label={
                <span className="num">
                  {r ? fmtAmount(r.X, sale.decimals, { max: 0 }) : "0"} of {fmtAmount(l.params.supply, sale.decimals, { max: 0 })} {sale.symbol}
                </span>
              }
            />
          </div>
        </div>
        <div>
          <span className="text-[12.5px] text-ink-3">Raised if settled now</span>
          <div className="num mt-1.5 text-[22px] leading-none text-ink">
            {r ? fmtAmount(r.Y, quote.decimals, { max: 0 }) : noBids ? "0" : <Skeleton className="h-6 w-24" />}{" "}
            <span className="text-[13px] text-ink-3">{quote.symbol}</span>
          </div>
          <p className="num mt-2 text-[12px] text-ink-3">
            {fmtAmount(l.totalBudget, quote.decimals, { max: 0 })} escrowed by {l.bids.length} of {l.params.maxBids.toString()} bids
          </p>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ action panel */

function Section({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children: ReactNode }) {
  return (
    <div className="p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-[15px] font-medium text-ink">
        {icon && <span className="text-ink-3">{icon}</span>}
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function ActionPanel({ l, sale, quote, addr, phase, now }: { l: LaunchData; sale: TokenMeta; quote: TokenMeta; addr: Address; phase: Phase; now?: number }) {
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

  const blocks: ReactNode[] = [];

  if (phase === "open") {
    blocks.push(
      <Section key="bid" title="Place a bid">
        <BidForm launch={l} address={addr} sale={sale} quote={quote} secondsLeft={Math.max(0, Number(l.params.endTime) - (now ?? 0))} />
      </Section>,
    );
  }

  if (phase === "pending") {
    blocks.push(
      <Section key="pending" title="Bidding has not opened">
        <p className="text-[13px] leading-relaxed text-ink-3">The bid form appears here as soon as the sale opens.</p>
      </Section>,
    );
  }

  if (phase === "ended" || phase === "rescuable") {
    blocks.push(
      <Section key="settle" icon={<Gavel size={16} aria-hidden />} title="Settle the sale">
        <p className="text-[13px] leading-relaxed text-ink-2">
          Bidding is over. Anyone can settle: it runs the auction on chain, fixes every allocation and seeds the {sale.symbol}/{quote.symbol} pool at the
          clearing price. Whoever calls it pays the gas; the result is the same no matter who does.
        </p>
        <Button
          variant="primary"
          size="lg"
          className="mt-4 w-full"
          loading={settleTx.busy}
          disabled={!isConnected}
          onClick={() => settleTx.send({ label: "Settle sale", address: addr, abi: launchAbi, functionName: "settle", args: [], success: "Settled. Allocations are final and claimable." })}
        >
          Settle sale
        </Button>
        {!isConnected && <p className="mt-2.5 text-[12px] text-ink-3">Connect any wallet to settle.</p>}
        {phase === "ended" && now !== undefined && (
          <p className="mt-4 border-t border-line pt-4 text-[12.5px] leading-relaxed text-ink-3">
            If nobody manages to settle, anyone can cancel after{" "}
            <span className="num text-ink-2">{fmtDuration(Number(l.params.endTime) + Number(l.params.rescueDelay) - now)}</span> and every bidder gets a full
            refund.
          </p>
        )}
      </Section>,
    );
  }

  if (phase === "rescuable") {
    blocks.push(
      <Section key="cancel" icon={<Lifebuoy size={16} aria-hidden />} title="Rescue: cancel the sale">
        <p className="text-[13px] leading-relaxed text-ink-2">
          The settlement window has passed. Anyone may cancel instead: all bids become fully refundable and the issuer recovers the tokens. Settling is still
          possible until someone cancels.
        </p>
        <Button
          variant="danger"
          className="mt-4 w-full"
          loading={cancelTx.busy}
          disabled={!isConnected}
          onClick={() => cancelTx.send({ label: "Cancel sale", address: addr, abi: launchAbi, functionName: "cancel", args: [], success: "Cancelled. Every bid can now claim a full refund." })}
        >
          Cancel and refund everyone
        </Button>
      </Section>,
    );
  }

  if (final && !isConnected) {
    blocks.push(
      <Section key="connect" icon={<Wallet size={16} aria-hidden />} title="Your bids">
        <p className="text-[13px] leading-relaxed text-ink-3">
          Connect the wallet you bid with to claim your {phase === "settled" ? `${sale.symbol} and refund` : "refund"}. Anyone can see every result in the list.
        </p>
      </Section>,
    );
  }

  if (final && isConnected) {
    blocks.push(
      <Section key="claim" icon={<Wallet size={16} aria-hidden />} title="Your bids">
        {mine.length === 0 ? (
          <p className="text-[13px] text-ink-3">This wallet has no bids in this sale.</p>
        ) : unclaimed.length === 0 ? (
          <p className="text-[13px] text-ink-3">All {mine.length} of your bids are claimed.</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line">
              <div className="bg-surface-2 px-4 py-3.5">
                <dt className="text-[12px] text-ink-3">Tokens</dt>
                <dd className="num mt-1 text-[17px] leading-tight text-ink">
                  <span className="block truncate">{fmtAmount(owedTokens, sale.decimals, { max: 2 })}</span>
                  <span className="block text-[12px] text-ink-3">{sale.symbol}</span>
                </dd>
              </div>
              <div className="bg-surface-2 px-4 py-3.5">
                <dt className="text-[12px] text-ink-3">Refund</dt>
                <dd className="num mt-1 text-[17px] leading-tight text-ink">
                  <span className="block truncate">{fmtAmount(owedRefund, quote.decimals, { max: 2 })}</span>
                  <span className="block text-[12px] text-ink-3">{quote.symbol}</span>
                </dd>
              </div>
            </dl>
            <Button
              variant="primary"
              size="lg"
              className="mt-4 w-full"
              loading={claimTx.busy}
              onClick={() =>
                unclaimed.length === 1
                  ? claimTx.send({ label: "Claim", address: addr, abi: launchAbi, functionName: "claim", args: [BigInt(unclaimed[0].i)], success: "Claimed to your wallet." })
                  : claimTx.send({
                      label: `Claim ${unclaimed.length} bids`,
                      address: addr,
                      abi: launchAbi,
                      functionName: "claimMany",
                      args: [unclaimed.map((b) => BigInt(b.i))],
                      success: "Claimed to your wallet.",
                    })
              }
            >
              Claim {unclaimed.length > 1 ? `${unclaimed.length} bids` : ""}
            </Button>
          </>
        )}
      </Section>,
    );
  }

  if (final && isIssuer) {
    const has = l.issuerSale > 0n || l.issuerQuote > 0n;
    blocks.push(
      <Section key="issuer" title="Issuer">
        <p className="text-[13px] leading-relaxed text-ink-2">
          {has ? (
            <>
              Withdrawable: <span className="num text-ink">{fmtAmount(l.issuerQuote, quote.decimals, { max: 2 })}</span> {quote.symbol} and{" "}
              <span className="num text-ink">{fmtAmount(l.issuerSale, sale.decimals, { max: 2 })}</span> {sale.symbol}.
            </>
          ) : (
            "Nothing left to withdraw."
          )}
        </p>
        {has && (
          <Button
            className="mt-4 w-full"
            loading={withdrawTx.busy}
            onClick={() => withdrawTx.send({ label: "Issuer withdraw", address: addr, abi: launchAbi, functionName: "issuerWithdraw", args: [], success: "Proceeds withdrawn to the issuer." })}
          >
            Withdraw proceeds
          </Button>
        )}
      </Section>,
    );
  }

  if (phase === "settled") {
    const id = poolIdOf(l.poolKey);
    blocks.push(
      <Section key="pool" icon={<Drop size={16} aria-hidden />} title="Seeded pool">
        {l.poolSeeded ? (
          <>
            <p className="text-[13px] leading-relaxed text-ink-2">
              {fmtPct(Number(l.params.lpQuoteBps) / 10_000, 0)} of the proceeds and the unsold plus reserved {sale.symbol} now sit in a Clinch batch pool at the
              clearing price of <span className="num text-ink">{fmtPrice(humanPrice(l.clearingPrice, sale, quote), quote.symbol)}</span>. That liquidity is
              locked in the launch contract.
            </p>
            <Link to={`/markets/${id}`} className={buttonStyles("secondary", "md", "mt-4 w-full")}>
              Trade {sale.symbol}/{quote.symbol} <ArrowRight size={14} aria-hidden />
            </Link>
          </>
        ) : (
          <p className="text-[13px] text-ink-3">No pool was seeded (nothing sold, or no proceeds set aside).</p>
        )}
      </Section>,
    );
  }

  if (blocks.length === 0) return null;
  return <Card className="divide-y divide-line">{blocks}</Card>;
}

/* ------------------------------------------------------------------ details */

function Details({ l, sale, quote, addr }: { l: LaunchData; sale: TokenMeta; quote: TokenMeta; addr: Address }) {
  const p = l.params;
  const rows: [string, ReactNode][] = [
    ["Contract", <Addr key="a" address={addr} copy />],
    ["Issuer", <Addr key="i" address={l.issuer} />],
    ["Sale token", <Addr key="s" address={sale.address} />],
    ["Supply", `${fmtAmount(p.supply, sale.decimals)} ${sale.symbol}`],
    ["Reserve price", fmtPrice(humanPrice(p.reservePrice, sale, quote), quote.symbol)],
    ["Price ceiling", fmtPrice(humanPrice(p.maxPrice, sale, quote), quote.symbol)],
    [
      "Ladder step",
      <Term key="e" tip={TERMS.ladder}>
        {fmtPct(toNum(p.eps, 18), 2)}
      </Term>,
    ],
    ["Minimum bid", `${fmtAmount(p.minBid, quote.decimals)} ${quote.symbol}`],
    ["Bids", `${l.bids.length} of ${p.maxBids} max`],
    ["Reserved for pool", `${fmtAmount(p.lpTokens, sale.decimals)} ${sale.symbol} + ${fmtPct(Number(p.lpQuoteBps) / 10_000, 0)} of proceeds`],
    ["Bidding ends", fmtWhen(Number(p.endTime))],
    ["Rescue delay", fmtDuration(Number(p.rescueDelay))],
  ];
  if (l.status === 2) {
    rows.push(["Clearing price", fmtPrice(humanPrice(l.clearingPrice, sale, quote), quote.symbol)]);
    rows.push(["Sold", `${fmtAmount(l.sold, sale.decimals, { max: 0 })} ${sale.symbol}`]);
    rows.push(["Raised", `${fmtAmount(l.proceeds, quote.decimals, { max: 2 })} ${quote.symbol}`]);
    rows.push(["Ladder steps", fmt(Number(l.steps))]);
  }
  return (
    <section aria-labelledby="launch-details" className="pt-4">
      <h2 id="launch-details" className="text-[15px] font-medium text-ink">
        Details
      </h2>
      <dl className="mt-3 grid border-t border-line text-[13px] sm:grid-cols-2 sm:gap-x-10">
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-h-11 items-center justify-between gap-4 border-b border-line py-2">
            <dt className="shrink-0 text-ink-3">{k}</dt>
            <dd className={cx("num min-w-0 text-right text-ink", typeof v === "string" && "truncate")}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export { LAUNCH_STATUS };
