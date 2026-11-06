import { formatUnits } from "viem";

/**
 * Format a number with thousands separators and a precision that suits its magnitude:
 * large values get fewer decimals, small values keep significant digits.
 */
export function fmt(n: number | null | undefined, opts: { max?: number; min?: number; sig?: number } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  let max = opts.max;
  if (max === undefined) {
    if (abs >= 1e5) max = 0;
    else if (abs >= 1000) max = 2;
    else if (abs >= 1) max = 4;
    else {
      // keep `sig` significant digits for small numbers
      const sig = opts.sig ?? 4;
      max = Math.min(18, Math.max(2, sig - Math.floor(Math.log10(abs)) - 1));
    }
  }
  return n.toLocaleString("en-US", { minimumFractionDigits: Math.min(opts.min ?? 0, max), maximumFractionDigits: max });
}

/** Format a raw token amount. */
export function fmtAmount(raw: bigint | null | undefined, decimals: number, opts?: { max?: number; min?: number }): string {
  if (raw === null || raw === undefined) return "-";
  return fmt(Number(formatUnits(raw, decimals)), opts);
}

/** Price in quote units, e.g. "$0.4200" for USD-like quotes. */
export function fmtPrice(p: number | null | undefined, quoteSymbol: string, opts?: { max?: number; min?: number }): string {
  if (p === null || p === undefined || !Number.isFinite(p)) return "-";
  const usd = /^(USDC|USDT|DAI|USD)/i.test(quoteSymbol);
  const s = fmt(p, opts ?? (usd ? { min: 2, max: p >= 1000 ? 2 : p >= 1 ? 4 : 6 } : {}));
  return usd ? `$${s}` : `${s} ${quoteSymbol}`;
}

export function fmtPct(f: number | null | undefined, digits = 2): string {
  if (f === null || f === undefined || !Number.isFinite(f)) return "-";
  return `${(f * 100).toFixed(digits)}%`;
}

export function shortAddr(a: string | undefined | null): string {
  if (!a) return "-";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** "3m 12s", "1h 04m", "2d 3h" */
export function fmtDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}
