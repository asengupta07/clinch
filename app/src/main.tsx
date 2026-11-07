import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "@rainbow-me/rainbowkit/styles.css";
import { WagmiProvider } from "wagmi";
import { WalletKitProvider } from "./wallet/WalletKitProvider";
import { initAnon } from "./config/anon";
import { wagmiConfig } from "./config/wagmi";
import { ToastProvider } from "./components/Toasts";
import { ChainProvider } from "./hooks/useChain";
import { routes } from "./routes";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1_000,
      refetchOnWindowFocus: false,
      retry: 1,
      // keep showing the last good value while the next block's value loads: no layout shift
      placeholderData: (prev: unknown) => prev,
    },
  },
});

initAnon();

const router = createBrowserRouter(routes);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletKitProvider>
          <ToastProvider>
            <ChainProvider>
              <RouterProvider router={router} />
            </ChainProvider>
          </ToastProvider>
        </WalletKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
