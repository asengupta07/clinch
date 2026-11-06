import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { traceFixed } from "./trace";

/**
 * A real clinching auction, replayed. Five wallets bid (max price, budget) for 1,000 tokens from a
 * $1.00 reserve. Every frame is one ladder step of the same engine the contracts run.
 */
const SUPPLY = 1000;
const RESERVE = 1;
const EPS = 0.03;
const WALLETS = [
  { label: "0x7a3f…whale", limit: 3.0, budget: 900 },
  { label: "0x51c0…e2b9", limit: 2.8, budget: 600 },
  { label: "0x9d14…07af", limit: 2.4, budget: 700 },
  { label: "0x2be8…c4d1", limit: 1.9, budget: 380 },
  { label: "0xe06a…913c", limit: 1.45, budget: 260 },
] as const;

const usd = (v: number) => `$${v.toFixed(2)}`;
const tok = (v: number) => Math.round(v).toLocaleString("en-US");

export function ClinchLadder() {
  const reduced = useReducedMotion();
  const frames = useMemo(() => traceFixed(WALLETS.map((w) => [w.limit, w.budget] as const), SUPPLY, RESERVE, EPS), []);
  const last = frames.length - 1;
  const [k, setK] = useState(reduced ? last : 0);
  const [visible, setVisible] = useState(true);
  const root = useRef<HTMLDivElement>(null);

  // only animate while on screen
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (reduced) {
      setK(last);
      return;
    }
    if (!visible) return;
    // quick through quiet steps, linger on clinches, hold the result, then replay
    const f = frames[k];
    const busy = f.clinching.some(Boolean);
    const delay = k === last ? 4200 : k === 0 ? 900 : busy ? 420 : 120;
    const t = setTimeout(() => setK((i) => (i >= last ? 0 : i + 1)), delay);
    return () => clearTimeout(t);
  }, [k, last, frames, reduced, visible]);

  const f = frames[k];
  const maxX = 520;
  const history = frames.slice(0, k + 1).map((g) => g.p);
  const pMin = RESERVE;
  const pMax = frames[last].p * 1.04;
  const spark = history
    .map((p, i) => {
      const x = (i / last) * 100;
      const y = 28 - ((p - pMin) / (pMax - pMin)) * 26;
      return `${i === 0 ? "M" : "H"}${x.toFixed(2)}${i === 0 ? ` ${y.toFixed(2)}` : ` V${y.toFixed(2)}`}`;
    })
    .join(" ");
  const done = k === last;

  return (
    <div ref={root} className="rounded-[30px] bg-white/[0.035] p-1.5 ring-1 ring-white/[0.09]">
      <div className="relative overflow-hidden rounded-[24px] bg-[#0a0d0b]/90 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] sm:p-6">
        {/* header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="live-dot inline-block size-1.5 rounded-full bg-[var(--l-mint)]" aria-hidden />
            <span className="eyebrow text-[var(--l-ink-3)]">Replay · 1,000 token sale</span>
          </div>
          <span className="mono text-[11px] text-[var(--l-ink-3)]">
            step {String(k + 1).padStart(2, "0")}/{frames.length}
          </span>
        </div>

        {/* clock */}
        <div className="mt-6 flex items-end justify-between gap-6">
          <div>
            <div className="mono text-[11px] text-[var(--l-ink-3)]">clock price</div>
            <div className="mono mt-1 text-[40px] leading-none tracking-[-0.03em] text-[var(--l-ink)] sm:text-[46px]">{usd(f.p)}</div>
          </div>
          <svg viewBox="0 0 100 30" className="h-12 w-[44%] overflow-visible" preserveAspectRatio="none" aria-hidden>
            <path d={spark} fill="none" stroke="var(--l-amber)" strokeWidth="1.4" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
        </div>

        <div className="hairline my-5" />

        {/* wallets */}
        <ul className="space-y-3.5" aria-label="Bidders">
          {WALLETS.map((w, i) => {
            const x = f.x[i];
            const out = f.out[i] && x < 1e-6;
            const hot = f.clinching[i];
            const avg = x > 0 ? f.paid[i] / x : 0;
            return (
              <li key={w.label} className="transition-opacity duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]" style={{ opacity: out ? 0.38 : 1 }}>
                <div className="flex items-baseline justify-between gap-3 text-[12px]">
                  <span className="mono truncate text-[var(--l-ink-2)]">{w.label}</span>
                  <span className="mono shrink-0 text-[var(--l-ink-3)]">
                    {out ? (
                      <>out at {usd(w.limit)}</>
                    ) : x > 0 ? (
                      <>
                        <span className="text-[var(--l-ink)]">{tok(x)}</span> @ avg {usd(avg)}
                      </>
                    ) : (
                      <>max {usd(w.limit)}</>
                    )}
                  </span>
                </div>
                <div className="relative mt-1.5 h-[5px] overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="absolute inset-y-0 left-0 w-full origin-left rounded-full transition-[transform,background-color] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
                    style={{
                      transform: `scaleX(${Math.min(1, x / maxX)})`,
                      backgroundColor: hot && !done ? "var(--l-amber)" : "var(--l-mint)",
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        <div className="hairline my-5" />

        <div className="flex items-center justify-between text-[12px]">
          <span className="text-[var(--l-ink-3)]">{done ? "Cleared. Every unit paid the price it was clinched at." : f.sold > 0 ? "Clinching: others can no longer absorb the supply." : "Price climbing. Nobody is priced out yet."}</span>
          <span className="mono shrink-0 pl-3 text-[var(--l-ink-2)]">
            {tok(f.sold)}
            <span className="text-[var(--l-ink-3)]">/{tok(SUPPLY)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
