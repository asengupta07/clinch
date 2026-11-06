import { ArrowCounterClockwise, CheckCircle, Pause, Play, SkipBack, Warning } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useAccount } from "wagmi";
import { Badge, cx, Term, TERMS } from "../../components/ui";
import type { TraceStep } from "../../engine/wad";
import type { LaunchData, TokenMeta } from "../../hooks/data";
import { fmtAmount, fmtPct, fmtPrice, shortAddr } from "../../lib/format";
import { runLaunch, verifyOutcome } from "../../lib/launch";
import { rawToHumanPrice, toNum } from "../../lib/units";

/**
 * Replays the settled launch's price ladder step by step, computed in the browser by the TS port
 * of ClinchEngine on the on-chain bids, and checks the result against the chain.
 */
export function LadderReplay({ launch, sale, quote }: { launch: LaunchData; sale: TokenMeta; quote: TokenMeta }) {
  const { address } = useAccount();
  const reduce = useReducedMotion();
  const { trace, check, error } = useMemo(() => {
    try {
      const trace: TraceStep[] = [];
      const r = runLaunch(launch.params, launch.bids, trace);
      const check = verifyOutcome(
        r,
        { qty: launch.bids.map((b) => b.qty), paid: launch.bids.map((b) => b.paid), X: launch.sold, Y: launch.proceeds, pFinal: launch.clearingPrice },
        launch.params.supply,
      );
      // The engines are the same integer algorithm; a mismatch means the UI would be showing something false.
      console.assert(check.ok, "Ladder replay does not match the on-chain settlement", check.details);
      return { trace, check, error: null as string | null };
    } catch (e) {
      return { trace: [] as TraceStep[], check: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [launch]);

  const last = trace.length - 1;
  const [i, setI] = useState(reduce ? last : 0);
  const [playing, setPlaying] = useState(!reduce);

  useEffect(() => {
    if (!playing || last < 0) return;
    // about 7 seconds end to end, however many steps the ladder took
    const per = Math.max(1, Math.ceil(trace.length / 175));
    const t = setInterval(() => {
      setI((x) => {
        const nx = Math.min(last, x + per);
        if (nx >= last) setPlaying(false);
        return nx;
      });
    }, 40);
    return () => clearInterval(t);
  }, [playing, last, trace.length]);

  if (error) {
    return (
      <p className="px-5 py-6 text-[13px] text-bad sm:px-6" role="alert">
        Could not replay the ladder: {error}
      </p>
    );
  }
  if (last < 0)
    return (
      <div className="px-5 py-6 sm:px-6">
        <h2 className="text-[15px] font-medium text-ink">Price ladder replay</h2>
        <p className="mt-1.5 text-[13px] text-ink-3">No eligible bids, so the ladder never moved.</p>
      </div>
    );

  const s = trace[Math.min(i, last)];
  const prev = i > 0 ? trace[i - 1] : null;
  const supply = launch.params.supply;
  const pMin = toNum(trace[0].p, 0);
  const pMax = toNum(trace[last].p, 0);
  const clinchedTotal = s.qty.reduce((a, b) => a + b, 0n);
  const atEnd = i >= last;
  // first step at which each bid exited (hit its limit)
  const exitStep = new Map<number, number>();
  trace.forEach((t, k) => t.exited.forEach((b) => exitStep.has(b) || exitStep.set(b, k)));
  // bars are scaled to the largest final allocation so small fills stay readable
  const maxFinal = trace[last].qty.reduce((m, q) => (q > m ? q : m), 0n);

  // stair-step ladder geometry: the price holds for a step, then jumps to the next rung
  const W = 600;
  const H = 96;
  const xs = (k: number) => (last === 0 ? W : (k / last) * W);
  const ys = (p: bigint) => (pMax === pMin ? H / 2 : H - 6 - ((toNum(p, 0) - pMin) / (pMax - pMin)) * (H - 14));
  const stairs = (upto: number) =>
    trace
      .slice(0, upto + 1)
      .map((t, k) => (k === 0 ? `M0,${ys(t.p).toFixed(1)}` : `H${xs(k).toFixed(1)}V${ys(t.p).toFixed(1)}`))
      .join("");
  const dotX = (xs(Math.min(i, last)) / W) * 100;
  const dotY = (ys(s.p) / H) * 100;

  const iconBtn =
    "inline-flex size-11 items-center justify-center rounded-full bg-surface-2 text-ink ring-1 ring-inset ring-line-strong transition-[background-color,transform] duration-200 ease-[var(--ease-out-quint)] hover:bg-surface-3 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 sm:size-10";

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="min-w-0">
          <h2 className="text-[13.5px] text-ink-2">Price ladder replay</h2>
          <div className="num mt-2 text-[36px] leading-none tracking-[-0.03em] text-ink sm:text-[44px]">
            {fmtPrice(rawToHumanPrice(s.p, sale.decimals, quote.decimals), quote.symbol, { min: 4, max: 4 })}
          </div>
          <p className="num mt-2.5 text-[12.5px] text-ink-3">
            Step {i + 1} of {last + 1}, {fmtAmount(clinchedTotal, sale.decimals, { max: 0 })} of {fmtAmount(supply, sale.decimals, { max: 0 })} {sale.symbol}{" "}
            clinched ({fmtPct(Number((clinchedTotal * 10_000n) / supply) / 10_000, 1)})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {check &&
            (check.ok ? (
              <Badge tone="accent" className="h-8 px-3">
                <CheckCircle size={14} weight="fill" aria-hidden /> matches chain
              </Badge>
            ) : (
              <Badge tone="bad" className="h-8 px-3">
                <Warning size={14} aria-hidden /> differs from chain
              </Badge>
            ))}
          <button
            type="button"
            className={iconBtn}
            onClick={() => {
              if (i >= last) setI(0);
              setPlaying((p) => !p);
            }}
            aria-label={playing ? "Pause replay" : atEnd ? "Replay from the start" : "Play replay"}
            title={playing ? "Pause" : atEnd ? "Replay" : "Play"}
          >
            {playing ? <Pause size={16} weight="fill" aria-hidden /> : atEnd ? <ArrowCounterClockwise size={16} weight="bold" aria-hidden /> : <Play size={16} weight="fill" aria-hidden />}
          </button>
          <button
            type="button"
            className={iconBtn}
            onClick={() => {
              setPlaying(false);
              setI(0);
            }}
            aria-label="Back to the first step"
            title="Back to the first step"
            disabled={i === 0 && !playing}
          >
            <SkipBack size={16} weight="fill" aria-hidden />
          </button>
        </div>
      </div>

      <div className="px-5 pt-5 sm:px-6">
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[96px] w-full" aria-hidden>
            <path d={stairs(last)} fill="none" stroke="var(--line-strong)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            <path d={stairs(i)} fill="none" stroke="var(--price)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          <span
            aria-hidden
            className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-price shadow-[0_0_0_4px_var(--price-soft)]"
            style={{ left: `${dotX}%`, top: `${dotY}%` }}
          />
        </div>
        <div className="num mt-1.5 flex justify-between text-[11.5px] text-ink-3" aria-hidden>
          <span>{fmtPrice(rawToHumanPrice(trace[0].p, sale.decimals, quote.decimals), quote.symbol)}</span>
          <span>{fmtPrice(rawToHumanPrice(trace[last].p, sale.decimals, quote.decimals), quote.symbol)}</span>
        </div>
        <label className="sr-only" htmlFor="ladder-step">
          Ladder step
        </label>
        <input
          id="ladder-step"
          type="range"
          min={0}
          max={last}
          value={i}
          aria-valuetext={`Step ${i + 1} of ${last + 1}`}
          onChange={(e) => {
            setPlaying(false);
            setI(Number(e.target.value));
          }}
          className="mt-3 h-6 w-full cursor-pointer"
        />
        <p className="mt-2 max-w-[72ch] text-[12.5px] leading-relaxed text-ink-3">
          The price climbs from the reserve in <Term tip={TERMS.ladder}>{fmtPct(toNum(launch.params.eps, 18), 1)} steps</Term>. At each step a bidder{" "}
          <Term tip={TERMS.clinch}>clinches</Term> whatever the others can no longer absorb, at that price. A bidder whose maximum is reached drops out.
        </p>
      </div>

      <ul className="mt-5 border-t border-line" aria-label="Bidders at this step">
        {launch.bids.map((b, k) => {
          const q = s.qty[k];
          const lit = prev !== null && q > prev.qty[k] && !atEnd;
          const out = (exitStep.get(k) ?? Infinity) <= i;
          const fill = maxFinal > 0n ? Number((q * 10_000n) / maxFinal) / 10_000 : 0;
          const mine = !!address && b.owner.toLowerCase() === address.toLowerCase();
          return (
            <li
              key={k}
              className={cx(
                "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 border-b border-line px-5 py-3 transition-opacity duration-200 last:border-0 sm:grid-cols-[minmax(0,170px)_minmax(0,1fr)_minmax(0,150px)] sm:items-center sm:px-6",
                out && q === 0n && "opacity-55",
                mine && "bg-accent-soft",
              )}
            >
              <div className="min-w-0 text-[12.5px]">
                <span className="num text-ink">{shortAddr(b.owner)}</span>
                {mine && <span className="ml-1.5 text-[11.5px] font-medium text-accent">you</span>}
                <div className="num text-[12px] text-ink-3">
                  max {fmtPrice(rawToHumanPrice(b.limit, sale.decimals, quote.decimals), quote.symbol)}
                  {out && <span className="ml-1.5">dropped out</span>}
                  {lit && <span className="ml-1.5 text-price">clinching</span>}
                </div>
              </div>
              <div className="col-span-2 row-start-2 flex items-center sm:col-span-1 sm:row-start-auto" aria-hidden>
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={cx(
                      "absolute inset-y-0 left-0 w-full origin-left rounded-full transition-[transform,background-color] duration-200 ease-[var(--ease-out-quint)]",
                      lit ? "bg-price" : mine ? "bg-accent" : "bg-accent/55",
                    )}
                    style={{ transform: `scaleX(${Math.min(1, fill)})` }}
                  />
                </div>
              </div>
              <div className="num text-right text-[12.5px] text-ink">
                {fmtAmount(q, sale.decimals, { max: 0 })} <span className="text-ink-3">{sale.symbol}</span>
                <div className="text-[12px] text-ink-3">paid {fmtAmount(s.paid[k], quote.decimals, { max: 2 })}</div>
              </div>
            </li>
          );
        })}
      </ul>
      {check && !check.ok && (
        <div className="border-t border-line px-5 py-3.5 text-[12.5px] text-bad sm:px-6" role="alert">
          The replay differs from the on-chain result: {check.details.slice(0, 3).join("; ")}. The results below show the chain's numbers.
        </div>
      )}
      {check?.ok && (
        <div className="flex gap-2 border-t border-line px-5 py-3.5 text-[12.5px] leading-relaxed text-ink-3 sm:px-6">
          <CheckCircle size={15} weight="fill" className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <span>
            Recomputed in your browser from the on-chain bids. Every allocation, payment and the final price equal the values stored by{" "}
            <code className="num">settle()</code>
            {check.maxPaidErr > 0n || check.maxQtyErr > 0 ? " within rounding" : " exactly"}.
          </span>
        </div>
      )}
    </div>
  );
}
