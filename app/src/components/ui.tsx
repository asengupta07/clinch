import { Check, Circle, Copy, Hourglass, Info, Warning, XCircle } from "@phosphor-icons/react";
import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { addressUrl } from "../config/env";
import { shortAddr } from "../lib/format";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "danger";

/** Button styles, for links that look like buttons. */
export function buttonStyles(variant: Variant = "secondary", size: "sm" | "md" | "lg" = "md", className?: string) {
  const base =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background-color,border-color,color,transform,box-shadow] duration-200 ease-[var(--ease-out-quint)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100";
  const sizes = { sm: "h-8 px-3.5 text-[13px]", md: "h-10 px-5 text-[14px]", lg: "h-12 px-6 text-[15px]" };
  const variants: Record<Variant, string> = {
    primary:
      "bg-accent text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] hover:bg-accent-strong disabled:hover:bg-accent",
    secondary: "bg-surface-2 text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-3",
    ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
    danger: "bg-bad-soft text-bad ring-1 ring-inset ring-bad/35 hover:ring-bad/70",
  };
  return cx(base, sizes[size], variants[variant], className);
}

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button className={buttonStyles(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none", className)}
    />
  );
}

export function Card({ children, className, as: As = "section" }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" }) {
  return <As className={cx("rounded-[18px] border border-line bg-surface shadow-[var(--shadow)]", className)}>{children}</As>;
}

export function CardHeader({ title, right, sub }: { title: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5">
      <div className="min-w-0">
        <h2 className="text-[15px] font-medium tracking-[-0.01em] text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, hint, loading, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; loading?: boolean; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="num mt-1.5 truncate text-[18px] text-ink">{loading ? <Skeleton className="h-5 w-24" /> : value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-ink-3">{hint}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("skeleton inline-block align-middle", className)} />;
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" | "bad"; className?: string }) {
  const tones = {
    neutral: "border-line-strong bg-surface-2 text-ink-2",
    accent: "border-accent-line bg-accent-soft text-accent",
    warn: "border-warn/30 bg-warn-soft text-warn",
    bad: "border-bad/30 bg-bad-soft text-bad",
  };
  return <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium", tones[tone], className)}>{children}</span>;
}

/** An inline term with an accessible explanation on hover or keyboard focus. */
export function Term({ children, tip }: { children: ReactNode; tip: ReactNode }) {
  const id = useId();
  return (
    <span className="group relative inline-block">
      <button
        type="button"
        aria-describedby={id}
        className="cursor-help border-b border-dotted border-ink-3 text-inherit decoration-transparent focus-visible:rounded-sm"
      >
        {children}
      </button>
      <span
        role="tooltip"
        id={id}
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-[min(16rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-line-strong bg-surface-3 px-3.5 py-2.5 text-left text-[12.5px] font-normal leading-relaxed text-ink-2 shadow-[0_16px_32px_-16px_rgb(0_0_0/0.5)] group-focus-within:block group-hover:block motion-safe:group-focus-within:animate-[tip-in_180ms_var(--ease-out-quint)] motion-safe:group-hover:animate-[tip-in_180ms_var(--ease-out-quint)]"
      >
        {tip}
      </span>
    </span>
  );
}

export const TERMS = {
  clinch: "To clinch is to lock in units at the current price because the other bidders can no longer absorb them. Once clinched, those units are yours at that price.",
  dominant: "The side of the batch with more demand at the current spot price. The other (minority) side is filled in full at spot; the dominant side runs the ascending-price clinching auction against the pool.",
  rebate: "Prices move in small steps, so the engine slightly overcharges the dominant side. The settlement swaps everything collected into the pool and returns the extra output to the dominant side, pro rata.",
  escrow: "Your full budget is locked in the contract until settlement. That escrow is exactly the hypothesis of the sybil-proofness theorem: nobody can bid more than they hold.",
  nonUniform: "Each fill happens at the price where it was clinched, so two traders in the same batch can pay different average prices. That is what makes honest bidding optimal.",
  ladder: "The auction price rises in small steps of epsilon (set per launch or pool) and lands exactly on each bidder's limit, so nobody trades above their limit.",
};

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="inline-flex size-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
      aria-label={done ? "Copied" : `${label} ${value}`}
      title={done ? "Copied" : label}
    >
      {done ? <Check size={14} weight="bold" /> : <Copy size={14} />}
    </button>
  );
}

