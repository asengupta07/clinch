/**
 * Anon-RPC read path.
 *
 * When VITE_ANON_RPC_SPECIFIER is set, every READ the app makes (viem http transport) can be
 * routed through @anon-rpc/browser-harness: a hash-pinned anon-client running in a sandboxed,
 * null-origin worker that hands back an anonymized `fetch`. Writes (signing, sending, gas
 * estimation) always go to the normal RPC, and the UI says so.
 *
 * Without a specifier the toggle is disabled; we never pretend reads are anonymized.
 */
import { useSyncExternalStore } from "react";
import { ANON_RPC_SPECIFIER, RPC_URL } from "./env";

type AnonWorker = { ready: Promise<void>; fetch: typeof fetch; close(): void };

export type AnonStatus = "unavailable" | "off" | "starting" | "on" | "error";

interface State {
  status: AnonStatus;
  error?: string;
}

const STORAGE_KEY = "clinch.anonRpc";
let state: State = { status: ANON_RPC_SPECIFIER ? "off" : "unavailable" };
let worker: AnonWorker | null = null;
const listeners = new Set<() => void>();

function set(s: State) {
  state = s;
  listeners.forEach((l) => l());
}

/** Plain JSON-RPC provider used only to bootstrap the harness (it reads the specifier contract). */
const bootstrapProvider = {
  async request({ method, params }: { method: string; params?: unknown[] }) {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error.message ?? "RPC error");
    return j.result;
  },
};

export async function enableAnon(): Promise<void> {
  if (!ANON_RPC_SPECIFIER) return;
  set({ status: "starting" });
  try {
    const { AnonRpcWorker } = await import("@anon-rpc/browser-harness");
    worker?.close();
    const w = new AnonRpcWorker({ address: ANON_RPC_SPECIFIER, preExisting: { rpcProvider: bootstrapProvider } });
    worker = w as unknown as AnonWorker;
    await Promise.race([
      w.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error("anon-client did not become ready within 30s")), 30_000)),
    ]);
    set({ status: "on" });
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* storage unavailable */
    }
  } catch (e) {
    worker?.close();
    worker = null;
    set({ status: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

export function disableAnon() {
  worker?.close();
  worker = null;
  if (state.status !== "unavailable") set({ status: "off" });
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Restore the user's previous choice on load. */
export function initAnon() {
  if (!ANON_RPC_SPECIFIER) return;
  try {
    if (localStorage.getItem(STORAGE_KEY) === "1") void enableAnon();
  } catch {
    /* storage unavailable */
  }
}

/**
 * fetch used by the read transport. While Anon-RPC is starting, reads wait for it rather than
 * leaking to the plain RPC; if it fails, the status flips to "error" and reads use the plain RPC
 * again, which the UI shows as a warning.
 */
export const readFetch: typeof fetch = async (input, init) => {
  if (worker && (state.status === "on" || state.status === "starting")) {
    try {
      await worker.ready;
      return await worker.fetch(input as string, init);
    } catch (e) {
      set({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }
  return fetch(input, init);
};

export function useAnonState(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
