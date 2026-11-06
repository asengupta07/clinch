import { ArrowCounterClockwise, CheckCircle, Pause, Play, Warning } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useAccount } from "wagmi";
import { Badge, Button, cx, Term, TERMS } from "../../components/ui";
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
    return <p className="px-5 py-6 text-[13px] text-bad">Could not replay the ladder: {error}</p>;
  }
  if (last < 0) return <p className="px-5 py-6 text-[13px] text-ink-3">No eligible bids, so the ladder never moved.</p>;

  const s = trace[Math.min(i, last)];
  const prev = i > 0 ? trace[i - 1] : null;
  const supply = launch.params.supply;
  const pMin = toNum(trace[0].p, 0);
  const pMax = toNum(trace[last].p, 0);
  const clinchedTotal = s.qty.reduce((a, b) => a + b, 0n);
  // first step at which each bid exited (hit its limit)
  const exitStep = new Map<number, number>();
  trace.forEach((t, k) => t.exited.forEach((b) => exitStep.has(b) || exitStep.set(b, k)));

  // ladder sparkline geometry
  const W = 600;
  const H = 72;
  const xs = (k: number) => (last === 0 ? W : (k / last) * W);
  const ys = (p: bigint) => (pMax === pMin ? H / 2 : H - 4 - ((toNum(p, 0) - pMin) / (pMax - pMin)) * (H - 10));
  const path = trace.map((t, k) => `${k ? "L" : "M"}${xs(k).toFixed(1)},${ys(t.p).toFixed(1)}`).join("");

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 px-5 pt-5">
        <div>
          <div className="text-[12px] text-ink-3">
            Ladder price, step <span className="num">{i + 1}</span> of <span className="num">{last + 1}</span>
          </div>
          <div className="num mt-0.5 text-[30px] font-medium leading-none tracking-tight text-ink">
            {fmtPrice(rawToHumanPrice(s.p, sale.decimals, quote.decimals), quote.symbol, { min: 4, max: 4 })}
          </div>
          <div className="num mt-1 text-[12.5px] text-ink-3">
            {fmtAmount(clinchedTotal, sale.decimals, { max: 0 })} of {fmtAmount(supply, sale.decimals, { max: 0 })} {sale.symbol} clinched ({fmtPct(Number((clinchedTotal * 10_000n) / supply) / 10_000, 1)})
          </div>
        </div>
        <div className="flex items-center gap-2">
          {check &&
            (check.ok ? (
              <Badge tone="accent">
                <CheckCircle size={14} weight="fill" /> matches chain
              </Badge>
            ) : (
              <Badge tone="bad">
                <Warning size={14} /> differs from chain
              </Badge>
            ))}
          <Button
            size="sm"
            onClick={() => {
              if (i >= last) setI(0);
              setPlaying((p) => !p);
            }}
            aria-label={playing ? "Pause replay" : "Play replay"}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
            {playing ? "Pause" : i >= last ? "Replay" : "Play"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setPlaying(false);
              setI(0);
            }}
            aria-label="Back to the first step"
          >
            <ArrowCounterClockwise size={14} />
          </Button>
        </div>
      </div>

      <div className="px-5 pt-4">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[72px] w-full" aria-hidden>
          <path d={path} fill="none" stroke="var(--line-strong)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <path
            d={trace
              .slice(0, i + 1)
              .map((t, k) => `${k ? "L" : "M"}${xs(k).toFixed(1)},${ys(t.p).toFixed(1)}`)
              .join("")}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <label className="sr-only" htmlFor="ladder-step">
          Ladder step
        </label>
        <input
          id="ladder-step"
          type="range"
          min={0}
          max={last}
          value={i}
          onChange={(e) => {
            setPlaying(false);
            setI(Number(e.target.value));
          }}
          className="mt-2 w-full"
        />
        <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
          The price climbs from the reserve in <Term tip={TERMS.ladder}>{fmtPct(toNum(launch.params.eps, 18), 1)} steps</Term>. At each step a bidder{" "}
          <Term tip={TERMS.clinch}>clinches</Term> whatever the others can no longer absorb, at that price. A bidder whose maximum is reached drops out.
        </p>
      </div>

      <ul className="mt-4 divide-y divide-line border-t border-line">
        {launch.bids.map((b, k) => {
          const q = s.qty[k];
          const lit = prev !== null && q > prev.qty[k];
          const out = (exitStep.get(k) ?? Infinity) <= i;
          const share = Number((q * 10_000n) / supply) / 10_000;
          const mine = address && b.owner.toLowerCase() === address.toLowerCase();
          return (
            <li key={k} className={cx("grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 px-5 py-2.5 sm:grid-cols-[200px_minmax(0,1fr)_150px]", out && q === 0n && "opacity-55")}>
              <div className="min-w-0 text-[12.5px]">
                <span className="num text-ink">{shortAddr(b.owner)}</span>
                {mine && <span className="ml-1.5 text-[11px] font-medium text-accent">you</span>}
                <div className="num text-[11.5px] text-ink-3">
                  max {fmtPrice(rawToHumanPrice(b.limit, sale.decimals, quote.decimals), quote.symbol)} {out && <span className="ml-1">dropped out</span>}
                </div>
              </div>
              <div className="col-span-2 row-start-2 flex items-center sm:col-span-1 sm:row-start-auto">
                <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={cx("absolute inset-y-0 left-0 w-full origin-left rounded-full transition-[transform,background-color] duration-200 ease-out", lit ? "bg-accent" : "bg-accent/55")}
                    style={{ transform: `scaleX(${Math.min(1, share)})` }}
                  />
                </div>
              </div>
              <div className="num text-right text-[12.5px] text-ink">
                {fmtAmount(q, sale.decimals, { max: 0 })} <span className="text-ink-3">{sale.symbol}</span>
                <div className="text-[11.5px] text-ink-3">paid {fmtAmount(s.paid[k], quote.decimals, { max: 2 })}</div>
              </div>
            </li>
          );
        })}
      </ul>
      {check && !check.ok && (
        <div className="border-t border-line px-5 py-3 text-[12px] text-bad">
          The replay differs from the on-chain result: {check.details.slice(0, 3).join("; ")}. The table below shows the chain's numbers.
        </div>
      )}
      {check?.ok && (
        <div className="border-t border-line px-5 py-3 text-[12px] text-ink-3">
          Recomputed in your browser from the on-chain bids. Every allocation, payment and the final price equal the values stored by{" "}
          <code className="num">settle()</code>{check.maxPaidErr > 0n || check.maxQtyErr > 0 ? " within rounding" : " exactly"}.
        </div>
      )}
    </div>
  );
}
