import { ArrowUpRight, Check, LockSimple, X } from "@phosphor-icons/react";
import { motion, useInView, useReducedMotion, type Variants } from "motion/react";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, ScrollRestoration } from "react-router";
import { ShadeLab, WhaleLab } from "../pages/Home";
import { ClinchLadder } from "./ClinchLadder";
import "./landing.css";

const EASE = [0.32, 0.72, 0, 1] as const;

// Shader libraries are heavy; load them after the page paints.
const HeroShader = lazy(() => import("./HeroShader").then((m) => ({ default: m.HeroShader })));
const GrainGradient = lazy(() => import("@paper-design/shaders-react").then((m) => ({ default: m.GrainGradient })));

/* ------------------------------------------------------------------ motion primitives */

function Reveal({ children, delay = 0, className, as = "div" }: { children: ReactNode; delay?: number; className?: string; as?: "div" | "li" | "section" }) {
  const reduced = useReducedMotion();
  const M = motion[as];
  return (
    <M
      className={className}
      initial={reduced ? false : { opacity: 0, y: 36, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
      transition={{ duration: 1, ease: EASE, delay }}
    >
      {children}
    </M>
  );
}

/** Headline that rises line by line from behind a mask. */
function MaskedLines({ lines, className, delay = 0 }: { lines: ReactNode[]; className?: string; delay?: number }) {
  const reduced = useReducedMotion();
  const v: Variants = {
    // ascenders overshoot the tight 0.95 line box, so start well below the clip edge
    hidden: { y: "135%" },
    show: (i: number) => ({ y: "0%", transition: { duration: 1.1, ease: EASE, delay: delay + i * 0.09 } }),
  };
  return (
    <span className={className}>
      {lines.map((l, i) => (
        // Clip only the bottom edge (that is all the rise needs). Never clip sideways: if a font renders
        // wider than expected, the line must wrap or extend, not get chopped.
        <span key={i} className="block pb-[0.08em] [clip-path:inset(-0.5em_-100vw_0_-100vw)]">
          <motion.span className="block" custom={i} variants={v} initial={reduced ? false : "hidden"} animate="show">
            {l}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

function CountUp({ to, decimals = 0, suffix = "" }: { to: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduced = useReducedMotion();
  const [v, setV] = useState(reduced ? to : 0);
  useEffect(() => {
    if (!inView || reduced) return;
    const start = performance.now();
    const dur = 1600;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - k, 4);
      setV(to * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduced, to]);
  return (
    <span ref={ref}>
      {v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ building blocks */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="eyebrow inline-flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-1.5 text-[var(--l-ink-2)] ring-1 ring-white/[0.08]">
      <span className="inline-block size-1 rounded-full bg-[var(--l-mint)]" aria-hidden />
      {children}
    </span>
  );
}

/** Pill button with the trailing icon nested in its own island. */
function PillLink({ to, children, variant = "primary", external }: { to: string; children: ReactNode; variant?: "primary" | "ghost"; external?: boolean }) {
  const base =
    "group inline-flex items-center gap-3 rounded-full py-1.5 pl-6 pr-1.5 text-[14.5px] font-medium transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--focus)]";
  const styles =
    variant === "primary"
      ? "bg-[var(--l-ink)] text-[#070908] hover:bg-white"
      : "bg-white/[0.04] text-[var(--l-ink)] ring-1 ring-white/[0.12] hover:bg-white/[0.08]";
  const icon =
    variant === "primary" ? "bg-[#070908] text-[var(--l-ink)]" : "bg-white/[0.08] text-[var(--l-ink)]";
  const inner = (
    <>
      <span>{children}</span>
      <span className={`flex size-9 items-center justify-center rounded-full transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-px group-hover:scale-105 ${icon}`}>
        <ArrowUpRight size={15} weight="light" />
      </span>
    </>
  );
  if (external)
    return (
      <a href={to} className={`${base} ${styles}`} target="_blank" rel="noreferrer">
        {inner}
      </a>
    );
  if (to.startsWith("#"))
    return (
      <a href={to} className={`${base} ${styles}`}>
        {inner}
      </a>
    );
  return (
    <Link to={to} className={`${base} ${styles}`}>
      {inner}
    </Link>
  );
}

/** Double-bezel shell: a tray with a hairline, holding a machined inner plate. */
function Bezel({ children, className = "", inner = "" }: { children: ReactNode; className?: string; inner?: string }) {
  return (
    <div className={`rounded-[2rem] bg-white/[0.03] p-1.5 ring-1 ring-white/[0.075] ${className}`}>
      <div className={`h-full rounded-[calc(2rem-0.375rem)] bg-[var(--l-bg-2)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] ${inner}`}>{children}</div>
    </div>
  );
}

function Mark({ className = "" }: { className?: string }) {
  // a rising ladder: the clock steps up and clinches
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M3 19.5h4.5V15H12v-4.5h4.5V6H21" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="21" cy="6" r="1.9" fill="var(--l-mint)" />
    </svg>
  );
}

/* ------------------------------------------------------------------ nav */

const NAV = [
  { href: "#trilemma", label: "Why" },
  { href: "#how", label: "How it clears" },
  { href: "#lab", label: "Whale Lab" },
  { href: "#products", label: "Products" },
];

function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <div ref={sentinel} className="absolute top-0 h-px w-px" aria-hidden />
      <header className="fixed inset-x-0 top-4 z-30 flex justify-center px-4 sm:top-6">
        <motion.nav
          aria-label="Main"
          initial={{ y: -24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 1, ease: EASE, delay: 0.2 }}
          className={`flex w-full max-w-[720px] items-center gap-1 rounded-full py-1.5 pl-4 pr-1.5 ring-1 backdrop-blur-xl transition-colors duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] md:w-max ${
            scrolled ? "bg-[#0b0e0c]/90 ring-white/[0.1] shadow-[0_8px_32px_-12px_rgba(0,0,0,0.6)]" : "bg-white/[0.03] ring-white/[0.07]"
          }`}
        >
          <Link to="/" className="mr-3 flex items-center gap-2 text-[15px] font-medium tracking-tight text-[var(--l-ink)]" aria-label="Clinch home">
            <Mark className="size-5 text-[var(--l-ink)]" />
            Clinch
          </Link>
          <div className="hidden items-center md:flex">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="rounded-full px-3.5 py-2 text-[13.5px] text-[var(--l-ink-2)] transition-colors duration-300 hover:text-[var(--l-ink)]">
                {n.label}
              </a>
            ))}
          </div>
          <Link
            to="/launches"
            className="group ml-auto hidden items-center gap-2 rounded-full bg-[var(--l-ink)] py-1.5 pl-4 pr-1.5 text-[13.5px] font-medium text-[#070908] transition-colors duration-300 hover:bg-white active:scale-[0.98] md:ml-3 md:inline-flex"
          >
            Open app
            <span className="flex size-7 items-center justify-center rounded-full bg-[#070908] text-[var(--l-ink)] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-px">
              <ArrowUpRight size={13} weight="light" />
            </span>
          </Link>
          <button
            type="button"
            className="relative ml-auto flex size-10 items-center justify-center rounded-full md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span className={`absolute h-px w-[18px] bg-[var(--l-ink)] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${open ? "rotate-45" : "-translate-y-[4px]"}`} />
            <span className={`absolute h-px w-[18px] bg-[var(--l-ink)] transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${open ? "-rotate-45" : "translate-y-[4px]"}`} />
          </button>
        </motion.nav>
      </header>

      {/* mobile overlay */}
      <div
        className={`fixed inset-0 z-20 bg-[#070908]/85 backdrop-blur-3xl transition-opacity duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] md:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        aria-hidden={!open}
      >
        <nav className="flex h-full flex-col justify-center gap-2 px-8" aria-label="Mobile">
          {[...NAV, { href: "/launches", label: "Open app" }].map((n, i) => {
            const cls = `serif block text-[44px] leading-tight text-[var(--l-ink)] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${open ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"}`;
            const style = { transitionDelay: open ? `${100 + i * 60}ms` : "0ms" };
            return n.href.startsWith("#") ? (
              <a
                key={n.href}
                href={n.href}
                className={cls}
                style={style}
                tabIndex={open ? 0 : -1}
                onClick={(e) => {
                  // the body is scroll-locked while the menu is open: unlock first, then scroll
                  e.preventDefault();
                  setOpen(false);
                  document.body.style.overflow = "";
                  requestAnimationFrame(() => {
                    document.querySelector(n.href)?.scrollIntoView({ behavior: "smooth" });
                    history.replaceState(null, "", n.href);
                  });
                }}
              >
                {n.label}
              </a>
            ) : (
              <Link key={n.href} to={n.href} className={cls} style={style} onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>
                <em>{n.label}</em>
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ hero */

function Hero() {
  return (
    <section className="relative isolate min-h-[100dvh] overflow-hidden">
      <Suspense fallback={null}>
        <HeroShader />
      </Suspense>
      {/* on narrow screens the copy sits over the light: a quiet scrim keeps it legible */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#070908]/35 via-[#070908]/55 to-[#070908]/10 lg:hidden" />
      <div className="relative mx-auto grid max-w-[1280px] items-center gap-14 px-4 pb-24 pt-36 sm:px-8 md:pt-44 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16 lg:pb-32">
        <div>
          <Reveal>
            <Eyebrow>Uniswap v4 · sybil-proof by theorem</Eyebrow>
          </Reveal>
          <h1 className="serif mt-8 text-[clamp(46px,5.4vw,92px)] leading-[0.95] text-[var(--l-ink)] [text-wrap:balance]">
            <MaskedLines
              delay={0.15}
              lines={[
                "A thousand wallets",
                <>
                  never beat <em className="text-[var(--l-mint)]">one.</em>
                </>,
              ]}
            />
          </h1>
          <Reveal delay={0.45}>
            <p className="mt-8 max-w-[33rem] text-[17px] leading-[1.65] text-[var(--l-ink-2)] sm:text-[18px]">
              Clinch is a token launch and a batch market where bidding your true value is the best you can do, and splitting a budget across wallets never helps. No caps to farm. No KYC to pass. Just a better auction.
            </p>
          </Reveal>
          <Reveal delay={0.55}>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <PillLink to="/launches">Open the live launch</PillLink>
              <PillLink to="#how" variant="ghost">
                See how it clears
              </PillLink>
            </div>
          </Reveal>
          <Reveal delay={0.7}>
            <dl className="mt-14 grid max-w-[34rem] grid-cols-3 gap-6 text-[12px]">
              {[
                ["Theorem 1.3", "arXiv 2610.36629"],
                ["84 tests", "fuzzed 2,000× each"],
                ["0 wei", "engine vs chain drift"],
              ].map(([a, b]) => (
                <div key={a} className="border-t border-white/[0.08] pt-3">
                  <dt className="mono text-[var(--l-ink)]">{a}</dt>
                  <dd className="mt-1 text-[var(--l-ink-3)]">{b}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
        <Reveal delay={0.35} className="w-full lg:justify-self-end">
          <div className="w-full max-w-[460px] lg:ml-auto">
            <ClinchLadder />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ trilemma */

type Cell = { ok: boolean; note: string };
const ROWS: { name: string; sub: string; cells: [Cell, Cell, Cell]; us?: boolean }[] = [
  {
    name: "Uniform price",
    sub: "CCA-style clearing",
    cells: [
      { ok: false, note: "Shading pays: +44%" },
      { ok: true, note: "Splitting changes nothing" },
      { ok: true, note: "No identity layer" },
    ],
  },
  {
    name: "Per-wallet caps",
    sub: "Typical IDO",
    cells: [
      { ok: false, note: "One honest wallet loses" },
      { ok: false, note: "Utility 40 → 602 by splitting" },
      { ok: true, note: "No identity layer" },
    ],
  },
  {
    name: "Caps + proof of human",
    sub: "World ID, ZK passport",
    cells: [
      { ok: false, note: "Still shading under the cap" },
      { ok: true, note: "One cap per person" },
      { ok: false, note: "Needs a credential" },
    ],
  },
  {
    name: "Clinch",
    sub: "Adaptive clinching",
    us: true,
    cells: [
      { ok: true, note: "Truth is the dominant strategy" },
      { ok: true, note: "Splitting only hurts: 680 → 270" },
      { ok: true, note: "Nothing to verify" },
    ],
  },
];
const COLS = ["Honest bidding is best", "Splitting doesn't help", "No KYC needed"];

function Trilemma() {
  return (
    <section id="trilemma" className="relative scroll-mt-24 px-4 py-28 sm:px-8 md:py-40">
      <div className="mx-auto max-w-[1280px]">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20">
          <div className="lg:sticky lg:top-32 lg:self-start">
            <Reveal>
              <Eyebrow>The launch trilemma</Eyebrow>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="serif mt-7 text-[clamp(40px,4.8vw,68px)] leading-[1.0] text-[var(--l-ink)]">
                Every fair launch today picks <em className="text-[var(--l-mint)]">two of three.</em>
              </h2>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="mt-7 max-w-[30rem] text-[16.5px] leading-[1.7] text-[var(--l-ink-2)]">
                Caps stop whales until a whale makes fifty wallets. Uniform prices ignore wallets but reward lying about demand. Identity fixes wallets and adds a gatekeeper. Clinch gets all three from the mechanism itself, because escrowed budgets are exactly what the theorem needs.
              </p>
            </Reveal>
          </div>

          <ul className="space-y-4">
            {ROWS.map((r, i) => (
              <Reveal as="li" key={r.name} delay={i * 0.07}>
                <div className={`rounded-[1.75rem] p-1.5 ring-1 ${r.us ? "bg-[var(--l-mint)]/[0.06] ring-[var(--l-mint)]/25" : "bg-white/[0.025] ring-white/[0.07]"}`}>
                  <div className="rounded-[calc(1.75rem-0.375rem)] bg-[var(--l-bg-2)] px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:px-6">
                    <div className="flex items-baseline justify-between gap-4">
                      <div>
                        <div className={`serif text-[24px] leading-none ${r.us ? "text-[var(--l-mint)]" : "text-[var(--l-ink)]"}`}>{r.us ? <em>{r.name}</em> : r.name}</div>
                        <div className="mono mt-2 text-[11px] text-[var(--l-ink-3)]">{r.sub}</div>
                      </div>
                      <span className="mono text-[12px] text-[var(--l-ink-3)]">
                        {r.cells.filter((c) => c.ok).length}/3
                      </span>
                    </div>
                    <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
                      {r.cells.map((c, j) => (
                        <div key={j} className="rounded-2xl bg-white/[0.025] px-3.5 py-3 ring-1 ring-white/[0.05]">
                          <div className="flex items-center gap-2">
                            <span
                              className={`flex size-5 items-center justify-center rounded-full ${c.ok ? "bg-[var(--l-mint)]/15 text-[var(--l-mint)]" : "bg-white/[0.05] text-[var(--l-ink-3)]"}`}
                            >
                              {c.ok ? <Check size={11} weight="bold" /> : <X size={10} weight="bold" />}
                            </span>
                            <span className="text-[12px] text-[var(--l-ink-3)]">{COLS[j]}</span>
                          </div>
                          <div className={`mt-2 text-[13px] leading-snug ${c.ok ? "text-[var(--l-ink)]" : "text-[var(--l-ink-2)]"}`}>{c.note}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ how it clears */

function StepArt({ kind }: { kind: 0 | 1 | 2 | 3 }) {
  const reduced = useReducedMotion();
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -15% 0px" });
  const draw = reduced || inView;
  const common = { fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, vectorEffect: "non-scaling-stroke" as const };
  return (
    <svg ref={ref} viewBox="0 0 240 120" className="h-28 w-full" aria-hidden>
      {kind === 0 && (
        <g>
          {[0.85, 0.5, 0.68].map((fill, i) => {
            const x = 40 + i * 62;
            return (
              <motion.g
                key={i}
                initial={{ y: 16, opacity: 0 }}
                animate={draw ? { y: 0, opacity: 1 } : {}}
                transition={{ duration: 0.9, ease: EASE, delay: 0.1 + i * 0.12 }}
              >
                {/* shackle */}
                <motion.path
                  d={`M${x + 12} 44 V36 a8 8 0 0 1 16 0 V44`}
                  stroke="rgb(237 240 234 / 0.4)"
                  strokeWidth={1.2}
                  {...common}
                  initial={{ pathLength: 0 }}
                  animate={draw ? { pathLength: 1 } : {}}
                  transition={{ duration: 0.8, ease: EASE, delay: 0.55 + i * 0.12 }}
                />
                {/* vault */}
                <rect x={x} y={44} width={40} height={52} rx={9} stroke="rgb(237 240 234 / 0.22)" strokeWidth={1} fill="rgb(255 255 255 / 0.02)" />
                {/* escrowed budget */}
                <motion.rect
                  x={x + 6}
                  width={28}
                  rx={4}
                  fill="var(--l-mint)"
                  fillOpacity={0.28}
                  initial={{ height: 0, y: 90 }}
                  animate={draw ? { height: 40 * fill, y: 90 - 40 * fill } : {}}
                  transition={{ duration: 1.1, ease: EASE, delay: 0.35 + i * 0.12 }}
                />
              </motion.g>
            );
          })}
        </g>
      )}
      {kind === 1 && (
        <motion.path
          d="M16 104 H52 V88 H88 V72 H124 V56 H160 V40 H196 V24 H224"
          stroke="var(--l-amber)"
          strokeWidth={1.6}
          {...common}
          initial={{ pathLength: 0 }}
          animate={draw ? { pathLength: 1 } : {}}
          transition={{ duration: 1.6, ease: EASE }}
        />
      )}
      {kind === 2 && (
        <g>
          {[0.82, 0.55, 0.4, 0.2].map((w, i) => (
            <g key={i}>
              <rect x={20} y={20 + i * 22} width={200} height={6} rx={3} fill="rgb(255 255 255 / 0.05)" />
              <motion.rect
                x={20}
                y={20 + i * 22}
                height={6}
                rx={3}
                fill={i === 0 ? "var(--l-mint)" : i === 3 ? "rgb(255 255 255 / 0.12)" : "var(--l-mint)"}
                initial={{ width: 0 }}
                animate={draw ? { width: 200 * w * (i === 3 ? 0.35 : 1) } : {}}
                transition={{ duration: 1.2, ease: EASE, delay: 0.15 + i * 0.12 }}
                opacity={i === 3 ? 1 : 1 - i * 0.18}
              />
            </g>
          ))}
        </g>
      )}
      {kind === 3 && (
        <g>
          <circle cx={70} cy={60} r={30} stroke="rgb(237 240 234 / 0.25)" strokeWidth={1} fill="rgb(255 255 255 / 0.02)" />
          <circle cx={170} cy={60} r={30} stroke="var(--l-mint)" strokeWidth={1} fill="rgb(143 224 184 / 0.06)" />
          <motion.path
            d="M102 60 H136"
            stroke="var(--l-amber)"
            strokeWidth={1.6}
            {...common}
            initial={{ pathLength: 0 }}
            animate={draw ? { pathLength: 1 } : {}}
            transition={{ duration: 0.9, ease: EASE, delay: 0.3 }}
          />
          <motion.path d="M130 54 L137 60 L130 66" stroke="var(--l-amber)" strokeWidth={1.6} {...common} initial={{ opacity: 0 }} animate={draw ? { opacity: 1 } : {}} transition={{ delay: 1 }} />
          <text x={70} y={64} textAnchor="middle" className="mono" fontSize="10" fill="rgb(237 240 234 / 0.55)">
            bids
          </text>
          <text x={170} y={64} textAnchor="middle" className="mono" fontSize="10" fill="var(--l-mint)">
            v4 pool
          </text>
        </g>
      )}
    </svg>
  );
}

const STEPS = [
  {
    t: "Escrow the truth",
    d: "Each bid is a maximum price and a budget, and the whole budget is locked. That escrow is the hypothesis of the sybil-proofness theorem: no wallet set can claim more than its owner holds.",
  },
  {
    t: "The clock climbs",
    d: "The price rises from the reserve (or the pool's spot) in small steps that land exactly on each bidder's limit. Reach your limit and you step out.",
  },
  {
    t: "Clinch what nobody else can afford",
    d: "At every price, each bidder takes the supply all the others together can no longer absorb, and pays that price for it. Prices differ per unit, and that is why the truth wins.",
  },
  {
    t: "Anyone settles",
    d: "One permissionless call fixes every allocation. A launch seeds a Uniswap v4 pool at the discovered price; a batch makes a single swap against the pool and rebates the surplus.",
  },
];

function How() {
  return (
    <section id="how" className="relative scroll-mt-24 px-4 py-28 sm:px-8 md:py-40">
      <div className="mx-auto max-w-[1280px]">
        <div className="max-w-[46rem]">
          <Reveal>
            <Eyebrow>How it clears</Eyebrow>
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="serif mt-7 text-[clamp(40px,4.8vw,68px)] leading-[1.0] text-[var(--l-ink)]">
              The price climbs. You clinch what <em className="text-[var(--l-mint)]">nobody else can afford.</em>
            </h2>
          </Reveal>
        </div>
        <div className="mt-16 grid gap-4 md:grid-cols-12">
          {STEPS.map((s, i) => (
            <Reveal key={s.t} delay={(i % 2) * 0.08} className={i === 0 || i === 3 ? "md:col-span-7" : "md:col-span-5"}>
              <Bezel className="h-full" inner="flex h-full flex-col p-7 sm:p-9">
                <div className="flex items-start justify-between">
                  <span className="serif text-[56px] italic leading-none text-[var(--l-ink-3)]">{String(i + 1).padStart(2, "0")}</span>
                  {i === 0 && <LockSimple size={20} weight="light" className="mt-2 text-[var(--l-ink-3)]" />}
                </div>
                <div className="my-8">
                  <StepArt kind={i as 0 | 1 | 2 | 3} />
                </div>
                <div className="mt-auto">
                  <h3 className="text-[19px] font-medium tracking-[-0.01em] text-[var(--l-ink)]">{s.t}</h3>
                  <p className="mt-2.5 max-w-[34rem] text-[15px] leading-[1.7] text-[var(--l-ink-2)]">{s.d}</p>
                </div>
              </Bezel>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ whale lab */

function Lab() {
  return (
    <section id="lab" className="relative scroll-mt-24 px-4 py-28 sm:px-8 md:py-40">
      <div className="mx-auto max-w-[1280px]">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:items-end">
          <div>
            <Reveal>
              <Eyebrow>Whale Lab · try to cheat it</Eyebrow>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="serif mt-7 text-[clamp(40px,4.8vw,68px)] leading-[1.0] text-[var(--l-ink)]">
                Split the whale. <em className="text-[var(--l-mint)]">Watch it lose.</em>
              </h2>
            </Reveal>
          </div>
          <Reveal delay={0.16}>
            <p className="text-[16px] leading-[1.7] text-[var(--l-ink-2)]">
              One whale with $1,500 and a $2.50 value competes with 30 honest bidders for 1,000 tokens. Drag the slider to split it across more wallets. Every point is computed live in your browser by the same engine the contracts run.
            </p>
          </Reveal>
        </div>
        <Reveal delay={0.1} className="mt-14">
          <Bezel inner="p-3 sm:p-5">
            <WhaleLab />
          </Bezel>
        </Reveal>
        <Reveal delay={0.1} className="mt-24">
          <div className="max-w-[44rem]">
            <h3 className="serif text-[clamp(32px,3.4vw,48px)] leading-[1.05] text-[var(--l-ink)]">
              Lying is the other cheat. <em className="text-[var(--l-mint)]">It costs here.</em>
            </h3>
          </div>
        </Reveal>
        <Reveal delay={0.1} className="mt-10">
          <Bezel inner="p-3 sm:p-5">
            <ShadeLab />
          </Bezel>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ products */

function Products() {
  return (
    <section id="products" className="relative scroll-mt-24 px-4 py-28 sm:px-8 md:py-40">
      <div className="mx-auto max-w-[1280px]">
        <div className="max-w-[46rem]">
          <Reveal>
            <Eyebrow>Two products, one engine</Eyebrow>
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="serif mt-7 text-[clamp(40px,4.8vw,68px)] leading-[1.0] text-[var(--l-ink)]">
              Launch a token. <em className="text-[var(--l-mint)]">Then keep trading it fairly.</em>
            </h2>
          </Reveal>
        </div>

        <div className="mt-16 grid gap-4 md:grid-cols-12 md:grid-rows-[auto_auto]">
          <Reveal className="md:col-span-7 md:row-span-2">
            <Bezel className="h-full" inner="flex h-full flex-col justify-between gap-12 p-8 sm:p-10">
              <div>
                <span className="eyebrow text-[var(--l-ink-3)]">ClinchLaunch</span>
                <h3 className="serif mt-5 text-[38px] leading-[1.05] text-[var(--l-ink)]">
                  A launch whose price is <em>discovered</em>, not sniped.
                </h3>
                <p className="mt-5 max-w-[30rem] text-[15.5px] leading-[1.7] text-[var(--l-ink-2)]">
                  Sell a fixed supply on a rising clock with a reserve and a ceiling. When it ends, proceeds and reserved tokens seed a Uniswap v4 pool at the clearing price, and that liquidity is locked for good.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  ["Reserve → ceiling", "bounded ladder"],
                  ["Pool seeded", "at clearing price"],
                  ["Liquidity", "locked forever"],
                ].map(([a, b]) => (
                  <div key={a} className="rounded-2xl bg-white/[0.025] p-4 ring-1 ring-white/[0.06]">
                    <div className="text-[13px] text-[var(--l-ink)]">{a}</div>
                    <div className="mono mt-1.5 text-[11px] text-[var(--l-ink-3)]">{b}</div>
                  </div>
                ))}
              </div>
              <div>
                <PillLink to="/launches">Browse launches</PillLink>
              </div>
            </Bezel>
          </Reveal>
          <Reveal className="md:col-span-5" delay={0.08}>
            <Bezel className="h-full" inner="p-8">
              <span className="eyebrow text-[var(--l-ink-3)]">ClinchHook</span>
              <h3 className="serif mt-4 text-[28px] leading-[1.1] text-[var(--l-ink)]">Batch swaps that sandwiches can't touch.</h3>
              <p className="mt-3 text-[15px] leading-[1.7] text-[var(--l-ink-2)]">
                A v4 hook collects swaps into short windows and clears each one together, with a single swap on the PoolManager. Reordering and injecting bids earn nothing.
              </p>
              <Link to="/markets" className="mt-6 inline-flex items-center gap-1.5 text-[14px] text-[var(--l-mint)] transition-opacity hover:opacity-80">
                Open markets <ArrowUpRight size={14} weight="light" />
              </Link>
            </Bezel>
          </Reveal>
          <Reveal className="md:col-span-5" delay={0.12}>
            <Bezel className="h-full" inner="p-8">
              <span className="eyebrow text-[var(--l-ink-3)]">Permissionless</span>
              <h3 className="serif mt-4 text-[28px] leading-[1.1] text-[var(--l-ink)]">If this site disappears, nothing stops.</h3>
              <p className="mt-3 text-[15px] leading-[1.7] text-[var(--l-ink-2)]">
                <code className="mono text-[13px] text-[var(--l-ink)]">settle()</code>, claims and rescue paths are open to any wallet. No owner keys, no admin, full refunds if a batch ever gets stuck.
              </p>
            </Bezel>
          </Reveal>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {[
            ["Private reads", "Route reads through Anon-RPC so your RPC provider can't tie the wallets you look up to you."],
            ["Verified, not vibes", "Solidity matches the reference engine to the wei. Properties are fuzzed against the paper's theorems."],
            ["Open source", "MIT licensed. Contracts, app and the research that shaped them all build from the repo."],
          ].map(([t, d], i) => (
            <Reveal key={t} delay={i * 0.07}>
              <Bezel className="h-full" inner="p-7">
                <h3 className="text-[16px] font-medium text-[var(--l-ink)]">{t}</h3>
                <p className="mt-2 text-[14px] leading-[1.7] text-[var(--l-ink-2)]">{d}</p>
              </Bezel>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ proof */

function Proof() {
  const stats: { v: number; d?: number; s?: string; label: string; sub: string }[] = [
    { v: 84, label: "contract tests", sub: "unit, property, regression" },
    { v: 2000, label: "fuzz runs", sub: "per property, CI profile" },
    { v: 0, label: "wei of drift", sub: "Solidity vs reference engine" },
    { v: 1.38, d: 2, s: "M", label: "gas to settle", sub: "32 orders, one swap" },
  ];
  return (
    <section className="relative px-4 py-24 sm:px-8 md:py-32">
      <div className="mx-auto max-w-[1280px]">
        <div className="hairline" />
        <div className="grid grid-cols-2 gap-x-6 gap-y-12 py-16 md:grid-cols-4">
          {stats.map((s, i) => (
            <Reveal key={s.label} delay={i * 0.06}>
              <div className="serif text-[clamp(48px,6vw,84px)] leading-none text-[var(--l-ink)]">
                <CountUp to={s.v} decimals={s.d} suffix={s.s} />
              </div>
              <div className="mt-4 text-[14px] text-[var(--l-ink)]">{s.label}</div>
              <div className="mono mt-1 text-[11px] text-[var(--l-ink-3)]">{s.sub}</div>
            </Reveal>
          ))}
        </div>
        <div className="hairline" />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ closing */

function Closing() {
  const reduced = useReducedMotion();
  return (
    <section className="relative px-4 pb-10 pt-16 sm:px-8 md:pt-24">
      <div className="mx-auto max-w-[1280px]">
        <Reveal>
          <div className="rounded-[2.5rem] bg-white/[0.03] p-1.5 ring-1 ring-white/[0.08]">
            <div className="relative isolate overflow-hidden rounded-[calc(2.5rem-0.375rem)] px-6 py-24 text-center sm:px-12 md:py-32">
              <Suspense fallback={null}>
              <GrainGradient
                aria-hidden
                className="!absolute inset-0 -z-10"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                colorBack="#070908"
                colors={["#0b2e22", "#1c6a4c", "#b98a4d"]}
                softness={0.75}
                intensity={0.3}
                noise={0.22}
                shape="wave"
                speed={reduced ? 0 : 0.35}
              />
              </Suspense>
              <div className="absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_50%_45%,rgba(7,9,8,0.55),transparent)]" aria-hidden />
              <h2 className="serif mx-auto max-w-[14ch] text-[clamp(48px,7vw,104px)] leading-[0.95] text-[var(--l-ink)]">
                Clinch your <em className="text-[var(--l-mint)]">token.</em>
              </h2>
              <p className="mx-auto mt-6 max-w-[32rem] text-[16.5px] leading-[1.7] text-[var(--l-ink-2)]">
                Bid what it's worth to you. Keep what you clinch. Nobody gets ahead by pretending to be many.
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-3">
                <PillLink to="/launches">Open the live launch</PillLink>
                <PillLink to="/how-it-works" variant="ghost">
                  Read the guarantees
                </PillLink>
              </div>
            </div>
          </div>
        </Reveal>
        <footer className="mt-10 flex flex-col items-start justify-between gap-6 px-2 pb-6 text-[12.5px] text-[var(--l-ink-3)] md:flex-row md:items-center">
          <div className="flex items-center gap-2 text-[var(--l-ink-2)]">
            <Mark className="size-4 text-[var(--l-ink-2)]" />
            Clinch
          </div>
          <p className="max-w-[44rem]">
            Implements sybil-proof adaptive clinching (Zhang, Li, Shi, Zhang, Xia, Han; arXiv 2610.36629). Unaudited hackathon code. No analytics, no trackers.
          </p>
          <div className="flex gap-5">
            <Link to="/launches" className="hover:text-[var(--l-ink)]">
              Launches
            </Link>
            <Link to="/markets" className="hover:text-[var(--l-ink)]">
              Markets
            </Link>
            <Link to="/how-it-works" className="hover:text-[var(--l-ink)]">
              Guarantees
            </Link>
          </div>
        </footer>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ page */

export default function Landing() {
  const reduced = useReducedMotion();
  useEffect(() => {
    const html = document.documentElement;
    const prevBg = document.body.style.background;
    const prevScroll = html.style.scrollBehavior;
    document.body.style.background = "#070908";
    if (!reduced) html.style.scrollBehavior = "smooth";
    return () => {
      document.body.style.background = prevBg;
      html.style.scrollBehavior = prevScroll;
    };
  }, [reduced]);
  return (
    <div className="landing min-h-[100dvh] overflow-x-clip">
      <div className="landing-grain" aria-hidden />
      <Nav />
      <main id="main">
        <Hero />
        <Trilemma />
        <How />
        <Lab />
        <Products />
        <Proof />
        <Closing />
      </main>
      <ScrollRestoration />
    </div>
  );
}
