import { ArrowRight, Check, X } from "@phosphor-icons/react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { WhaleChart, type Series } from "../components/WhaleChart";
import { Button, buttonStyles, Card, cx, Segmented, Skeleton, Table, td, th } from "../components/ui";
import { CAP_TOKENS, FIXED_PRICE, HONEST, shadedOutcome, SUPPLY, WHALE_BUDGET, WHALE_VALUE, whaleOutcome, type Mechanism } from "../engine/baselines";
import { deployments } from "../config/env";
import { fmt, fmtPct } from "../lib/format";

const MECHS: { id: Mechanism; label: string; color: string; dash?: string; what: string }[] = [
  {
    id: "clinch",
    label: "Clinch",
    color: "var(--chart-1)",
    what: "Ascending-price clinching, the whale's budget split evenly across N wallets. Splitting never raises its utility.",
  },
  {
    id: "uniform",
    label: "Uniform, no cap",
    color: "var(--chart-2)",
    what: "One clearing price for everyone, no per-wallet limit (CCA-style). Splitting changes nothing, but shading the bid pays.",
  },
  {
    id: "uniform_cap",
    label: "Uniform, capped",
    color: "var(--chart-3)",
    dash: "6 4",
    what: `Same clearing price, but each wallet can get at most ${CAP_TOKENS} tokens. More wallets, more caps.`,
  },
  {
    id: "fixed_cap",
    label: "Fixed price, capped",
    color: "var(--chart-4)",
    dash: "2 3",
    what: `A typical IDO: fixed $${FIXED_PRICE.toFixed(2)}, ${CAP_TOKENS}-token cap per wallet, pro rata when oversubscribed.`,
  },
];

const GRID = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100];

function useCurves() {
  const [curves, setCurves] = useState<Record<Mechanism, { n: number; u: number }[]> | null>(null);
  useEffect(() => {
    // computed off the first paint; about 100 ms of engine runs
    const t = setTimeout(() => {
      const out = {} as Record<Mechanism, { n: number; u: number }[]>;
      for (const m of MECHS) out[m.id] = GRID.map((n) => ({ n, u: whaleOutcome(m.id, n).util }));
      setCurves(out);
    }, 30);
    return () => clearTimeout(t);
  }, []);
  return curves;
}

function Yes({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <Check size={16} weight="bold" className="mt-0.5 shrink-0 text-accent" aria-label="Yes" />
      <span className="text-ink-2">{children}</span>
    </div>
  );
}
function No({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <X size={16} weight="bold" className="mt-0.5 shrink-0 text-bad" aria-label="No" />
      <span className="text-ink-2">{children}</span>
    </div>
  );
}

