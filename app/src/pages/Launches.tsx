import { ArrowRight, ArrowUpRight, IdentificationBadge, RocketLaunch } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import { launchAbi } from "../abi";
import { buttonStyles, Card, cx, Notice, PageHeader, Segmented, Skeleton, StatusPill, TokenMark } from "../components/ui";
import { deployments } from "../config/env";
import { useLaunch, useLaunchList, useLaunchPreview, useToken, type LaunchData, type TokenMeta } from "../hooks/data";
import { useChainClock } from "../hooks/useChain";
import { fmt, fmtAmount, fmtPct, fmtPrice } from "../lib/format";
import { toNum } from "../lib/units";
import { axisPos, fmtWhen, humanPrice, PHASE_META, phaseOf, priceAxis, share, timingText } from "./launch/shared";

type Filter = "all" | "open" | "ended";

/* ------------------------------------------------------------------ list-level summary */

/** One multicall for every launch: enough to sort, filter and total the page without waiting on each card. */
function useLaunchSummaries(addresses: readonly Address[]) {
  const q = useReadContracts({
    allowFailure: true,
    contracts: addresses.flatMap((a) => [
      { address: a, abi: launchAbi, functionName: "status" } as const,
      { address: a, abi: launchAbi, functionName: "totalBudget" } as const,
      { address: a, abi: launchAbi, functionName: "proceeds" } as const,
      { address: a, abi: launchAbi, functionName: "bidCount" } as const,
    ]),
    query: { enabled: addresses.length > 0 },
  });
  return useMemo(() => {
    if (!q.data) return undefined;
    return addresses.map((address, i) => {
      const r = (k: number) => q.data![i * 4 + k]?.result;
      return {
        address,
        status: Number(r(0) ?? 0),
        totalBudget: (r(1) as bigint | undefined) ?? 0n,
        proceeds: (r(2) as bigint | undefined) ?? 0n,
        bids: Number((r(3) as bigint | undefined) ?? 0n),
      };
    });
  }, [q.data, addresses]);
}