export function Address({ address, you, copy = false, full = false }: { address: string; you?: boolean; copy?: boolean; full?: boolean }) {
  const url = addressUrl(address);
  const text = full ? address : shortAddr(address);
  return (
    <span className="inline-flex items-center gap-1">
      {url ? (
        <a className="num text-ink hover:underline" href={url} target="_blank" rel="noreferrer" title={address}>
          {text}
        </a>
      ) : (
        <span className="num break-all text-ink" title={address}>
          {text}
        </span>
      )}
      {you && <Badge tone="accent" className="h-5 px-1.5 text-[11px]">you</Badge>}
      {copy && <CopyButton value={address} label="Copy address" />}
    </span>
  );
}

export function Notice({ tone = "info", children, className }: { tone?: "info" | "warn" | "bad" | "ok"; children: ReactNode; className?: string }) {
  const styles = {
    info: "border-line bg-surface-2 text-ink-2",
    warn: "border-warn/30 bg-warn-soft text-warn",
    bad: "border-bad/30 bg-bad-soft text-bad",
    ok: "border-accent-line bg-accent-soft text-accent",
  };
  const Icon = tone === "bad" ? XCircle : tone === "warn" ? Warning : tone === "ok" ? Check : Info;
  return (
    <div className={cx("flex gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed", styles[tone], className)} role={tone === "bad" ? "alert" : undefined}>
      <Icon size={16} className="mt-0.5 shrink-0" weight={tone === "ok" ? "bold" : "regular"} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-[46ch] text-[13px] leading-relaxed text-ink-3">{children}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  right,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  htmlFor: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        {right}
      </div>
      {children}
      {error ? (
        <p className="text-[12.5px] text-bad" id={`${htmlFor}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-ink-3" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function NumberInput({
  id,
  value,
  onChange,
  prefix,
  suffix,
  invalid,
  placeholder,
  disabled,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  invalid?: boolean;
  placeholder?: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <div
      className={cx(
        "flex h-12 items-center rounded-xl border bg-surface-2 px-3.5 transition-[border-color,box-shadow,background-color] duration-200 focus-within:border-accent-line focus-within:bg-surface focus-within:ring-4 focus-within:ring-accent-soft",
        invalid ? "border-bad ring-4 ring-bad-soft" : "border-line hover:border-line-strong",
        disabled && "opacity-60",
      )}
    >
      {prefix && <span className="mr-1 text-ink-3">{prefix}</span>}
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        className="num h-full min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => {
          const v = e.target.value.replace(/,/g, "");
          if (/^\d*\.?\d*$/.test(v)) onChange(v);
        }}
      />
      {suffix && <span className="ml-2 text-[13px] text-ink-3">{suffix}</span>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-grid auto-cols-fr grid-flow-col rounded-full bg-surface-2 p-1 ring-1 ring-inset ring-line">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-9 rounded-full px-4 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-200",
            value === o.value ? "bg-surface-3 text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_1px_2px_rgb(0_0_0/0.3)]" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">{children}</table>
    </div>
  );
}

export const th = "px-4 pb-2.5 pt-1 text-[12px] font-normal text-ink-3 first:pl-5 last:pr-5 whitespace-nowrap";
export const td = "px-4 py-3 first:pl-5 last:pr-5 whitespace-nowrap";

/* ------------------------------------------------------------------ page-level pieces */

/** Page title block: the only place the editorial serif appears inside the app. */
export function PageHeader({
  title,
  meta,
  actions,
  back,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("flex flex-col gap-5 pb-8 pt-10 sm:pt-12", className)}>
      {back}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          <h1 className="title-serif text-[40px] leading-[1.02] text-ink sm:text-[52px]">{title}</h1>
          {meta && <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px] text-ink-3">{meta}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export type StatusTone = "live" | "waiting" | "done" | "stopped" | "idle";

/** Status as icon + text, so state never rides on colour alone. */
export function StatusPill({ tone, children, className }: { tone: StatusTone; children: ReactNode; className?: string }) {
  const styles: Record<StatusTone, string> = {
    live: "bg-accent-soft text-accent ring-accent-line",
    waiting: "bg-price-soft text-price ring-price/30",
    done: "bg-surface-2 text-ink-2 ring-line-strong",
    stopped: "bg-bad-soft text-bad ring-bad/30",
    idle: "bg-surface-2 text-ink-3 ring-line",
  };
  return (
    <span className={cx("inline-flex h-7 items-center gap-2 rounded-full px-3 text-[12.5px] font-medium ring-1 ring-inset", styles[tone], className)}>
      {tone === "live" ? (
        <span aria-hidden className="live-pulse inline-block size-1.5 rounded-full bg-current" />
      ) : tone === "waiting" ? (
        <Hourglass size={13} weight="bold" aria-hidden />
      ) : tone === "done" ? (
        <Check size={13} weight="bold" aria-hidden />
      ) : tone === "stopped" ? (
        <XCircle size={13} weight="bold" aria-hidden />
      ) : (
        <Circle size={11} weight="bold" aria-hidden />
      )}
      {children}
    </span>
  );
}

/** A labelled position on a price range, e.g. clearing price between reserve and ceiling. */
export function RangeBar({
  min,
  max,
  value,
  minLabel,
  maxLabel,
  valueLabel,
  log = false,
}: {
  min: number;
  max: number;
  value: number | undefined;
  minLabel: ReactNode;
  maxLabel: ReactNode;
  valueLabel?: ReactNode;
  log?: boolean;
}) {
  const f = (v: number) => (log ? Math.log(v) : v);
  const pct = value === undefined || !(max > min) ? undefined : Math.min(100, Math.max(0, ((f(value) - f(min)) / (f(max) - f(min))) * 100));
  return (
    <div>
      <div className="relative h-8">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-strong" />
        <div className="absolute left-0 top-1/2 size-2 -translate-y-1/2 rounded-full bg-ink-3" />
        <div className="absolute right-0 top-1/2 size-2 -translate-y-1/2 rounded-full bg-ink-3" />
        {pct !== undefined && (
          <>
            <div className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-price" style={{ width: `${pct}%` }} />
            <div
              className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-price shadow-[0_0_0_4px_var(--price-soft)] transition-[left] duration-500 ease-[var(--ease-out-quint)]"
              style={{ left: `${pct}%` }}
            />
          </>
        )}
      </div>
      <div className="num mt-1 flex items-start justify-between gap-3 text-[12px] text-ink-3">
        <span>{minLabel}</span>
        {valueLabel && <span className="text-price">{valueLabel}</span>}
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

/** Thin progress with an explicit label; the track is a hairline, not a filled bar. */
export function Progress({ value, label, tone = "accent" }: { value: number; label?: ReactNode; tone?: "accent" | "price" }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={cx("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-[var(--ease-out-quint)]", tone === "price" ? "bg-price" : "bg-accent")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {label && <div className="mt-2 text-[12px] text-ink-3">{label}</div>}
    </div>
  );
}

/** Deterministic token monogram, so every token gets a recognisable mark without an image. */
export function TokenMark({ symbol, size = 40 }: { symbol: string; size?: number }) {
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = [158, 36, 210, 280, 12][h % 5];
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-medium text-ink ring-1 ring-inset ring-line-strong"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `radial-gradient(circle at 30% 25%, oklch(0.62 0.09 ${hue} / 0.55), oklch(0.32 0.05 ${hue} / 0.35) 70%)`,
      }}
    >
      {symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}