function TwoOfThree() {
  const rows = [
    {
      name: "Uniform price (CCA-style)",
      cells: [
        <No key="a">Shading pays. Bidding 80% of value with 67.5% of budget lifts whale utility by 44% (276 to 396).</No>,
        <Yes key="b">With no cap, splitting changes nothing. Utility stays at 276 for any number of wallets.</Yes>,
        <Yes key="c">No identity layer.</Yes>,
      ],
    },
    {
      name: "Per-wallet caps",
      cells: [
        <No key="a">Under a cap, one honest wallet is the worst strategy available.</No>,
        <No key="b">Whale utility goes from 40 to 602 by splitting into 50 wallets (fixed price, 40-token cap).</No>,
        <Yes key="c">No identity layer.</Yes>,
      ],
    },
    {
      name: "Caps + proof of human",
      cells: [
        <No key="a">The sale under the cap is still uniform or pro rata, so its incentives to shade remain.</No>,
        <Yes key="b">One cap per verified person.</Yes>,
        <No key="c">Needs World ID, a ZK passport, or a similar credential.</No>,
      ],
    },
    {
      name: "Clinch",
      highlight: true,
      cells: [
        <Yes key="a">Truthful bidding is a dominant strategy. The truthful whale's 680 is the best report found.</Yes>,
        <Yes key="b">Splitting never helps and usually hurts: 680 at one wallet, 270 at 100.</Yes>,
        <Yes key="c">Sybil resistance comes from the mechanism, so there is nothing to verify.</Yes>,
      ],
    },
  ];
  const cols = ["Honest bidding is best", "Splitting wallets doesn't help", "No KYC needed"];
  return (
    <>
    <div className="flex flex-col gap-3 md:hidden">
      {rows.map((r) => (
        <Card key={r.name} className={cx("p-4", r.highlight && "border-accent-line bg-accent-soft/50")}>
          <h3 className="text-[14px] font-semibold text-ink">{r.name}</h3>
          <dl className="mt-3 flex flex-col gap-3 text-[13px] leading-relaxed">
            {r.cells.map((c, i) => (
              <div key={i}>
                <dt className="text-[12px] text-ink-3">{cols[i]}</dt>
                <dd className="mt-0.5">{c}</dd>
              </div>
            ))}
          </dl>
        </Card>
      ))}
    </div>
    <Card className="hidden overflow-hidden md:block">
      <Table>
        <caption className="sr-only">Which launch designs have which property</caption>
        <thead className="border-b border-line bg-surface-2/60">
          <tr>
            <th className={cx(th, "w-[22%]")} scope="col">
              Design
            </th>
            <th className={th} scope="col">
              Honest bidding is best
            </th>
            <th className={th} scope="col">
              Splitting wallets doesn't help
            </th>
            <th className={th} scope="col">
              No KYC needed
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className={cx("border-b border-line last:border-0 align-top", r.highlight && "bg-accent-soft/50")}>
              <th scope="row" className={cx(td, "whitespace-normal font-medium text-ink")}>
                {r.name}
              </th>
              {r.cells.map((c, i) => (
                <td key={i} className={cx(td, "min-w-[200px] whitespace-normal leading-relaxed")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
    </>
  );
}

export function WhaleLab() {
  const curves = useCurves();
  const [n, setN] = useState(50);
  const [visible, setVisible] = useState<Record<Mechanism, boolean>>({ clinch: true, uniform: true, uniform_cap: true, fixed_cap: true });
  const dn = useDeferredValue(n);
  const now = useMemo(() => Object.fromEntries(MECHS.map((m) => [m.id, whaleOutcome(m.id, dn)])) as Record<Mechanism, ReturnType<typeof whaleOutcome>>, [dn]);
  const one = useMemo(() => Object.fromEntries(MECHS.map((m) => [m.id, whaleOutcome(m.id, 1)])) as Record<Mechanism, ReturnType<typeof whaleOutcome>>, []);

  const series: Series[] = curves
    ? MECHS.filter((m) => visible[m.id]).map((m) => ({
        id: m.id,
        label: m.label,
        color: m.color,
        dash: m.dash,
        points: curves[m.id],
      }))
    : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Mechanisms shown">
          {MECHS.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={visible[m.id]}
              onClick={() => setVisible((v) => ({ ...v, [m.id]: !v[m.id] }))}
              className={cx(
                "inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-[12.5px] transition-colors",
                visible[m.id] ? "border-line-strong bg-surface text-ink" : "border-line bg-transparent text-ink-3 line-through",
              )}
            >
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: m.color }} />
              {m.label}
            </button>
          ))}
        </div>
        <div className="mt-4">
          {curves ? (
            series.length ? (
              <WhaleChart series={series} current={n} onPick={setN} />
            ) : (
              <p className="py-20 text-center text-[13px] text-ink-3">Turn on at least one mechanism.</p>
            )
          ) : (
            <Skeleton className="aspect-[720/340] w-full" />
          )}
        </div>
        <div className="mt-4">
          <label htmlFor="wallets" className="flex items-baseline justify-between text-[13px]">
            <span className="font-medium text-ink">Wallets the whale uses</span>
            <span className="num text-ink">{n}</span>
          </label>
          <input id="wallets" type="range" min={1} max={100} step={1} value={n} onChange={(e) => setN(Number(e.target.value))} className="mt-2 w-full" />
        </div>
      </Card>

      <div className="flex flex-col gap-3">
        {MECHS.map((m) => {
          const o = now[m.id];
          const d = o.util - one[m.id].util;
          return (
            <div key={m.id} className={cx("rounded-xl border border-line bg-surface p-4", !visible[m.id] && "opacity-60")}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
                  <span className="inline-block h-0.5 w-4 rounded" style={{ background: m.color }} />
                  {m.label}
                </div>
                <div className="num text-[17px] text-ink">{fmt(o.util, { max: 0 })}</div>
              </div>
              <div className="num mt-1 flex justify-between text-[12px] text-ink-3">
                <span>{fmtPct(o.x / SUPPLY, 1)} of supply</span>
                <span className={cx(dn > 1 && Math.abs(d) >= 0.5 && (d > 0 ? "text-bad" : "text-accent"))}>
                  {dn === 1 ? "one wallet" : Math.abs(d) < 0.5 ? "same as one wallet" : `${d > 0 ? "+" : ""}${fmt(d, { max: 0 })} vs one wallet`}
                </span>
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">{m.what}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ShadeLab() {
  const [mode, setMode] = useState<"truth" | "custom">("custom");
  const [v, setV] = useState(80);
  const [b, setB] = useState(67.5);
  const dv = useDeferredValue(v);
  const db = useDeferredValue(b);
  const truth = useMemo(() => ({ uniform: shadedOutcome("uniform", 1, 1), clinch: shadedOutcome("clinch", 1, 1) }), []);
  const shaded = useMemo(() => {
    const vf = mode === "truth" ? 1 : dv / 100;
    const bf = mode === "truth" ? 1 : db / 100;
    return { uniform: shadedOutcome("uniform", vf, bf), clinch: shadedOutcome("clinch", vf, bf) };
  }, [dv, db, mode]);

  const row = (key: "uniform" | "clinch", label: string, color: string) => {
    const t = truth[key].util;
    const s = shaded[key].util;
    const g = s / t - 1;
    return (
      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: color }} />
          {label}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[12px] text-ink-3">Truthful bid</div>
            <div className="num text-[17px] text-ink">{fmt(t, { max: 0 })}</div>
          </div>
          <div>
            <div className="text-[12px] text-ink-3">Your report</div>
            <div className="num text-[17px] text-ink">{fmt(s, { max: 0 })}</div>
          </div>
        </div>
        <div className={cx("num mt-2 text-[13px]", Math.abs(g) < 5e-4 ? "text-ink-3" : g > 0 ? "text-bad" : "text-accent")}>
          {Math.abs(g) < 5e-4 ? "No change" : g > 0 ? `Lying pays: +${fmtPct(g, 1)}` : `Lying costs ${fmtPct(-g, 1)}`}
        </div>
      </div>
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] font-medium text-ink">What the whale reports</p>
          <Segmented
            label="Report"
            value={mode}
            onChange={setMode}
            options={[
              { value: "truth", label: "Truth" },
              { value: "custom", label: "Shaded" },
            ]}
          />
        </div>
        <div className={cx("mt-5 flex flex-col gap-5", mode === "truth" && "pointer-events-none opacity-50")} aria-disabled={mode === "truth"}>
          <div>
            <label htmlFor="shade-v" className="flex items-baseline justify-between text-[13px]">
              <span className="text-ink-2">Reported value per token</span>
              <span className="num text-ink">
                ${fmt((WHALE_VALUE * v) / 100, { min: 2, max: 3 })} <span className="text-ink-3">({v}% of ${WHALE_VALUE.toFixed(2)})</span>
              </span>
            </label>
            <input id="shade-v" type="range" min={50} max={120} step={2.5} value={v} onChange={(e) => setV(Number(e.target.value))} className="mt-2 w-full" disabled={mode === "truth"} />
          </div>
          <div>
            <label htmlFor="shade-b" className="flex items-baseline justify-between text-[13px]">
              <span className="text-ink-2">Reported budget</span>
              <span className="num text-ink">
                ${fmt((WHALE_BUDGET * b) / 100, { max: 2 })} <span className="text-ink-3">({b}% of ${fmt(WHALE_BUDGET)})</span>
              </span>
            </label>
            <input id="shade-b" type="range" min={20} max={100} step={2.5} value={b} onChange={(e) => setB(Number(e.target.value))} className="mt-2 w-full" disabled={mode === "truth"} />
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => {
              setV(80);
              setB(67.5);
            }}
          >
            Use the best shade found for uniform price (80%, 67.5%)
          </Button>
        </div>
        <p className="mt-5 text-[12.5px] leading-relaxed text-ink-3">
          Utility is always measured with the whale's true value of ${WHALE_VALUE.toFixed(2)} per token: tokens received times $2.50, minus what was paid.
        </p>
      </Card>
      <div className="grid content-start gap-3">
        {row("uniform", "Uniform price, no cap", "var(--chart-2)")}
        {row("clinch", "Clinch", "var(--chart-1)")}
        <p className="text-[12.5px] leading-relaxed text-ink-3">
          Under uniform price a big bidder moves the clearing price, so asking for less lowers the price on everything it buys. Clinch charges each
          unit at the price where it was clinched, so understating only loses units, and overstating risks paying more than they are worth.
        </p>
      </div>
    </div>
  );
}

export default function Home() {
  const reduce = useReducedMotion();
  const enter = (d = 0) => (reduce ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5, delay: d, ease: [0.16, 1, 0.3, 1] as const } });
  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-6">
      <section className="grid items-center gap-10 pb-14 pt-12 md:pt-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <motion.div {...enter()}>
          <h1 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink md:text-[56px]">Clinch your token.</h1>
          <p className="mt-5 max-w-[34ch] text-[19px] leading-relaxed text-ink-2 md:text-[21px]">Launches and swaps where a thousand wallets never beat one.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={deployments.launch ? `/launches/${deployments.launch}` : "/launches"} className={buttonStyles("primary", "lg")}>
              Open the launch <ArrowRight size={16} />
            </Link>
            <a href="#whale-lab" className={buttonStyles("secondary", "lg")}>
              Try the Whale Lab
            </a>
          </div>
        </motion.div>
        <motion.div {...enter(0.08)}>
          <Card className="divide-y divide-line">
            {[
              { k: "+44%", t: "what a whale earns by shading its bid under uniform price" },
              { k: "40 → 602", t: "whale utility under per-wallet caps, by splitting into 50 wallets" },
              { k: "680 → 270", t: "whale utility under Clinch, by splitting into 100 wallets" },
            ].map((s) => (
              <div key={s.k} className="flex items-baseline gap-4 px-5 py-4">
                <div className="num w-[118px] shrink-0 text-[22px] font-medium text-ink">{s.k}</div>
                <div className="text-[13.5px] leading-snug text-ink-2">{s.t}</div>
              </div>
            ))}
            <div className="px-5 py-3 text-[12px] text-ink-3">Simulated: 1,000 tokens, 30 honest bidders, one whale with $1,500 and a $2.50 value.</div>
          </Card>
        </motion.div>
      </section>

      <section className="border-t border-line py-14">
        <h2 className="max-w-[30ch] text-[28px] font-semibold leading-tight tracking-tight text-ink">Today's launch designs give you two of these three, at best.</h2>
        <p className="mt-3 max-w-[65ch] text-[15px] leading-relaxed text-ink-2">
          Clinch runs adaptive clinching (Dobzinski, Lavi and Nisan), which a paper from October 2026 proved sybil-proof when budgets are escrowed. Every
          number below comes from the simulations in <code className="num text-[13px]">research/</code>.
        </p>
        <div className="mt-8">
          <TwoOfThree />
        </div>
      </section>

      <section id="whale-lab" className="scroll-mt-20 border-t border-line py-14">
        <h2 className="text-[28px] font-semibold tracking-tight text-ink">Whale Lab</h2>
        <p className="mt-3 max-w-[65ch] text-[15px] leading-relaxed text-ink-2">
          One whale (value ${WHALE_VALUE.toFixed(2)} per token, budget ${fmt(WHALE_BUDGET)}) competes with {HONEST.length} honest bidders for {fmt(SUPPLY)}{" "}
          tokens, reserve $1.00. Split its budget across more wallets and watch its utility under each design. Every point is computed live in your
          browser by the same engine the contracts run.
        </p>
        <div className="mt-8">
          <WhaleLab />
        </div>
        <p className="mt-4 max-w-[80ch] text-[12.5px] leading-relaxed text-ink-3">
          Honest caveat: Clinch is about incentives, not distribution. Here the truthful whale wins 87% of supply under Clinch against 71% under uniform
          price. What it cannot do is gain anything by splitting or misreporting.
        </p>

        <h3 className="mt-14 text-[20px] font-semibold tracking-tight text-ink">Shade your bid</h3>
        <p className="mt-2 max-w-[65ch] text-[15px] leading-relaxed text-ink-2">
          Splitting is one lie. The other is misreporting value or budget. Uniform price rewards it; Clinch makes the truth the best answer.
        </p>
        <div className="mt-6">
          <ShadeLab />
        </div>
      </section>

      <section className="grid gap-4 border-t border-line py-14 md:grid-cols-2">
        <Link to="/launches" className="group rounded-xl border border-line bg-surface p-6 transition-colors hover:border-line-strong">
          <h3 className="text-[17px] font-semibold text-ink">Launches</h3>
          <p className="mt-2 max-w-[48ch] text-[14px] leading-relaxed text-ink-2">
            Escrow a budget and a maximum price. The price climbs, you clinch tokens as others drop out, and the proceeds seed a Uniswap v4 pool.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-[13.5px] font-medium text-accent">
            Browse launches <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
        <Link to="/markets" className="group rounded-xl border border-line bg-surface-2 p-6 transition-colors hover:border-line-strong">
          <h3 className="text-[17px] font-semibold text-ink">Batch markets</h3>
          <p className="mt-2 max-w-[48ch] text-[14px] leading-relaxed text-ink-2">
            A Uniswap v4 hook that collects swaps into short windows and clears each one with the same mechanism. Reordering and sandwiching earn nothing.
          </p>
          <span className="mt-4 inline-flex items-center gap-1 text-[13.5px] font-medium text-accent">
            Open markets <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </Link>
      </section>
    </div>
  );
}
