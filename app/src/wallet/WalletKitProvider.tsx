import { darkTheme, lightTheme, RainbowKitProvider, type Theme } from "@rainbow-me/rainbowkit";
import { useEffect, useState, type ReactNode } from "react";
import { chain } from "../config/env";

const accent = { dark: { color: "#8fe0b8", fg: "#06190f" }, light: { color: "#0b7a55", fg: "#ffffff" } };

function useAppTheme(): "dark" | "light" {
  const read = (): "dark" | "light" => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
  const [t, setT] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setT(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return t;
}

/** RainbowKit, themed to the app and following its own light/dark toggle (not the OS setting). */
export function WalletKitProvider({ children }: { children: ReactNode }) {
  const mode = useAppTheme();
  const base = mode === "light" ? lightTheme : darkTheme;
  const theme: Theme = base({
    accentColor: accent[mode].color,
    accentColorForeground: accent[mode].fg,
    borderRadius: "large",
    fontStack: "system",
    overlayBlur: "small",
  });
  return (
    <RainbowKitProvider theme={theme} modalSize="compact" initialChain={chain} appInfo={{ appName: "Clinch" }}>
      {children}
    </RainbowKitProvider>
  );
}
