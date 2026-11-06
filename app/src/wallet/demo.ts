/**
 * Demo wallets for the LOCAL anvil chain only.
 *
 * These are anvil's standard, publicly known development keys (the same ones printed by
 * `anvil` on startup and used in contracts/script/SeedDemo.s.sol). They hold no real value and
 * are never offered on any other chain. Transactions are signed in the browser with a viem
 * local account and sent to the configured RPC.
 */
import { createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createConnector } from "wagmi";
import { chain, IS_LOCAL, RPC_URL } from "../config/env";

const ANVIL_KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
];

export interface DemoWallet {
  index: number;
  address: Address;
  label: string;
}

const LABELS: Record<number, string> = {
  0: "Issuer (deployer)",
  1: "Bidder",
  2: "Bidder",
  3: "Bidder",
  4: "Bidder",
  5: "Bidder",
  6: "Whale",
  7: "Fresh wallet",
};

export const demoWallets: DemoWallet[] = IS_LOCAL
  ? ANVIL_KEYS.map((pk, index) => ({ index, address: privateKeyToAccount(pk).address, label: LABELS[index] }))
  : [];

export const DEMO_CONNECTOR_TYPE = "demo";

export function demoConnectorId(index: number) {
  return `clinch-demo-${index}`;
}

export function demoConnector(index: number) {
  const account = privateKeyToAccount(ANVIL_KEYS[index]);
  const id = demoConnectorId(index);
  // Each connector needs a distinct provider object (wagmi de-duplicates by identity).
  const provider = { demo: index };
  return createConnector<typeof provider>((config) => ({
    id,
    name: `Demo wallet #${index}`,
    type: DEMO_CONNECTOR_TYPE,
    async connect() {
      return { accounts: [account.address] as never, chainId: chain.id };
    },
    async disconnect() {},
    async getAccounts() {
      return [account.address];
    },
    async getChainId() {
      return chain.id;
    },
    async getProvider() {
      return provider;
    },
    async getClient() {
      return createWalletClient({ account, chain, transport: http(RPC_URL) });
    },
    async isAuthorized() {
      try {
        return (await config.storage?.getItem("recentConnectorId")) === id;
      } catch {
        return false;
      }
    },
    async switchChain({ chainId }) {
      if (chainId !== chain.id) throw new Error("Demo wallets only work on the local chain");
      return chain;
    },
    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {
      config.emitter.emit("disconnect");
    },
  }));
}
