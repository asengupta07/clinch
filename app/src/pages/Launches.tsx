import { ArrowRight, ArrowUpRight, RocketLaunch } from "@phosphor-icons/react";
import { Link } from "react-router";
import type { Address } from "viem";
import { buttonStyles, Card, Notice, PageHeader, Progress, RangeBar, Skeleton, StatusPill, TokenMark } from "../components/ui";
import { useLaunch, useLaunchList, useLaunchPreview, useToken } from "../hooks/data";
import { useChainClock } from "../hooks/useChain";
import { fmtAmount, fmtPct, fmtPrice } from "../lib/format";
import { fmtWhen, humanPrice, PHASE_META, phaseOf, priceAxis, share, timingText } from "./launch/shared";

const ROW =
  "grid gap-5 px-5 py-5 sm:px-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.35fr)_minmax(0,0.95fr)_minmax(0,0.75fr)_16px] lg:items-center lg:gap-8";
const ROW_REST = "grid gap-5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)] sm:gap-8 lg:contents";

function RowSkeleton() {
  return (
    <div className={ROW} aria-hidden>
      <div className="flex items-center gap-3.5">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3.5 w-28" />
        </div>
      </div>
      <div className={ROW_REST}>
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-[3px] w-full" />
          <Skeleton className="h-3 w-full max-w-[220px]" />
        </div>
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-1.5 w-full" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-14" />
        </div>
      </div>
      <span className="hidden lg:block" />
    </div>
  );
}

function LaunchRow({ address }: { address: Address }) {
  const { data: l } = useLaunch(address);
  const sale = useToken(l?.params.saleToken).token;
  const quote = useToken(l?.params.quoteToken).token;
  const { now } = useChainClock();
  const live = l?.status === 1;
  const pv = useLaunchPreview(address, !!l && live && l.bids.length > 0);

  if (!l || !sale || !quote) return <RowSkeleton />;

  const phase = phaseOf(l, now);
  const meta = PHASE_META[phase];
  const end = Number(l.params.endTime);
  const when = now === undefined ? null : phase === "open" || phase === "pending" ? timingText(l, phase, now) : `Ended ${fmtWhen(end)}`;
  const settled = l.status === 2;
  const cancelled = l.status === 3;
  const axis = priceAxis(l, sale, quote);
  const price = settled ? humanPrice(l.clearingPrice, sale, quote) : live && pv.data ? humanPrice(pv.data.pFinal, sale, quote) : undefined;
  const sold = settled ? l.sold : live ? pv.data?.X : 0n;
  const raised = settled ? l.proceeds : live ? pv.data?.Y : 0n;
  const previewPending = live && l.bids.length > 0 && !pv.data && !pv.isError;

  return (
    <Link
      to={`/launches/${address}`}
      className={`group ${ROW} transition-colors duration-200 hover:bg-surface-2/70 focus-visible:outline-offset-[-2px]`}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <TokenMark symbol={sale.symbol} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="truncate text-[15px] font-medium text-ink">{sale.name}</h2>
            <span className="num shrink-0 text-[12.5px] text-ink-3">{sale.symbol}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <StatusPill tone={meta.tone} className="h-6 px-2.5 text-[12px]">
              {meta.label}
            </StatusPill>
            {when && <span className="num text-[12px] text-ink-3">{when}</span>}
          </div>
        </div>
        <ArrowRight
          size={16}
          aria-hidden
          className="shrink-0 text-ink-3 transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:text-ink lg:hidden"
        />
      </div>

      <div className={ROW_REST}>
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-[12px] text-ink-3">
            <span>{settled ? "Clearing price" : cancelled ? "Price range" : "Price if settled now"}</span>
            <span className="num text-[13.5px] text-ink">
              {previewPending ? <Skeleton className="h-3.5 w-16" /> : price === undefined ? (l.bids.length === 0 && !cancelled ? "no bids" : "") : fmtPrice(price, quote.symbol)}
            </span>
          </div>
          <div className="-mt-1">
            <RangeBar
              min={axis.min}
              max={axis.max}
              value={price}
              log
              minLabel={fmtPrice(axis.min, quote.symbol)}
              maxLabel={axis.capped ? fmtPrice(axis.max, quote.symbol) : "no ceiling"}
            />
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-[12px] text-ink-3">
            <span>{settled ? "Sold" : "Selling now"}</span>
            <span className="num">{sold === undefined ? "" : fmtPct(share(sold, l.params.supply), 0)}</span>
          </div>
          <div className="mt-2.5">
            <Progress
              value={sold === undefined ? 0 : share(sold, l.params.supply)}
              label={
                <span className="num">
                  {sold === undefined ? "-" : fmtAmount(sold, sale.decimals, { max: 0 })} of {fmtAmount(l.params.supply, sale.decimals, { max: 0 })}
                </span>
              }
            />
          </div>
        </div>

        <div className="flex items-baseline justify-between gap-3 sm:block sm:text-right">
          <div className="text-[12px] text-ink-3 sm:hidden">{settled ? "Raised" : "Raising now"}</div>
          <div>
            <div className="num text-[15px] text-ink">
              {raised === undefined ? <Skeleton className="h-4 w-20" /> : `${fmtAmount(raised, quote.decimals, { max: 0 })} ${quote.symbol}`}
            </div>
            <div className="num mt-1 text-[12px] text-ink-3">
              {l.bids.length} {l.bids.length === 1 ? "bid" : "bids"}
              {!settled && !cancelled && <span className="hidden sm:inline">, {fmtAmount(l.totalBudget, quote.decimals, { max: 0 })} escrowed</span>}
            </div>
          </div>
        </div>
      </div>

      <ArrowRight
        size={16}
        aria-hidden
        className="hidden text-ink-3 transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:text-ink lg:block"
      />
    </Link>
  );
}

export default function Launches() {
  const list = useLaunchList();
  const launches = [...(list.data ?? [])].reverse();
  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-20 sm:px-6">
      <PageHeader
        title={
          <>
            Token <em>launches</em>
          </>
        }
        meta={
          <>
            <span>Ascending-price clinching auctions. Bid what a token is worth to you; that is your best strategy.</span>
            {list.data && launches.length > 0 && (
              <span className="num text-ink-2">
                {launches.length} {launches.length === 1 ? "launch" : "launches"}
              </span>
            )}
          </>
        }
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

      {list.isLoading && (
        <Card className="divide-y divide-line overflow-hidden" as="div">
          {[0, 1, 2].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </Card>
      )}
      {list.isLoading && (
        <span className="sr-only" role="status">
          Loading launches
        </span>
      )}

      {list.data && launches.length === 0 && (
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

      {launches.length > 0 && (
        <Card className="overflow-hidden" as="div">
          <ul className="divide-y divide-line" aria-label="Launches">
            {launches.map((a) => (
              <li key={a}>
                <LaunchRow address={a} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
