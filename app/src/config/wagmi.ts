import { createPublicClient, http } from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { demoConnector, demoWallets } from "../wallet/demo";
import { readFetch } from "./anon";
import { chain, RPC_URL } from "./env";

/** Read transport: the configured RPC, optionally through the Anon-RPC worker. */
export const readTransport = http(RPC_URL, { fetchFn: readFetch, retryCount: 2 });

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected({ shimDisconnect: true }), ...demoWallets.map((w) => demoConnector(w.index))],
  transports: { [chain.id]: readTransport },
  pollingInterval: 1_000,
});

/** Plain public client for reads outside React (logs, engine inputs). Same transport. */
export const publicClient = createPublicClient({ chain, transport: readTransport, pollingInterval: 1_000 });
