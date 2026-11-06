import { ArrowSquareOut, CheckCircle, X, XCircle } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { txUrl } from "../config/env";
import { shortAddr } from "../lib/format";
import { Spinner } from "./ui";

export type ToastKind = "pending" | "success" | "error" | "info";
export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  hash?: string;
}

interface Ctx {
  push(t: Omit<Toast, "id">): number;
  update(id: number, t: Partial<Omit<Toast, "id">>): void;
  dismiss(id: number): void;
}

const ToastCtx = createContext<Ctx | null>(null);

export function useToasts(): Ctx {
  const c = useContext(ToastCtx);
  if (!c) throw new Error("ToastProvider missing");
  return c;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const reduce = useReducedMotion();

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    const tm = timers.current.get(id);
    if (tm) clearTimeout(tm);
    timers.current.delete(id);
  }, []);

  const schedule = useCallback(
    (id: number, kind: ToastKind) => {
      const old = timers.current.get(id);
      if (old) clearTimeout(old);
      if (kind === "pending") return;
      timers.current.set(id, setTimeout(() => dismiss(id), kind === "error" ? 12_000 : 6_000));
    },
    [dismiss],
  );

  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
      schedule(id, t.kind);
      return id;
    },
    [schedule],
  );

  const update = useCallback(
    (id: number, patch: Partial<Omit<Toast, "id">>) => {
      setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      if (patch.kind) schedule(id, patch.kind);
    },
    [schedule],
  );

  const value = useMemo(() => ({ push, update, dismiss }), [push, update, dismiss]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-[380px]">
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const url = t.hash ? txUrl(t.hash) : null;
            return (
              <motion.div
                key={t.id}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                transition={{ type: "spring", stiffness: 400, damping: 34 }}
                className="pointer-events-auto flex w-full gap-3 rounded-xl border border-line-strong bg-surface p-3.5 shadow-[0_12px_32px_-16px_rgb(15_19_24/0.45)]"
                role={t.kind === "error" ? "alert" : "status"}
              >
                <div className="mt-0.5 shrink-0">
                  {t.kind === "pending" && <Spinner className="text-ink-2" />}
                  {t.kind === "success" && <CheckCircle size={18} weight="fill" className="text-accent" />}
                  {t.kind === "error" && <XCircle size={18} weight="fill" className="text-bad" />}
                  {t.kind === "info" && <CheckCircle size={18} className="text-ink-3" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-ink">{t.title}</p>
                  {t.body && <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{t.body}</p>}
                  {t.hash && (
                    <p className="mt-1 text-[12px] text-ink-3">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink">
                          tx {shortAddr(t.hash)} <ArrowSquareOut size={12} />
                        </a>
                      ) : (
                        <span className="num">tx {shortAddr(t.hash)}</span>
                      )}
                    </p>
                  )}
                </div>
                <button type="button" onClick={() => dismiss(t.id)} className="size-6 shrink-0 rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Dismiss">
                  <X size={14} className="mx-auto" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
