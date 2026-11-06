import { Check, Copy, Info, Warning, XCircle } from "@phosphor-icons/react";
import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { addressUrl } from "../config/env";
import { shortAddr } from "../lib/format";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

type Variant = "primary" | "secondary" | "ghost" | "danger";

/** Button styles, for links that look like buttons. */
export function buttonStyles(variant: Variant = "secondary", size: "sm" | "md" | "lg" = "md", className?: string) {
  const base =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0";
  const sizes = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-[15px]" };
  const variants: Record<Variant, string> = {
    primary: "bg-accent text-accent-ink hover:brightness-110",
    secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-2",
    ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
    danger: "border border-bad/40 bg-bad-soft text-bad hover:border-bad",
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
  return <As className={cx("rounded-xl border border-line bg-surface", className)}>{children}</As>;
}

export function CardHeader({ title, right, sub }: { title: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
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
      <div className="num mt-1 truncate text-[17px] font-medium text-ink">{loading ? <Skeleton className="h-5 w-24" /> : value}</div>
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
  return <span className={cx("inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[12px] font-medium", tones[tone], className)}>{children}</span>;
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
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-2 w-64 -translate-x-1/2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-left text-[12.5px] font-normal leading-relaxed text-ink-2 opacity-0 shadow-[0_8px_24px_-12px_rgb(15_19_24/0.35)] transition-opacity duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
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
      className="inline-flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink"
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
    <div className={cx("flex gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed", styles[tone], className)} role={tone === "bad" ? "alert" : undefined}>
      <Icon size={16} className="mt-0.5 shrink-0" weight={tone === "ok" ? "bold" : "regular"} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
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
        "flex h-11 items-center rounded-lg border bg-surface px-3 transition-colors focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/30",
        invalid ? "border-bad" : "border-line-strong",
        disabled && "opacity-60",
      )}
    >
      {prefix && <span className="mr-1 text-ink-3">{prefix}</span>}
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        className="num h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
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
    <div role="radiogroup" aria-label={label} className="inline-grid auto-cols-fr grid-flow-col rounded-lg border border-line-strong bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-9 rounded-md px-3 text-[13px] font-medium transition-colors",
            value === o.value ? "bg-surface text-ink shadow-[0_1px_2px_rgb(15_19_24/0.12)]" : "text-ink-3 hover:text-ink",
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

export const th = "px-4 py-2.5 text-[12px] font-medium text-ink-3 first:pl-5 last:pr-5 whitespace-nowrap";
export const td = "px-4 py-2.5 first:pl-5 last:pr-5 whitespace-nowrap";
