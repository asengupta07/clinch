import type { StatusTone } from "../../components/ui";
import type { LaunchData, TokenMeta } from "../../hooks/data";
import { fmtDuration } from "../../lib/format";
import { rawToHumanPrice } from "../../lib/units";

export type Phase = "pending" | "open" | "ended" | "rescuable" | "settled" | "cancelled";

/** Where a launch is in its life, from its on-chain status and the chain clock. */
export function phaseOf(l: LaunchData, now: number | undefined): Phase {
  if (l.status === 0) return "pending";
  if (l.status === 2) return "settled";
  if (l.status === 3) return "cancelled";
  const end = Number(l.params.endTime);
  if (now === undefined || now < end) return "open";
  if (now < end + Number(l.params.rescueDelay)) return "ended";
  return "rescuable";
}

export const PHASE_META: Record<Phase, { label: string; tone: StatusTone }> = {
  pending: { label: "Pending", tone: "idle" },
  open: { label: "Bidding open", tone: "live" },
  ended: { label: "Awaiting settlement", tone: "waiting" },
  rescuable: { label: "Rescue available", tone: "waiting" },
  settled: { label: "Settled", tone: "done" },
  cancelled: { label: "Cancelled", tone: "stopped" },
};

export function fmtWhen(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** One short line about time: a countdown while something is pending, the end time otherwise. */
export function timingText(l: LaunchData, phase: Phase, now: number | undefined): string | null {
  if (now === undefined) return null;
  const end = Number(l.params.endTime);
  if (phase === "pending") return "Not open yet";
  if (phase === "open") return `Closes in ${fmtDuration(end - now)}`;
  if (phase === "ended") return `Ended ${fmtWhen(end)}, rescue opens in ${fmtDuration(end + Number(l.params.rescueDelay) - now)}`;
  return `Ended ${fmtWhen(end)}`;
}

export function humanPrice(raw: bigint, sale: TokenMeta, quote: TokenMeta) {
  return rawToHumanPrice(raw, sale.decimals, quote.decimals);
}

/** The launch's price axis: reserve to ceiling (or a little past the top bid if no ceiling is set). */
export function priceAxis(l: LaunchData, sale: TokenMeta, quote: TokenMeta) {
  const min = humanPrice(l.params.reservePrice, sale, quote);
  if (l.params.maxPrice > 0n) return { min, max: humanPrice(l.params.maxPrice, sale, quote), capped: true };
  const top = l.bids.reduce((a, b) => (b.limit > a ? b.limit : a), l.params.reservePrice);
  return { min, max: Math.max(humanPrice(top, sale, quote) * 1.25, min * 2), capped: false };
}

/** Position of a price on a log axis, clamped to 0..1. */
export function axisPos(v: number, min: number, max: number) {
  if (!(max > min) || !(v > 0) || !(min > 0)) return 0;
  return Math.min(1, Math.max(0, (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min))));
}

/** A bigint share as a 0..1 number with 4 decimal places of precision. */
export function share(part: bigint, whole: bigint) {
  return whole > 0n ? Number((part * 10_000n) / whole) / 10_000 : 0;
}
