import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useBlock } from "wagmi";

interface ChainClock {
  blockNumber: bigint | undefined;
  /** timestamp of the latest block */
  blockTime: number | undefined;
  /** best estimate of the chain's current time (latest block time + local elapsed) */
  now: number | undefined;
  /** RPC unreachable */
  error: boolean;
}

const Ctx = createContext<ChainClock>({ blockNumber: undefined, blockTime: undefined, now: undefined, error: false });

/**
 * Watches the head block. On every new block it refetches all active chain reads, so every
 * number on screen is at most one block old. Also exposes a ticking chain clock for countdowns.
 */
export function ChainProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const block = useBlock({ watch: true, query: { meta: { static: true }, refetchInterval: 4_000 } });
  const seen = useRef<{ n: bigint; at: number; ts: number } | null>(null);
  const [tick, setTick] = useState(0);

  const n = block.data?.number;
  useEffect(() => {
    if (n === undefined || n === null || !block.data) return;
    if (seen.current?.n === n) return;
    seen.current = { n, at: Date.now(), ts: Number(block.data.timestamp) };
    void qc.invalidateQueries({ predicate: (q) => !(q.meta as { static?: boolean } | undefined)?.static, refetchType: "active" });
  }, [n, block.data, qc]);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const s = seen.current;
  const value: ChainClock = {
    blockNumber: n ?? undefined,
    blockTime: s?.ts,
    // never run more than one block-time ahead of the last seen block on a stalled chain
    now: s ? s.ts + Math.min((Date.now() - s.at) / 1000, 30) : undefined,
    error: block.isError && !block.data,
  };
  void tick;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChainClock() {
  return useContext(Ctx);
}
