import { CheckCircle } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { erc20Abi, hookAbi } from "../../abi";
import { Button, Field, Notice, NumberInput, Segmented, Spinner, Term, TERMS, cx } from "../../components/ui";
import { deployments } from "../../config/env";
import { useAllowance, useBalance, type MarketInfo, type PoolKey, type TokenMeta } from "../../hooks/data";
import { useTx } from "../../hooks/useTx";
import { HOOK_MAX_STEPS, twoSided, type Order } from "../../engine/wad";
import { fmtAmount, fmtPct, fmtPrice } from "../../lib/format";
import { fillPrice } from "../../lib/market";
import { hookPriceToHuman, orderParams, parseDecimal, toNum, type MarketOrientation, type Side } from "../../lib/units";

export interface OpenBatchContext {
  /** orders of the batch a new order would join (empty if it would open a new batch) */
  orders: readonly { zeroForOne: boolean; limit: bigint; budget: bigint }[];
  sum0: bigint;
  sum1: bigint;
  nOrders: number;
  joinsNew: boolean;
  batchId: bigint;
}

interface Cfg {
  maxOrders: number;
  maxDepthBps: number;
  eps: bigint;
  minOrder0: bigint;
  minOrder1: bigint;
}

export function OrderForm({
  m,
  base,
  quote,
  o,
  reserves,
  cfg,
  ctx,
}: {
  m: MarketInfo;
  base: TokenMeta;
  quote: TokenMeta;
  o: MarketOrientation;
  reserves: readonly [bigint, bigint];
  cfg: Cfg;
  ctx: OpenBatchContext;
}) {
  const { address, isConnected } = useAccount();
  const [side, setSide] = useState<Side>("buy");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"idle" | "approving" | "placing" | "done">("idle");
  const { send } = useTx();

  const [r0, r1] = reserves;
  const spotRaw = r0 > 0n ? (r1 * 10n ** 18n) / r0 : 0n; // token1 per token0, same rounding as the hook
  const spot = spotRaw > 0n ? hookPriceToHuman(spotRaw, o) : null;
  const sold = side === "buy" ? quote : base;
  const bal = useBalance(sold.address, address);
  const allowance = useAllowance(sold.address, address, deployments.hook);

  const op = price ? orderParams(side, price, o) : null;
  const amt = amount ? parseDecimal(amount, sold.decimals) : null;

  const errors = useMemo(() => {
    const e: { price?: string; amount?: string; form?: string } = {};
    if (price) {
      if (!op || op.limit === 0n) e.price = "Enter a valid price.";
      else if (op.zeroForOne ? op.limit > spotRaw : op.limit < spotRaw)
        e.price =
          side === "buy"
            ? `A buy limit must be at or above spot (${fmtPrice(spot, quote.symbol)}). Orders are only accepted if they can trade at spot.`
            : `A sell limit must be at or below spot (${fmtPrice(spot, quote.symbol)}). Orders are only accepted if they can trade at spot.`;
    }
    if (amount && op) {
      const min = op.zeroForOne ? cfg.minOrder0 : cfg.minOrder1;
      if (amt === null) e.amount = `Enter an amount with at most ${sold.decimals} decimals.`;
      else if (amt === 0n) e.amount = "Enter an amount.";
      else if (amt < min) e.amount = `The minimum order is ${fmtAmount(min, sold.decimals)} ${sold.symbol}.`;
      else if (bal.data !== undefined && amt > bal.data) e.amount = `You have ${fmtAmount(bal.data, sold.decimals)} ${sold.symbol}.`;
      else {
        const reserve = op.zeroForOne ? r0 : r1;
        const sum = op.zeroForOne ? ctx.sum0 : ctx.sum1;
        const cap = (reserve * BigInt(cfg.maxDepthBps)) / 10_000n;
        if ((sum + amt) * 10_000n > reserve * BigInt(cfg.maxDepthBps)) {
          const room = cap > sum ? cap - sum : 0n;
          e.amount = `This batch is full for this side (${fmtPct(cfg.maxDepthBps / 10_000, 0)} of pool). At most ${fmtAmount(room, sold.decimals)} ${sold.symbol} more fits; try a smaller order or the next batch.`;
        }
      }
    }
    if (!ctx.joinsNew && ctx.nOrders >= cfg.maxOrders) e.form = "This batch already has the maximum number of orders. A new batch opens after it closes.";
    return e;
  }, [price, amount, op, amt, spotRaw, spot, side, quote.symbol, cfg, sold, bal.data, r0, r1, ctx]);

  const valid = !!op && !!amt && amt > 0n && !errors.price && !errors.amount && !errors.form;
  const needsApproval = valid && allowance.data !== undefined && allowance.data < amt!;

  // Estimate: the exact on-chain engine on the batch's orders plus this one, at current reserves.
  const est = useMemo(() => {
    if (!valid) return null;
    try {
      const orders: Order[] = [...ctx.orders.map((x) => ({ zeroForOne: x.zeroForOne, limit: x.limit, budget: x.budget })), { zeroForOne: op!.zeroForOne, limit: op!.limit, budget: amt! }];
      const t = twoSided(orders, r0, r1, { eps: cfg.eps, pMax: 0n, maxSteps: HOOK_MAX_STEPS });
      const i = orders.length - 1;
      const dominant = t.buyersDominant === !op!.zeroForOne;
      return { spent: t.spent[i], received: t.received[i], dominant, avg: fillPrice(side, t.spent[i], t.received[i], o) };
    } catch {
      return null;
    }
  }, [valid, ctx.orders, op, amt, r0, r1, cfg.eps, side, o]);

  const quick = (pct: number) => {
    if (!spot) return;
    const v = spot * (1 + pct);
    // round in the direction that keeps the order marketable
    // about 5 significant digits, never more than the quote token can express
    const d = Math.min(quote.decimals, Math.max(2, 4 - Math.floor(Math.log10(v))));
    const f = 10 ** d;
    setPrice((side === "buy" ? Math.ceil(v * f) / f : Math.floor(v * f) / f).toFixed(d));
  };

  const submit = async () => {
    if (!valid) return;
    if (needsApproval) {
      setStep("approving");
      const ok = await send({ label: `Approve ${sold.symbol}`, address: sold.address, abi: erc20Abi, functionName: "approve", args: [deployments.hook, amt!] });
      if (!ok) return setStep("idle");
      await allowance.refetch();
    }
    setStep("placing");
    const key: PoolKey = m.key;
    const r = await send({
      label: `${side === "buy" ? "Buy" : "Sell"} ${base.symbol}`,
      address: deployments.hook,
      abi: hookAbi,
      functionName: "placeOrder",
      args: [key, op!.zeroForOne, op!.limit, amt!],
      success: `Order escrowed in batch ${ctx.joinsNew ? (ctx.batchId + 1n).toString() : ctx.batchId.toString()}.`,
    });
    if (r) {
      setStep("done");
      setAmount("");
      setTimeout(() => setStep("idle"), 2500);
    } else setStep("idle");
  };

  const busy = step === "approving" || step === "placing";
  const recvDec = side === "buy" ? base.decimals : quote.decimals;
  const recvSym = side === "buy" ? base.symbol : quote.symbol;

  const presets = side === "buy" ? [0, 0.005, 0.01] : [0, -0.005, -0.01];
  const batchLabel = ctx.joinsNew ? (ctx.batchId + 1n).toString() : ctx.batchId.toString();

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="[&>div]:w-full">
        <Segmented
          label="Side"
          value={side}
          onChange={(s) => {
            setSide(s);
            setPrice("");
            setAmount("");
          }}
          options={[
            { value: "buy", label: `Buy ${base.symbol}` },
            { value: "sell", label: `Sell ${base.symbol}` },
          ]}
        />
      </div>
      <p className="-mt-2 text-[12.5px] text-ink-3">
        {ctx.joinsNew ? (
          <>
            Opens batch <span className="num text-ink-2">#{batchLabel}</span>.
          </>
        ) : (
          <>
            Joins open batch <span className="num text-ink-2">#{batchLabel}</span> with <span className="num text-ink-2">{ctx.nOrders}</span> order
            {ctx.nOrders === 1 ? "" : "s"}.
          </>
        )}{" "}
        Spot <span className="num text-ink-2">{fmtPrice(spot, quote.symbol)}</span>
      </p>

      <Field
        label={side === "buy" ? `Maximum price` : `Minimum price`}
        htmlFor="order-price"
        error={errors.price}
        hint={side === "buy" ? "The most you will pay per unit. Your true value is the best answer." : "The least you will accept per unit."}
        right={
          <span className="text-[12px] text-ink-3">
            {quote.symbol} per {base.symbol}
          </span>
        }
      >
        <NumberInput id="order-price" value={price} onChange={setPrice} suffix={quote.symbol} placeholder={spot ? String(Math.round(spot * 100) / 100) : ""} invalid={!!errors.price} disabled={busy} describedBy={errors.price ? "order-price-error" : "order-price-hint"} />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Price presets relative to spot">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => quick(p)}
              disabled={busy || !spot}
              className="inline-flex h-9 items-center rounded-full bg-surface-2 px-3 text-[12.5px] text-ink-2 ring-1 ring-inset ring-line transition-[background-color,color,box-shadow] duration-200 ease-[var(--ease-out-quint)] hover:bg-surface-3 hover:text-ink hover:ring-line-strong active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 sm:h-7"
            >
              {p === 0 ? "Spot" : <span className="num">{`${p > 0 ? "+" : ""}${(p * 100).toFixed(1)}%`}</span>}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label={side === "buy" ? `Budget` : `Amount to sell`}
        htmlFor="order-amount"
        error={errors.amount}
        hint="Escrowed until the batch settles. Unused budget is refunded on claim."
        right={
          isConnected && bal.data !== undefined ? (
            <span className="flex items-center gap-2 text-[12px] text-ink-3">
              <span>
                Balance <span className="num text-ink-2">{fmtAmount(bal.data, sold.decimals)}</span>
              </span>
              <button
                type="button"
                className="inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-medium text-accent ring-1 ring-inset ring-accent-line transition-colors duration-200 hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-45"
                onClick={() => setAmount(toNum(bal.data!, sold.decimals).toString())}
                disabled={busy}
                aria-label={`Use full balance, ${fmtAmount(bal.data, sold.decimals)} ${sold.symbol}`}
              >
                Max
              </button>
            </span>
          ) : null
        }
      >
        <NumberInput id="order-amount" value={amount} onChange={setAmount} suffix={sold.symbol} invalid={!!errors.amount} disabled={busy} describedBy={errors.amount ? "order-amount-error" : "order-amount-hint"} />
      </Field>

      <div className="rounded-2xl bg-surface-2 ring-1 ring-inset ring-line" aria-live="polite">
        <div className="flex items-baseline justify-between gap-2 px-4 pt-3.5">
          <span className="text-[13px] font-medium text-ink">If this batch settled now</span>
          <span className="text-[12px] text-ink-3">estimate</span>
        </div>
        <dl className="grid grid-cols-3 divide-x divide-line px-1 py-3.5">
          {[
            ["You get", est ? fmtAmount(est.received, recvDec) : "-", recvSym],
            ["You spend", est ? fmtAmount(est.spent, sold.decimals) : "-", sold.symbol],
            ["Avg price", est?.avg ? fmtPrice(est.avg, quote.symbol) : "-", est ? (est.dominant ? "dominant side" : "minority, at spot") : "\u00a0"],
          ].map(([k, v, u]) => (
            <div key={k} className="min-w-0 px-3">
              <dt className="text-[12px] text-ink-3">{k}</dt>
              <dd className={cx("num mt-1 truncate text-[15px]", est ? "text-ink" : "text-ink-3")}>{v}</dd>
              <dd className="truncate text-[11.5px] text-ink-3">{u}</dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-line px-4 py-3 text-[12px] leading-relaxed text-ink-3">
          Computed in your browser with the hook's own engine on this batch's orders plus yours, before any <Term tip={TERMS.rebate}>rebate</Term>. The{" "}
          <Term tip={TERMS.dominant}>minority side</Term> fills at spot; the dominant side clinches on a rising price.
        </p>
      </div>

      {errors.form && <Notice tone="warn">{errors.form}</Notice>}
      {valid && (
        <ol className="flex flex-col gap-2 text-[13px]" aria-label="Steps">
          <Row n={1} label={`Approve ${fmtAmount(amt!, sold.decimals)} ${sold.symbol}`} state={!needsApproval && step !== "approving" ? "done" : step === "approving" ? "active" : "todo"} />
          <Row n={2} label={`Escrow and place the order in batch ${batchLabel}`} state={step === "placing" ? "active" : step === "done" ? "done" : "todo"} />
        </ol>
      )}
      {!isConnected ? (
        <Notice tone="info">Connect a wallet to trade. On the local chain, pick a demo wallet from the Connect menu.</Notice>
      ) : (
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!valid || busy} loading={busy}>
          {step === "approving" ? `Approving ${sold.symbol}…` : step === "placing" ? "Placing order…" : `${needsApproval ? "Approve and " : ""}${side === "buy" ? "buy" : "sell"} ${base.symbol}`.replace(/^./, (c) => c.toUpperCase())}
        </Button>
      )}
    </form>
  );
}

function Row({ n, label, state }: { n: number; label: string; state: "todo" | "active" | "done" }) {
  return (
    <li className={cx("flex items-center gap-2.5", state === "todo" ? "text-ink-3" : "text-ink")}>
      <span className="inline-flex size-5 shrink-0 items-center justify-center">
        {state === "done" ? (
          <CheckCircle size={18} weight="fill" className="text-accent" aria-hidden />
        ) : state === "active" ? (
          <Spinner />
        ) : (
          <span aria-hidden className="num inline-flex size-[18px] items-center justify-center rounded-full text-[11px] ring-1 ring-inset ring-line-strong">
            {n}
          </span>
        )}
      </span>
      <span>
        {label}
        {state === "done" && <span className="sr-only"> (done)</span>}
        {state === "active" && <span className="sr-only"> (in progress)</span>}
      </span>
    </li>
  );
}
