import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fmt } from "../lib/format";

export interface Series {
  id: string;
  label: string;
  color: string; // CSS var reference
  dash?: string;
  points: { n: number; u: number }[];
}

const WIDE = { W: 720, H: 340, M: { l: 52, r: 132, t: 16, b: 40 } };
// phones: a narrower canvas so text stays legible; line identity comes from the legend chips
const NARROW = { W: 380, H: 300, M: { l: 40, r: 14, t: 12, b: 40 } };

function useNarrow() {
  const q = "(max-width: 640px)";
  const [n, setN] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = () => setN(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return n;
}

/** Utility vs number of wallets, log-x. Crosshair + tooltip on hover; direct labels at line ends. */
export function WhaleChart({ series, current, onPick }: { series: Series[]; current: number; onPick?: (n: number) => void }) {
  const narrow = useNarrow();
  const { W, H, M } = narrow ? NARROW : WIDE;
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const titleId = useId();

  const { x, y, yTicks, xTicks } = useMemo(() => {
    const all = series.flatMap((s) => s.points.map((p) => p.u));
    const yMax = Math.max(700, ...all);
    const niceMax = Math.ceil(yMax / 100) * 100;
    const x = (n: number) => M.l + (Math.log(n) / Math.log(100)) * (W - M.l - M.r);
    const y = (u: number) => H - M.b - (u / niceMax) * (H - M.t - M.b);
    const step = niceMax > 800 ? 200 : 100;
    const yTicks = Array.from({ length: Math.floor(niceMax / step) + 1 }, (_, i) => i * step);
    return { x, y, yTicks, xTicks: [1, 2, 5, 10, 20, 50, 100] };
  }, [series, W, H, M]);

  const nearest = (s: Series, n: number) => s.points.reduce((a, b) => (Math.abs(Math.log(b.n / n)) < Math.abs(Math.log(a.n / n)) ? b : a));
  const shown = hover ?? current;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = Math.min(1, Math.max(0, (px - M.l) / (W - M.l - M.r)));
    const n = Math.exp(t * Math.log(100));
    // snap to a computed grid point so the tooltip shows exact engine values
    const grid = series[0]?.points.map((p) => p.n) ?? [1];
    setHover(grid.reduce((a, b) => (Math.abs(Math.log(b / n)) < Math.abs(Math.log(a / n)) ? b : a)));
  };

  // direct labels at the right edge, nudged apart so they never collide
  const labels = useMemo(() => {
    const ls = series.map((s) => ({ id: s.id, label: s.label, color: s.color, y: y(s.points[s.points.length - 1].u) }));
    ls.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ls.length; i++) if (ls[i].y - ls[i - 1].y < 15) ls[i].y = ls[i - 1].y + 15;
    return narrow ? [] : ls;
  }, [series, y, narrow]);

  const tipX = x(shown);
  const tipLeft = tipX > W * 0.55;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none select-none"
        role="img"
        aria-labelledby={titleId}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={() => hover && onPick?.(hover)}
      >
        <title id={titleId}>Whale utility versus number of wallets for each mechanism. Values are listed in the table below the chart.</title>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={M.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="num" fontSize={11} fill="var(--ink-3)">
              {t}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={H - M.b + 18} textAnchor="middle" className="num" fontSize={11} fill="var(--ink-3)">
            {t}
          </text>
        ))}
        <text x={(M.l + W - M.r) / 2} y={H - 4} textAnchor="middle" fontSize={11.5} fill="var(--ink-3)">
          wallets the whale splits into (log scale)
        </text>
        <text x={12} y={(H - M.b + M.t) / 2} fontSize={11.5} fill="var(--ink-3)" transform={`rotate(-90 12 ${(H - M.b + M.t) / 2})`} textAnchor="middle">
          whale utility
        </text>

        {/* selected N */}
        <line x1={x(current)} x2={x(current)} y1={M.t} y2={H - M.b} stroke="var(--ink-3)" strokeDasharray="3 3" strokeWidth={1} />

        {series.map((s) => (
          <path
            key={s.id}
            d={s.points.map((p, i) => `${i ? "L" : "M"}${x(p.n).toFixed(1)},${y(p.u).toFixed(1)}`).join("")}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeDasharray={s.dash}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {hover !== null && <line x1={tipX} x2={tipX} y1={M.t} y2={H - M.b} stroke="var(--ink-2)" strokeWidth={1} />}
        {series.map((s) => {
          const p = nearest(s, shown);
          return <circle key={s.id} cx={x(p.n)} cy={y(p.u)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />;
        })}

        {labels.map((l) => (
          <g key={l.id}>
            <circle cx={W - M.r + 10} cy={l.y} r={3.5} fill={l.color} />
            <text x={W - M.r + 18} y={l.y} dy="0.32em" fontSize={11.5} fill="var(--ink-2)">
              {l.label}
            </text>
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-[12px] shadow-[0_8px_24px_-12px_rgb(15_19_24/0.35)]"
          style={tipLeft ? { right: `${((W - tipX) / W) * 100 + 1.5}%` } : { left: `${(tipX / W) * 100 + 1.5}%` }}
        >
          <div className="mb-1 font-medium text-ink">{hover} wallet{hover > 1 ? "s" : ""}</div>
          {series.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-ink-2">
                <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="num text-ink">{fmt(nearest(s, hover).u, { max: 0 })}</span>
            </div>
          ))}
          <div className="mt-1 text-ink-3">Click to select</div>
        </div>
      )}
    </div>
  );
}
