import { Desktop, Moon, Sun } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, ScrollRestoration } from "react-router";
import { chain, IS_LOCAL } from "../config/env";
import { useAnonState } from "../config/anon";
import { useChainClock } from "../hooks/useChain";
import { cx, Notice } from "./ui";
import { WalletMenu } from "./WalletMenu";

type Theme = "system" | "light" | "dark";

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const t = localStorage.getItem("clinch.theme");
      return t === "light" || t === "dark" ? t : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "system") delete el.dataset.theme;
    else el.dataset.theme = theme;
    try {
      if (theme === "system") localStorage.removeItem("clinch.theme");
      else localStorage.setItem("clinch.theme", theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  const next: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Desktop;
  return (
    <button
      type="button"
      onClick={() => setTheme(next[theme])}
      className="inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink"
      aria-label={`Theme: ${theme}. Switch to ${next[theme]}.`}
      title={`Theme: ${theme}`}
    >
      <Icon size={17} />
    </button>
  );
}

const links = [
  { to: "/", label: "Overview", end: true },
  { to: "/launches", label: "Launches" },
  { to: "/markets", label: "Markets" },
  { to: "/how-it-works", label: "How it works" },
];

function NavItems({ className }: { className?: string }) {
  return (
    <nav aria-label="Main" className={className}>
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          className={({ isActive }) =>
            cx("whitespace-nowrap rounded-lg px-3 py-1.5 text-[13.5px] transition-colors", isActive ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink")
          }
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  );
}

function ChainStatus() {
  const { blockNumber, error } = useChainClock();
  const anon = useAnonState();
  return (
    <div className="hidden items-center gap-2 text-[12px] text-ink-3 lg:flex" title={`RPC reads ${anon.status === "on" ? "via Anon-RPC" : "direct"}`}>
      <span className={cx("inline-block size-1.5 rounded-full", error ? "bg-bad" : "bg-accent")} aria-hidden />
      <span>{chain.name}</span>
      <span className="num">#{blockNumber?.toString() ?? "…"}</span>
      {anon.status === "on" && <span className="rounded border border-accent-line px-1 text-accent">anon reads</span>}
    </div>
  );
}

export function Layout({ children }: { children?: ReactNode }) {
  const { error } = useChainClock();
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/75">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-4 px-4 sm:px-6">
          <NavLink to="/" className="flex items-center gap-2 text-[16px] font-semibold tracking-tight text-ink" aria-label="Clinch home">
            <img src="/favicon.svg" alt="" className="size-6" />
            Clinch
          </NavLink>
          <NavItems className="hidden items-center gap-1 md:flex" />
          <div className="ml-auto flex items-center gap-2">
            <ChainStatus />
            <ThemeToggle />
            <WalletMenu />
          </div>
        </div>
        <NavItems className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden" />
      </header>
      {error && (
        <div className="mx-auto mt-4 w-full max-w-[1240px] px-4 sm:px-6">
          <Notice tone="bad">
            Cannot reach the RPC at {chain.rpcUrls.default.http[0]}. {IS_LOCAL ? "Is anvil running?" : "Check your connection."} Numbers below may be stale.
          </Notice>
        </div>
      )}
      <main id="main" className="flex-1">
        {children ?? <Outlet />}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-[12.5px] text-ink-3 sm:px-6">
          <span>Clinch implements sybil-proof adaptive clinching (arXiv 2610.36629). No analytics, no trackers.</span>
          <span>
            Settlement is permissionless. If this site disappears, anyone can call <code className="num">settle()</code>.
          </span>
        </div>
      </footer>
      <ScrollRestoration />
    </div>
  );
}
