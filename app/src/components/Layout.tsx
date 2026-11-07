import { Moon, Sun } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, ScrollRestoration, useLocation } from "react-router";
import { chain, IS_LOCAL } from "../config/env";
import { useAnonState } from "../config/anon";
import { useChainClock } from "../hooks/useChain";
import { Mark } from "./Mark";
import { cx, Notice } from "./ui";
import { WalletMenu } from "./WalletMenu";

type Theme = "light" | "dark";

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem("clinch.theme") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("clinch.theme", theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="inline-flex size-9 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

const links = [
  { to: "/launches", label: "Launches" },
  { to: "/markets", label: "Markets" },
  { to: "/how-it-works", label: "How it works" },
];

function NavItems({ className, id }: { className?: string; id: string }) {
  const reduced = useReducedMotion();
  const { pathname } = useLocation();
  return (
    <nav aria-label="Main" className={className}>
      {links.map((l) => {
        const active = pathname === l.to || pathname.startsWith(`${l.to}/`);
        return (
          <NavLink
            key={l.to}
            to={l.to}
            className={cx(
              "relative whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors duration-200",
              active ? "text-ink" : "text-ink-3 hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId={`nav-pill-${id}`}
                className="absolute inset-0 -z-10 rounded-full bg-surface-2 ring-1 ring-inset ring-line"
                transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 }}
              />
            )}
            {l.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

function ChainStatus() {
  const { blockNumber, error } = useChainClock();
  const anon = useAnonState();
  return (
    <div
      className="hidden h-8 items-center gap-2 rounded-full px-3 text-[12px] text-ink-3 ring-1 ring-inset ring-line lg:inline-flex"
      title={`${chain.name}. RPC reads ${anon.status === "on" ? "via Anon-RPC" : "direct"}.`}
    >
      <span className={cx("inline-block size-1.5 rounded-full", error ? "bg-bad" : "live-pulse bg-accent")} aria-hidden />
      <span>{error ? "RPC offline" : chain.name}</span>
      <span className="num text-ink-2">#{blockNumber?.toString() ?? "…"}</span>
      {anon.status === "on" && <span className="rounded-full bg-accent-soft px-1.5 text-accent">anon</span>}
    </div>
  );
}

export function Layout({ children }: { children?: ReactNode }) {
  const { error } = useChainClock();
  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-x-clip">
      <div className="app-ambient" aria-hidden />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-bg/75 backdrop-blur-xl supports-[backdrop-filter]:bg-bg/65">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-3 px-4 sm:px-6">
          <NavLink to="/" className="mr-2 flex items-center gap-2 text-[15px] font-medium tracking-tight text-ink" aria-label="Clinch home">
            <Mark className="size-7" />
            Clinch
          </NavLink>
          <NavItems id="desktop" className="relative isolate hidden items-center gap-0.5 md:flex" />
          <div className="ml-auto flex items-center gap-2">
            <ChainStatus />
            <ThemeToggle />
            <WalletMenu />
          </div>
        </div>
        <NavItems id="mobile" className="relative isolate flex gap-0.5 overflow-x-auto px-3 pb-2.5 md:hidden" />
      </header>
      {error && (
        <div className="relative mx-auto mt-4 w-full max-w-[1240px] px-4 sm:px-6">
          <Notice tone="bad">
            Cannot reach the RPC at {chain.rpcUrls.default.http[0]}. {IS_LOCAL ? "Is anvil running?" : "Check your connection."} Numbers below may be stale.
          </Notice>
        </div>
      )}
      <main id="main" className="relative flex-1">
        <Suspense fallback={<div className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6" aria-busy="true" />}>{children ?? <Outlet />}</Suspense>
      </main>
      <footer className="relative mt-16 border-t border-line">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-3 px-4 py-8 text-[12.5px] text-ink-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span className="flex items-center gap-2">
            <Mark className="size-4 text-ink-3" />
            Sybil-proof adaptive clinching, arXiv 2610.36629. No analytics, no trackers.
          </span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              Settlement is permissionless: if this site disappears, anyone can call <code className="num text-ink-2">settle()</code>.
            </span>
            <a href="/whitepaper.pdf" target="_blank" rel="noreferrer" className="text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink">
              Whitepaper (PDF)
            </a>
          </span>
        </div>
      </footer>
      <ScrollRestoration />
    </div>
  );
}
