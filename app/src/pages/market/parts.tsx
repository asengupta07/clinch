import type { ReactNode } from "react";
import { cx, TokenMark } from "../../components/ui";

/** Two overlapping token monograms for a pair. */
export function TokenPair({ base, quote, size = 32 }: { base: string; quote: string; size?: number }) {
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center">
      <span className="relative z-10 inline-flex rounded-full bg-surface ring-2 ring-surface">
        <TokenMark symbol={base} size={size} />
      </span>
      <span className="inline-flex rounded-full bg-surface ring-2 ring-surface" style={{ marginLeft: -size * 0.32 }}>
        <TokenMark symbol={quote} size={size} />
      </span>
    </span>
  );
}

/** Pair name in market language: base strong, quote muted. */
export function PairName({ base, quote, className }: { base: string; quote: string; className?: string }) {
  return (
    <span className={className}>
      {base}
      <span className="text-ink-3">/{quote}</span>
    </span>
  );
}

/**
 * Two-tone split of the pool's reserves by value at spot. Labels carry the amounts and
 * shares, so colour is never the only signal.
 */
export function CompositionBar({
  a,
  b,
  aLabel,
  bLabel,
  aClass = "bg-chart-2",
  bClass = "bg-ink-3",
  label,
}: {
  aClass?: string;
  bClass?: string;
  /** accessible description; defaults to describing a reserves split */
  label?: string;
  /** value of side a, in quote units */
  a: number;
  /** value of side b, in quote units */
  b: number;
  aLabel: ReactNode;
  bLabel: ReactNode;
}) {
  const total = a + b;
  const share = total > 0 ? a / total : 0.5;
  const pct = (f: number) => `${Math.round(f * 100)}%`;
  return (
    <div className="min-w-0">
      <div className="flex h-1.5 gap-[3px]" role="img" aria-label={label ?? `Reserves split ${pct(share)} to ${pct(1 - share)} by value at spot`}>
        <span className={`rounded-full ${aClass} transition-[flex-grow] duration-200 ease-[var(--ease-out-quint)]`} style={{ flexGrow: Math.max(share, 0.02) }} />
        <span className={`rounded-full ${bClass} transition-[flex-grow] duration-200 ease-[var(--ease-out-quint)]`} style={{ flexGrow: Math.max(1 - share, 0.02) }} />
      </div>
      <div className="mt-2 flex items-start justify-between gap-3 text-[12px]">
        <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
          <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${aClass}`} />
          <span className="num truncate">{aLabel}</span>
        </span>
        <span className="flex min-w-0 items-center justify-end gap-1.5 text-right text-ink-2">
          <span className="num truncate">{bLabel}</span>
          <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${bClass}`} />
        </span>
      </div>
    </div>
  );
}

/**
 * Block countdown for a batch window: one segment per block (a continuous arc for long
 * windows). Remaining blocks are mint while the window is open; a closed window turns amber.
 */
export function BlockRing({ total, left, closed, size = 60 }: { total: number; left: number; closed: boolean; size?: number }) {
  const n = Math.max(1, total);
  const remaining = Math.max(0, Math.min(n, left));
  const stroke = 4;
  const r = size / 2 - stroke;
  const C = 2 * Math.PI * r;
  const segmented = n <= 48;
  const gap = segmented ? Math.min(3, (C / n) * 0.35) : 0;
  const seg = C / n;
  const label = closed ? "Window closed" : `${remaining} of ${n} blocks left in the window`;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        {segmented ? (
          Array.from({ length: n }, (_, i) => {
            const isLeft = i >= n - remaining;
            return (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                strokeWidth={stroke}
                strokeLinecap="butt"
                strokeDasharray={`${Math.max(0.5, seg - gap)} ${C}`}
                strokeDashoffset={-i * seg}
                className={cx(
                  "transition-[stroke] duration-200 ease-[var(--ease-out-quint)]",
                  closed ? "stroke-price/70" : isLeft ? "stroke-accent" : "stroke-line-strong",
                )}
              />
            );
          })
        ) : (
          <>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-line-strong" />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${(remaining / n) * C} ${C}`}
              className={cx("transition-[stroke-dasharray] duration-200 ease-[var(--ease-out-quint)]", closed ? "stroke-price/70" : "stroke-accent")}
            />
          </>
        )}
      </svg>
      <span aria-hidden className={cx("num absolute inset-0 flex items-center justify-center text-[15px]", closed ? "text-price" : "text-ink")}>
        {remaining}
      </span>
    </span>
  );
}

/** A definition list laid out as label / value rows on hairlines. */
export function DefList({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cx("grid gap-x-10 text-[13px] sm:grid-cols-2", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="flex min-h-11 items-center justify-between gap-4 border-b border-line py-2">
          <dt className="shrink-0 text-ink-3">{k}</dt>
          <dd className="num min-w-0 truncate text-right text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Section heading used between page sections (not inside cards). */
export function SectionTitle({ title, sub, right, id }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-[17px] font-medium tracking-[-0.01em] text-ink">
          {title}
        </h2>
        {sub && <p className="mt-1 max-w-[72ch] text-[13px] leading-relaxed text-ink-3">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
