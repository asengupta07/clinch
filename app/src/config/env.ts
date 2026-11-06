import { defineChain, type Address } from "viem";
import { parseDeployments } from "./deployments";

export const deployments = parseDeployments(__DEPLOYMENTS__);

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || deployments.chainId || 31337);
export const RPC_URL = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";
export const EXPLORER_URL = (import.meta.env.VITE_EXPLORER_URL || "").replace(/\/$/, "");
export const ANON_RPC_SPECIFIER = (import.meta.env.VITE_ANON_RPC_SPECIFIER || "") as Address | "";
export const IS_LOCAL = CHAIN_ID === 31337;

export const chain = defineChain({
  id: CHAIN_ID,
  name: IS_LOCAL ? "Anvil (local)" : CHAIN_ID === 11155111 ? "Sepolia" : CHAIN_ID === 1 ? "Ethereum" : `Chain ${CHAIN_ID}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: EXPLORER_URL ? { default: { name: "Explorer", url: EXPLORER_URL } } : undefined,
  testnet: CHAIN_ID !== 1,
});

export function txUrl(hash: string): string | null {
  return EXPLORER_URL ? `${EXPLORER_URL}/tx/${hash}` : null;
}
export function addressUrl(a: string): string | null {
  return EXPLORER_URL ? `${EXPLORER_URL}/address/${a}` : null;
}
