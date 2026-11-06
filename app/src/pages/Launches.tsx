import { ArrowRight } from "@phosphor-icons/react";
import { Link } from "react-router";
import type { Address } from "viem";
import { Badge, Card, Empty, Notice, Skeleton } from "../components/ui";
import { useLaunch, useLaunchList, useLaunchPreview, useToken } from "../hooks/data";
import { useChainClock } from "../hooks/useChain";
import { fmtAmount, fmtDuration, fmtPrice } from "../lib/format";
import { rawToHumanPrice } from "../lib/units";

function LaunchRow({ address }: { address: Address }) {
  const { data: l } = useLaunch(address);
  const sale = useToken(l?.params.saleToken).token;
  const quote = useToken(l?.params.quoteToken).token;
  const { now } = useChainClock();
  const live = l?.status === 1;
  const pv = useLaunchPreview(address, !!l && live && l.bids.length > 0);

  if (!l || !sale || !quote) {
    return (
      <Card className="p-5" as="div">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-4 h-4 w-full max-w-[520px]" />
      </Card>
    );
  }
  const end = Number(l.params.endTime);
  const open = live && now !== undefined && now < end;
  const status =
    l.status === 2
      ? { t: "Settled", tone: "neutral" as const }
      : l.status === 3
        ? { t: "Cancelled", tone: "bad" as const }
        : open
          ? { t: `Open, ${fmtDuration(end - (now ?? 0))} left`, tone: "accent" as const }
          : l.status === 1
            ? { t: "Ended, awaiting settlement", tone: "warn" as const }
            : { t: "Pending", tone: "neutral" as const };
  const price =
    l.status === 2
      ? rawToHumanPrice(l.clearingPrice, sale.decimals, quote.decimals)
      : pv.data
        ? rawToHumanPrice(pv.data.pFinal, sale.decimals, quote.decimals)
        : null;

  return (
    <Link to={`/launches/${address}`} className="group block rounded-xl border border-line bg-surface p-5 transition-colors hover:border-line-strong">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-[16px] font-semibold text-ink">
            {sale.name} <span className="font-normal text-ink-3">{sale.symbol}</span>
          </h2>
          <Badge tone={status.tone}>{status.t}</Badge>
        </div>
        <ArrowRight size={16} className="text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-5">
        <div>
          <dt className="text-ink-3">Supply</dt>
          <dd className="num text-ink">{fmtAmount(l.params.supply, sale.decimals)}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Reserve / ceiling</dt>
          <dd className="num text-ink">
            {fmtPrice(rawToHumanPrice(l.params.reservePrice, sale.decimals, quote.decimals), quote.symbol)} /{" "}
            {fmtPrice(rawToHumanPrice(l.params.maxPrice, sale.decimals, quote.decimals), quote.symbol)}
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">Bids</dt>
          <dd className="num text-ink">{l.bids.length}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Escrowed</dt>
          <dd className="num text-ink">
            {fmtAmount(l.totalBudget, quote.decimals, { max: 0 })} {quote.symbol}
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">{l.status === 2 ? "Clearing price" : "Price if settled now"}</dt>
          <dd className="num text-ink">{price === null ? "-" : fmtPrice(price, quote.symbol)}</dd>
        </div>
      </dl>
    </Link>
  );
}

export default function Launches() {
  const list = useLaunchList();
  const launches = [...(list.data ?? [])].reverse();
  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-10 sm:px-6">
      <h1 className="text-[28px] font-semibold tracking-tight text-ink">Launches</h1>
      <p className="mt-2 max-w-[65ch] text-[15px] leading-relaxed text-ink-2">
        Token sales run as ascending-price clinching auctions. Bid a maximum price and a budget; the truth is your best strategy.
      </p>
      <div className="mt-8 flex flex-col gap-4">
        {list.isError && <Notice tone="bad">Could not read the launch factory. Check the RPC and deployment addresses.</Notice>}
        {list.isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-[132px] w-full rounded-xl" />)}
        {list.data && launches.length === 0 && (
          <Card>
            <Empty title="No launches yet">Launches are created through the ClinchLaunchFactory. They appear here as soon as one is created.</Empty>
          </Card>
        )}
        {launches.map((a) => (
          <LaunchRow key={a} address={a} />
        ))}
      </div>
    </div>
  );
}
