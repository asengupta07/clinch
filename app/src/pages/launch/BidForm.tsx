import { Check, ShieldCheck } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { formatUnits, maxUint256, type Address } from "viem";
import { useAccount } from "wagmi";
import { erc20Abi, launchAbi } from "../../abi";
import { Badge, Button, Field, Notice, NumberInput, Spinner, Term, TERMS, cx } from "../../components/ui";
import { useAllowance, useBalance, type LaunchData, type TokenMeta } from "../../hooks/data";
import { useTx } from "../../hooks/useTx";
import { fmt, fmtAmount, fmtDuration, fmtPrice } from "../../lib/format";
import { runLaunch } from "../../lib/launch";
import { humanToRawPrice, parseDecimal, rawToHumanPrice, toNum } from "../../lib/units";

type Step = "idle" | "approving" | "bidding" | "done";

export function BidForm({
  launch,
  address: launchAddr,
  sale,
  quote,
  secondsLeft,
}: {
  launch: LaunchData;
  address: Address;
  sale: TokenMeta;
  quote: TokenMeta;
  secondsLeft: number;
}) {
  const { address, isConnected } = useAccount();
  const p = launch.params;
  const reserveH = rawToHumanPrice(p.reservePrice, sale.decimals, quote.decimals);
  const ceilH = rawToHumanPrice(p.maxPrice, sale.decimals, quote.decimals);
  const [price, setPrice] = useState("");
  const [budget, setBudget] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const { send } = useTx();
  const bal = useBalance(quote.address, address);
  const allowance = useAllowance(quote.address, address, launchAddr);

  const limitRaw = price ? humanToRawPrice(price, sale.decimals, quote.decimals, "down") : null;
  const budgetRaw = budget ? parseDecimal(budget, quote.decimals) : null;

  const errors = useMemo(() => {
    const e: { price?: string; budget?: string; form?: string } = {};
    if (price) {
      if (limitRaw === null || limitRaw === 0n) e.price = "Enter a valid price.";
      else if (limitRaw < p.reservePrice) e.price = `The reserve price is ${fmtPrice(reserveH, quote.symbol)}. Bids below it are rejected.`;
    }
    if (budget) {
      if (budgetRaw === null) e.budget = `Enter an amount with at most ${quote.decimals} decimals.`;
      else if (budgetRaw < p.minBid) e.budget = `The minimum bid is ${fmtAmount(p.minBid, quote.decimals)} ${quote.symbol}.`;
      else if (bal.data !== undefined && budgetRaw > bal.data) e.budget = `You have ${fmtAmount(bal.data, quote.decimals)} ${quote.symbol}.`;
      else if (budgetRaw >= 2n ** 128n) e.budget = "Amount too large.";
    }
    if (launch.bids.length >= p.maxBids) e.form = `This sale has reached its limit of ${p.maxBids} bids.`;
    if (secondsLeft <= 2) e.form = "Bidding has closed.";
    return e;
  }, [price, budget, limitRaw, budgetRaw, p, bal.data, launch.bids.length, secondsLeft, reserveH, quote]);

  const valid = !!limitRaw && !!budgetRaw && !errors.price && !errors.budget && !errors.form;
  const needsApproval = valid && allowance.data !== undefined && allowance.data < budgetRaw!;

  // What would I get: run the engine locally on the current bids plus this draft.
  const estimate = useMemo(() => {
    if (!valid) return null;
    try {
      const bids = [...launch.bids.map((b) => ({ limit: b.limit, budget: b.budget })), { limit: limitRaw!, budget: budgetRaw! }];
      const r = runLaunch(p, bids);
      const i = bids.length - 1;
      return { qty: r.qty[i], paid: r.paid[i], refund: budgetRaw! - r.paid[i], pFinal: r.pFinal };
    } catch {
      return null;
    }
  }, [valid, launch.bids, limitRaw, budgetRaw, p]);

  const submit = async () => {
    if (!valid) return;
    if (needsApproval) {
      setStep("approving");
      const ok = await send({
        label: `Approve ${quote.symbol}`,
        address: quote.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [launchAddr, budgetRaw!],
        success: `The sale can now take up to ${fmtAmount(budgetRaw!, quote.decimals)} ${quote.symbol} from your wallet.`,
      });
      if (!ok) return setStep("idle");
      await allowance.refetch();
    }
    setStep("bidding");
    const r = await send({
      label: "Place bid",
      address: launchAddr,
      abi: launchAbi,
      functionName: "bid",
      args: [limitRaw!, budgetRaw!],
      success: `Bid placed: up to ${fmtPrice(rawToHumanPrice(limitRaw!, sale.decimals, quote.decimals), quote.symbol)} per ${sale.symbol}, ${fmtAmount(budgetRaw!, quote.decimals)} ${quote.symbol} escrowed.`,
    });
    if (r) {
      setStep("done");
      setPrice("");
      setBudget("");
      setTimeout(() => setStep("idle"), 2500);
    } else setStep("idle");
  };

  const busy = step === "approving" || step === "bidding";
  const priceH = limitRaw ? rawToHumanPrice(limitRaw, sale.decimals, quote.decimals) : null;
  const usd = /USD/.test(quote.symbol);
  const avg = estimate && estimate.qty > 0n ? toNum(estimate.paid, quote.decimals) / toNum(estimate.qty, sale.decimals) : null;
  const approveState: StepState = !needsApproval && step !== "approving" ? "done" : step === "approving" ? "active" : "todo";
  const bidState: StepState = step === "bidding" ? "active" : step === "done" ? "done" : "todo";

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      <Field
        label={`Max price per ${sale.symbol}`}
        htmlFor="bid-price"
        error={errors.price}
        hint={`Reserve ${fmtPrice(reserveH, quote.symbol)}, ceiling ${fmtPrice(ceilH, quote.symbol)}. Bid what one token is really worth to you.`}
      >
        <NumberInput
          id="bid-price"
          value={price}
          onChange={setPrice}
          prefix={usd ? "$" : undefined}
          suffix={usd ? `per ${sale.symbol}` : quote.symbol}
          placeholder={reserveH.toFixed(2)}
          invalid={!!errors.price}
          describedBy={errors.price ? "bid-price-error" : "bid-price-hint"}
          disabled={busy}
        />
      </Field>
      {priceH !== null && limitRaw! > p.maxPrice && !errors.price && (
        <Notice tone="info">Prices above the ceiling are treated as the ceiling ({fmtPrice(ceilH, quote.symbol)}). You never pay more than your maximum.</Notice>
      )}
      <Field
        label={`Budget in ${quote.symbol}`}
        htmlFor="bid-budget"
        error={errors.budget}
        hint={`Escrowed until settlement; whatever is not spent comes back. Minimum ${fmtAmount(p.minBid, quote.decimals)} ${quote.symbol}.`}
        right={
          isConnected && bal.data !== undefined ? (
            <span className="flex items-center gap-2 text-[12.5px] text-ink-3">
              <span>
                Balance <span className="num text-ink-2">{fmtAmount(bal.data, quote.decimals)}</span>
              </span>
              <button
                type="button"
                className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 text-[12px] font-medium text-ink-2 ring-1 ring-inset ring-line-strong transition-colors duration-200 hover:bg-surface-3 hover:text-ink disabled:opacity-45"
                onClick={() => setBudget(formatUnits(bal.data!, quote.decimals))}
                disabled={busy || bal.data === 0n}
                aria-label={`Use your full balance, ${fmtAmount(bal.data, quote.decimals)} ${quote.symbol}`}
              >
                Max
              </button>
            </span>
          ) : null
        }
      >
        <NumberInput
          id="bid-budget"
          value={budget}
          onChange={setBudget}
          suffix={quote.symbol}
          placeholder="1,000"
          invalid={!!errors.budget}
          describedBy={errors.budget ? "bid-budget-error" : "bid-budget-hint"}
          disabled={busy}
        />
      </Field>

      <section className="rounded-2xl bg-surface-2 ring-1 ring-inset ring-line" aria-live="polite" aria-labelledby="bid-estimate-title">
        <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
          <h3 id="bid-estimate-title" className="text-[13px] font-medium text-ink">
            If the sale settled now with your bid
          </h3>
          <Badge className="h-5 shrink-0 px-2 text-[11px]">estimate</Badge>
        </div>
        <dl className="grid grid-cols-3 gap-3 px-4 pb-3.5 pt-3">
          <Readout label="You get" value={estimate ? fmtAmount(estimate.qty, sale.decimals) : null} unit={sale.symbol} strong />
          <Readout label="You pay" value={estimate ? fmtAmount(estimate.paid, quote.decimals, { max: 2 }) : null} unit={quote.symbol} />
          <Readout label="Refunded" value={estimate ? fmtAmount(estimate.refund, quote.decimals, { max: 2 }) : null} unit={quote.symbol} />
        </dl>
        <div className="border-t border-line px-4 py-3 text-[12px] leading-relaxed text-ink-3">
          {estimate ? (
            avg !== null ? (
              <>
                Average <span className="num text-ink-2">{fmtPrice(avg, quote.symbol)}</span> per {sale.symbol}, at or below your max. Computed in your browser
                with the contract's own engine on every current bid plus yours; it changes as others bid.
              </>
            ) : (
              <>At the current bids this bid would not win any tokens, so your whole budget would come back.</>
            )
          ) : (
            <>Enter a max price and a budget to see what the auction would give you right now.</>
          )}
        </div>
      </section>

      <p className="flex gap-2 text-[12.5px] leading-relaxed text-ink-2">
        <ShieldCheck size={16} className="mt-px shrink-0 text-accent" aria-hidden />
        <span>Bidding your true value is optimal, and splitting your budget across wallets can only lower what you get.</span>
      </p>

      {errors.form && <Notice tone="warn">{errors.form}</Notice>}

      {valid && (
        <ol className="grid grid-cols-2 gap-2" aria-label="Steps">
          <StepRow n={1} label={`Approve ${quote.symbol}`} detail={`${fmtAmount(budgetRaw!, quote.decimals)} ${quote.symbol}`} state={approveState} />
          <StepRow n={2} label="Escrow and bid" detail="One transaction" state={bidState} />
        </ol>
      )}

      {!isConnected ? (
        <Notice tone="info">Connect a wallet to bid. On the local chain, pick a demo wallet from the Connect menu.</Notice>
      ) : (
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!valid || busy} loading={busy}>
          {step === "approving" ? `Approving ${quote.symbol}…` : step === "bidding" ? "Placing bid…" : needsApproval ? `Approve and bid` : "Place bid"}
        </Button>
      )}
      <p className="text-[12px] leading-relaxed text-ink-3">
        Closes in <span className="num text-ink-2">{fmtDuration(secondsLeft)}</span>. Your budget is held in <Term tip={TERMS.escrow}>escrow</Term> until
        settlement. Allowance:{" "}
        <span className="num">
          {allowance.data === undefined ? "-" : allowance.data >= maxUint256 / 2n ? "unlimited" : `${fmt(toNum(allowance.data, quote.decimals))} ${quote.symbol}`}
        </span>
        .
      </p>
    </form>
  );
}