function SummaryStat({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <div className="min-w-0 px-5 py-4 sm:px-6">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="num mt-1.5 text-[24px] leading-none tracking-[-0.02em] text-ink">{value ?? <Skeleton className="h-6 w-20" />}</div>
      {hint && <div className="mt-1.5 text-[12px] text-ink-3">{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ demand chart */

const W = 320;
const H = 104;
const PAD_T = 14;

/**
 * Demand curve: at each price on the launch's (log) axis, the total budget of bids whose limit is at
 * least that price, i.e. how much money is still in the auction if the clock reaches it. The marker is
 * the clock price where the auction would stop now (or did stop, once settled).
 */
function DemandChart({ l, sale, quote, price, tone }: { l: LaunchData; sale: TokenMeta; quote: TokenMeta; price?: number; tone: "live" | "done" | "muted" }) {
  const axis = priceAxis(l, sale, quote);
  const bids = l.bids.map((b) => ({ p: Math.min(humanPrice(b.limit, sale, quote), axis.max), v: toNum(b.budget, quote.decimals) }));
  const total = bids.reduce((a, b) => a + b.v, 0);
  const x = (p: number) => axisPos(p, axis.min, axis.max) * W;
  const y = (v: number) => (total > 0 ? H - (v / total) * (H - PAD_T) : H);

  let line = "";
  let area = "";
  if (total > 0) {
    const limits = [...new Set(bids.map((b) => b.p))].sort((a, b) => a - b);
    let remaining = total;
    const pts: [number, number][] = [[0, y(remaining)]];
    for (const L of limits) {
      pts.push([x(L), y(remaining)]);
      remaining -= bids.filter((b) => b.p === L).reduce((a, b) => a + b.v, 0);
      pts.push([x(L), y(Math.max(0, remaining))]);
    }
    pts.push([W, y(Math.max(0, remaining))]);
    line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
    area = `${line} L${W},${H} L0,${H} Z`;
  }

  const stroke = tone === "done" ? "var(--chart-2)" : tone === "muted" ? "var(--ink-3)" : "var(--accent)";
  const gid = `dg-${l.poolKey.currency0.slice(2, 8)}-${l.poolKey.currency1.slice(2, 8)}-${l.params.endTime}`;
  const mx = price !== undefined ? x(price) : undefined;
  const label =
    total > 0
      ? `Demand curve: ${fmt(total, { max: 0 })} ${quote.symbol} bid in total${price !== undefined ? `, stopping at ${fmtPrice(price, quote.symbol)}` : ""}.`
      : "No bids yet.";

  return (
    <figure className="m-0">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[104px] w-full overflow-visible" role="img" aria-label={label}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={PAD_T + (H - PAD_T) * f} y2={PAD_T + (H - PAD_T) * f} stroke="var(--line)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--line-strong)" vectorEffect="non-scaling-stroke" />
          {total > 0 && (
            <>
              <path d={area} fill={`url(#${gid})`} />
              <path d={line} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </>
          )}
          {mx !== undefined && (
            <line x1={mx} x2={mx} y1={2} y2={H} stroke="var(--price)" strokeWidth={1.5} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {mx !== undefined && (
          <span
            className="num pointer-events-none absolute -top-2.5 -translate-x-1/2 rounded-full bg-price-soft px-2 py-0.5 text-[11px] text-price ring-1 ring-inset ring-[color:var(--price)]/30 whitespace-nowrap"
            style={{ left: `${Math.min(88, Math.max(12, (mx / W) * 100))}%` }}
          >
            {fmtPrice(price, quote.symbol)}
          </span>
        )}
        {total === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-surface-2 px-3 py-1 text-[12px] text-ink-3 ring-1 ring-inset ring-line">No bids yet, be the first</span>
          </div>
        )}
      </div>
      <figcaption className="num mt-2 flex justify-between text-[11.5px] text-ink-3">
        <span>Reserve {fmtPrice(axis.min, quote.symbol)}</span>
        <span>{axis.capped ? `Ceiling ${fmtPrice(axis.max, quote.symbol)}` : "No ceiling"}</span>
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ sold ring */

function SoldRing({ value, tone }: { value: number | undefined; tone: "live" | "done" | "muted" }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, value ?? 0));
  const color = tone === "done" ? "var(--chart-2)" : tone === "muted" ? "var(--ink-3)" : "var(--accent)";
  return (
    <svg viewBox="0 0 44 44" className="size-11 shrink-0 -rotate-90" aria-hidden>
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="4" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        opacity={v > 0 ? 1 : 0}
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${c * v} ${c}`}
        className="transition-[stroke-dasharray] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ card */

function CardSkeleton() {
  return (
    <Card className="flex flex-col gap-5 p-5 sm:p-6" as="div">
      <div className="flex items-center gap-3.5" aria-hidden>
        <Skeleton className="size-11 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3.5 w-28" />
        </div>
      </div>
      <Skeleton className="h-[104px] w-full rounded-xl" />
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    </Card>
  );
}

function humanBadge(quote: TokenMeta): { label: string; title: string } | null {
  if (deployments.humanGate && quote.address.toLowerCase() === deployments.humanGate.toLowerCase()) {
    return { label: "Humans only", title: "Bids need a World ID Proof of Human, capped per person" };
  }
  if (quote.name.startsWith("Human-capped")) {
    return { label: "Humans only, mock verifier", title: "Earlier World ID arm deployed with a mock verifier" };
  }
  return null;
}

function LaunchCard({ address }: { address: Address }) {
  const { data: l } = useLaunch(address);
  const sale = useToken(l?.params.saleToken).token;
  const quote = useToken(l?.params.quoteToken).token;
  const { now } = useChainClock();
  const live = l?.status === 1;
  const pv = useLaunchPreview(address, !!l && live && l.bids.length > 0);

  if (!l || !sale || !quote) return <CardSkeleton />;

  const phase = phaseOf(l, now);
  const meta = PHASE_META[phase];
  const settled = l.status === 2;
  const cancelled = l.status === 3;
  const tone = settled ? "done" : cancelled ? "muted" : "live";
  const when = now === undefined ? null : phase === "open" || phase === "pending" ? timingText(l, phase, now) : `Ended ${fmtWhen(Number(l.params.endTime))}`;
  const price = settled ? humanPrice(l.clearingPrice, sale, quote) : live && pv.data ? humanPrice(pv.data.pFinal, sale, quote) : undefined;
  const sold = settled ? l.sold : live ? (l.bids.length === 0 ? 0n : pv.data?.X) : 0n;
  const raised = settled ? l.proceeds : live ? (l.bids.length === 0 ? 0n : pv.data?.Y) : 0n;
  const soldShare = sold === undefined ? undefined : share(sold, l.params.supply);
  const badge = humanBadge(quote);

  return (
    <Link
      to={`/launches/${address}`}
      className="group block rounded-[18px] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 focus-visible:outline-offset-2"
    >
      <Card
        as="article"
        className="flex h-full flex-col gap-5 p-5 transition-[border-color,background-color] duration-300 group-hover:border-line-strong group-hover:bg-surface-2/40 sm:p-6"
      >
        <header className="flex items-start gap-3.5">
          <TokenMark symbol={sale.symbol} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2">
              <h2 className="truncate text-[16px] font-medium text-ink">{sale.name}</h2>
              <span className="num shrink-0 text-[12.5px] text-ink-3">{sale.symbol}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <StatusPill tone={meta.tone} className="h-6 px-2.5 text-[12px]">
                {meta.label}
              </StatusPill>
              {badge && (
                <span title={badge.title} className="inline-flex h-6 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 text-[12px] text-accent ring-1 ring-inset ring-accent-line">
                  <IdentificationBadge size={13} aria-hidden /> {badge.label}
                </span>
              )}
            </div>
          </div>
          <ArrowRight size={16} aria-hidden className="mt-1.5 shrink-0 text-ink-3 transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:text-ink" />
        </header>

        <div>
          <div className="mb-3 flex items-baseline justify-between text-[12px] text-ink-3">
            <span>Demand by price</span>
            <span className="num">{fmtAmount(l.totalBudget, quote.decimals, { max: 0 })} {quote.symbol} bid</span>
          </div>
          <DemandChart l={l} sale={sale} quote={quote} price={price} tone={tone} />
        </div>

        <dl className="mt-auto grid grid-cols-3 gap-4 border-t border-line pt-4">
          <div className="min-w-0">
            <dt className="text-[12px] text-ink-3">{settled ? "Cleared at" : cancelled ? "Outcome" : "Price now"}</dt>
            <dd className="num mt-1 truncate text-[15px] text-ink">
              {cancelled ? "Refunded" : price !== undefined ? fmtPrice(price, quote.symbol) : l.bids.length === 0 ? "-" : <Skeleton className="h-4 w-16" />}
            </dd>
          </div>
          <div className="flex min-w-0 items-center gap-2.5">
            <SoldRing value={soldShare} tone={tone} />
            <div className="min-w-0">
              <dt className="text-[12px] text-ink-3">Sold</dt>
              <dd className="num mt-0.5 text-[15px] text-ink">{soldShare === undefined ? <Skeleton className="h-4 w-10" /> : fmtPct(soldShare, soldShare > 0 && soldShare < 0.01 ? 1 : 0)}</dd>
            </div>
          </div>
          <div className="min-w-0 text-right">
            <dt className="text-[12px] text-ink-3">{settled ? "Raised" : "Raising now"}</dt>
            <dd className="num mt-1 truncate text-[15px] text-ink">
              {raised === undefined ? <Skeleton className="ml-auto h-4 w-16" /> : `${fmtAmount(raised, quote.decimals, { max: 0 })} ${quote.symbol}`}
            </dd>
          </div>
        </dl>

        <footer className="num -mt-1 flex items-center justify-between gap-3 text-[12px] text-ink-3">
          <span>
            {l.bids.length} of {l.params.maxBids.toString()} bids
          </span>
          {when && <span className="truncate">{when}</span>}
        </footer>
      </Card>
    </Link>
  );
}

/* ------------------------------------------------------------------ page */

const usd = (raw: bigint) => `$${fmt(toNum(raw, 6), { max: 0 })}`;

export default function Launches() {
  const list = useLaunchList();
  const all = useMemo(() => [...(list.data ?? [])].reverse(), [list.data]);
  const summaries = useLaunchSummaries(all);
  const [filter, setFilter] = useState<Filter>("all");

  // Open sales first (most money escrowed on top), then the rest, newest first.
  const ordered = useMemo(() => {
    if (!summaries) return all;
    const rank = (s: (typeof summaries)[number]) => (s.status === 1 ? 0 : s.status === 0 ? 1 : 2);
    return [...summaries]
      .sort((a, b) => rank(a) - rank(b) || (a.status === 1 && b.status === 1 ? Number(b.totalBudget - a.totalBudget) : 0))
      .map((s) => s.address);
  }, [summaries, all]);
  const shown = useMemo(() => {
    if (!summaries || filter === "all") return ordered;
    const st = new Map(summaries.map((s) => [s.address, s.status]));
    return ordered.filter((a) => (filter === "open" ? st.get(a)! <= 1 : st.get(a)! >= 2));
  }, [ordered, summaries, filter]);

  // Every quote token in this deployment is a 6-decimal dollar token (USDC or hUSDC, 1:1).
  const totals = summaries && {
    open: summaries.filter((s) => s.status === 1).length,
    escrowed: summaries.filter((s) => s.status === 1).reduce((a, s) => a + s.totalBudget, 0n),
    raised: summaries.filter((s) => s.status === 2).reduce((a, s) => a + s.proceeds, 0n),
    settled: summaries.filter((s) => s.status === 2).length,
    bids: summaries.reduce((a, s) => a + s.bids, 0),
  };

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-20 sm:px-6">
      <PageHeader
        title={
          <>
            Token <em>launches</em>
          </>
        }
        meta={<span>Ascending-price clinching auctions. Bid what a token is worth to you; that is your best strategy.</span>}
        actions={
          <Link to="/how-it-works" className={buttonStyles("ghost", "sm")}>
            How it works <ArrowRight size={14} aria-hidden />
          </Link>
        }
      />

      {list.isError && (
        <Notice tone="bad" className="mb-6">
          Could not read the launch factory. Check the RPC and deployment addresses.
        </Notice>
      )}

      {(list.isLoading || all.length > 0) && (
        <Card as="div" className="mb-6 grid grid-cols-2 divide-line max-sm:[&>*:nth-child(-n+2)]:border-b max-sm:[&>*]:border-line sm:grid-cols-4 sm:divide-x">
          <SummaryStat label="Open now" value={totals ? String(totals.open) : null} hint={totals ? `of ${all.length} launches` : undefined} />
          <SummaryStat label="Escrowed in open sales" value={totals ? usd(totals.escrowed) : null} hint="USDC and hUSDC" />
          <SummaryStat label="Raised by settled sales" value={totals ? usd(totals.raised) : null} hint={totals ? `${totals.settled} settled` : undefined} />
          <SummaryStat label="Bids placed" value={totals ? String(totals.bids) : null} hint="across every launch" />
        </Card>
      )}

      {all.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Filter launches"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "open", label: "Open" },
              { value: "ended", label: "Ended" },
            ]}
          />
          <span className="num text-[12.5px] text-ink-3">
            {shown.length} {shown.length === 1 ? "launch" : "launches"}
          </span>
        </div>
      )}

      {list.isLoading && (
        <div className="grid gap-5 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
          <span className="sr-only" role="status">
            Loading launches
          </span>
        </div>
      )}

      {list.data && all.length === 0 && (
        <Card className="px-6 py-14 sm:px-10">
          <div className="mx-auto flex max-w-[52ch] flex-col items-center text-center">
            <span className="inline-flex size-11 items-center justify-center rounded-full bg-surface-2 text-ink-2 ring-1 ring-inset ring-line">
              <RocketLaunch size={20} aria-hidden />
            </span>
            <h2 className="mt-5 text-[16px] font-medium text-ink">No launches yet</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-3">
              An issuer creates a launch through the ClinchLaunchFactory with a supply, a reserve price and a price ceiling. It appears here the moment it
              is created, and anyone can bid until it closes.
            </p>
            <Link to="/how-it-works" className={buttonStyles("secondary", "md", "mt-6")}>
              How a launch works <ArrowUpRight size={14} aria-hidden />
            </Link>
          </div>
        </Card>
      )}

      {shown.length > 0 && (
        <ul className={cx("grid gap-5 md:grid-cols-2")} aria-label="Launches">
          {shown.map((a) => (
            <li key={a} className="min-w-0">
              <LaunchCard address={a} />
            </li>
          ))}
        </ul>
      )}
      {summaries && all.length > 0 && shown.length === 0 && (
        <p className="py-10 text-center text-[13.5px] text-ink-3">No {filter === "open" ? "open" : "ended"} launches right now.</p>
      )}
    </div>
  );
}
