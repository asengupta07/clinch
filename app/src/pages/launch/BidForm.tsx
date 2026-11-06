import { CheckCircle, Circle } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { maxUint256, type Address } from "viem";
import { useAccount } from "wagmi";
import { erc20Abi, launchAbi } from "../../abi";
import { Button, Field, Notice, NumberInput, Spinner, Term, TERMS, cx } from "../../components/ui";
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

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      <Field
        label={`Maximum price per ${sale.symbol}`}
        htmlFor="bid-price"
        error={errors.price}
        hint={`Reserve ${fmtPrice(reserveH, quote.symbol)}, ceiling ${fmtPrice(ceilH, quote.symbol)}. Bid what one token is really worth to you.`}
      >
        <NumberInput
          id="bid-price"
          value={price}
          onChange={setPrice}
          prefix={/USD/.test(quote.symbol) ? "$" : undefined}
          suffix={/USD/.test(quote.symbol) ? undefined : quote.symbol}
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
            <button
              type="button"
              className="text-[12.5px] text-ink-3 hover:text-ink"
              onClick={() => setBudget(toNum(bal.data!, quote.decimals).toString())}
              disabled={busy}
            >
              Balance <span className="num">{fmtAmount(bal.data, quote.decimals)}</span>
            </button>
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

      <div className="rounded-lg border border-line bg-surface-2/60 p-4" aria-live="polite">
        <div className="text-[12.5px] font-medium text-ink">If the sale settled now with your bid</div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <div className="text-[12px] text-ink-3">You get</div>
            <div className="num mt-0.5 text-[15px] text-ink">{estimate ? `${fmtAmount(estimate.qty, sale.decimals)}` : "-"}</div>
            <div className="text-[11.5px] text-ink-3">{sale.symbol}</div>
          </div>
          <div>
            <div className="text-[12px] text-ink-3">You pay</div>
            <div className="num mt-0.5 text-[15px] text-ink">{estimate ? fmtAmount(estimate.paid, quote.decimals, { max: 2 }) : "-"}</div>
            <div className="text-[11.5px] text-ink-3">{estimate && estimate.qty > 0n ? `avg ${fmtPrice(toNum(estimate.paid, quote.decimals) / toNum(estimate.qty, sale.decimals), quote.symbol)}` : quote.symbol}</div>
          </div>
          <div>
            <div className="text-[12px] text-ink-3">Refunded</div>
            <div className="num mt-0.5 text-[15px] text-ink">{estimate ? fmtAmount(estimate.refund, quote.decimals, { max: 2 }) : "-"}</div>
            <div className="text-[11.5px] text-ink-3">{quote.symbol}</div>
          </div>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
          Computed in your browser with the contract's own engine on every current bid plus yours. It changes as others bid. Bidding your true value is
          optimal, and splitting your budget across wallets can only lower what you get.
        </p>
      </div>

      {errors.form && <Notice tone="warn">{errors.form}</Notice>}

      {valid && (
        <ol className="flex flex-col gap-1.5 text-[13px]" aria-label="Steps">
          <StepRow
            n={1}
            label={`Approve ${fmtAmount(budgetRaw!, quote.decimals)} ${quote.symbol}`}
            state={!needsApproval && step !== "approving" ? "done" : step === "approving" ? "active" : "todo"}
          />
          <StepRow n={2} label="Escrow the budget and place the bid" state={step === "bidding" ? "active" : step === "done" ? "done" : "todo"} />
        </ol>
      )}

      {!isConnected ? (
        <Notice tone="info">Connect a wallet to bid. On the local chain, pick a demo wallet from the Connect menu.</Notice>
      ) : (
        <Button type="submit" variant="primary" size="lg" disabled={!valid || busy} loading={busy}>
          {step === "approving" ? `Approving ${quote.symbol}…` : step === "bidding" ? "Placing bid…" : needsApproval ? `Approve and bid` : "Place bid"}
        </Button>
      )}
      <p className="text-[12px] text-ink-3">
        Closes in <span className="num">{fmtDuration(secondsLeft)}</span>. Your budget is held in <Term tip={TERMS.escrow}>escrow</Term> until
        settlement. Allowance: {allowance.data === undefined ? "-" : allowance.data >= maxUint256 / 2n ? "unlimited" : `${fmt(toNum(allowance.data, quote.decimals))} ${quote.symbol}`}.
      </p>
    </form>
  );
}

function StepRow({ n, label, state }: { n: number; label: string; state: "todo" | "active" | "done" }) {
  return (
    <li className={cx("flex items-center gap-2", state === "todo" ? "text-ink-3" : "text-ink")}>
      {state === "done" ? (
        <CheckCircle size={16} weight="fill" className="text-accent" aria-hidden />
      ) : state === "active" ? (
        <Spinner className="mx-px" />
      ) : (
        <Circle size={16} aria-hidden />
      )}
      <span>
        <span className="sr-only">Step {n}: </span>
        {label}
        {state === "done" && <span className="sr-only"> (done)</span>}
      </span>
    </li>
  );
}