type StepState = "todo" | "active" | "done";

function Readout({ label, value, unit, strong }: { label: string; value: string | null; unit: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-3">{label}</dt>
      <dd className={cx("num mt-1 truncate text-[17px] leading-tight", value === null ? "text-ink-3" : strong ? "text-accent" : "text-ink")}>{value ?? "-"}</dd>
      <dd className="truncate text-[11.5px] text-ink-3">{unit}</dd>
    </div>
  );
}

function StepRow({ n, label, detail, state }: { n: number; label: string; detail: string; state: StepState }) {
  return (
    <li
      className={cx(
        "flex min-w-0 items-center gap-2.5 rounded-2xl px-3 py-2.5 ring-1 ring-inset transition-colors duration-200",
        state === "active" ? "bg-accent-soft ring-accent-line" : state === "done" ? "bg-surface-2 ring-line" : "ring-line",
      )}
    >
      <span
        className={cx(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[12px]",
          state === "done" ? "bg-accent text-accent-ink" : state === "active" ? "text-accent" : "num bg-surface-2 text-ink-3 ring-1 ring-inset ring-line-strong",
        )}
        aria-hidden
      >
        {state === "done" ? <Check size={12} weight="bold" /> : state === "active" ? <Spinner /> : n}
      </span>
      <span className="min-w-0">
        <span className="sr-only">Step {n}: </span>
        <span className={cx("block truncate text-[13px]", state === "todo" ? "text-ink-2" : "text-ink")}>{label}</span>
        <span className="num block truncate text-[11.5px] text-ink-3">{detail}</span>
        {state === "done" && <span className="sr-only"> (done)</span>}
        {state === "active" && <span className="sr-only"> (in progress)</span>}
      </span>
    </li>
  );
}
