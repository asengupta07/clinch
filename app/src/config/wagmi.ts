import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet, metaMaskWallet, rabbyWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createPublicClient, http } from "viem";
import { createConfig } from "wagmi";
import { demoConnector, demoWallets } from "../wallet/demo";
import { readFetch } from "./anon";
import { chain, RPC_URL } from "./env";

/** Read transport: the configured RPC, optionally through the Anon-RPC worker. */
export const readTransport = http(RPC_URL, { fetchFn: readFetch, retryCount: 2 });

/** WalletConnect project id (cloud.reown.com). Optional: without it only browser-extension wallets are offered. */
export const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "";

// Browser extensions first, through the injected provider directly: the MetaMask SDK deep-link flow
// hangs on "Opening MetaMask" when no extension is installed. Mobile wallets need WalletConnect and a
// real project id; without one they are left out so the relay is never contacted.
const rainbowConnectors = connectorsForWallets(
  WALLETCONNECT_PROJECT_ID
    ? [
        { groupName: "Browser", wallets: [injectedWallet, metaMaskWallet, rabbyWallet, coinbaseWallet] },
        { groupName: "Mobile", wallets: [rainbowWallet, walletConnectWallet] },
      ]
    : [{ groupName: "Browser", wallets: [injectedWallet, rabbyWallet, coinbaseWallet] }],
  { appName: "Clinch", projectId: WALLETCONNECT_PROJECT_ID || "unused" },
);

export const wagmiConfig = createConfig({
  chains: [chain],
  // Demo connectors exist only on the local anvil chain (demoWallets is empty elsewhere).
  connectors: [...rainbowConnectors, ...demoWallets.map((w) => demoConnector(w.index))],
  transports: { [chain.id]: readTransport },
  pollingInterval: 1_000,
});

/** Plain public client for reads outside React (logs, engine inputs). Same transport. */
export const publicClient = createPublicClient({ chain, transport: readTransport, pollingInterval: 1_000 });
