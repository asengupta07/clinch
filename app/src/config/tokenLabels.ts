import type { Address } from "viem";
import { CHAIN_ID } from "./env";

/**
 * Display names for a few specific Sepolia demo tokens. A retry bug opened several identical
 * "Clinch Live Token" launches; these give three of them distinct names in the app. Keyed by
 * exact chain + token address, so no other token (and no newly created launch) is affected.
 * On chain the tokens are still named "Clinch Live Token" / LIVE.
 */
const LABELS: Record<number, Record<string, { name: string; symbol: string }>> = {
  11155111: {
    "0x428dc4c8a0361c76b613b39144670e5f0e7d4981": { name: "Monsoon Token", symbol: "MNSN" },
    "0xd839d5f9152958f085c0989f42d70987ca4b8206": { name: "Chai Token", symbol: "CHAI" },
    "0x3f888fa8ee1fbe9eee14ae28b913d828d02e5c4c": { name: "Dabba Token", symbol: "DABBA" },
  },
};

export function tokenLabel(address: Address): { name: string; symbol: string } | undefined {
  return LABELS[CHAIN_ID]?.[address.toLowerCase()];
}

/**
 * Launches left out of the Launches list. The first World ID arm was deployed with a mock verifier
 * that accepts any well-formed proof; it was replaced by the portal-verified gate and only stays on
 * chain. Still reachable by its direct URL.
 */
const HIDDEN_LAUNCHES: Record<number, string[]> = {
  11155111: ["0x0a33e81c5188b4b142a0e4192d72e8798f683017"],
};

export function isHiddenLaunch(address: Address): boolean {
  return HIDDEN_LAUNCHES[CHAIN_ID]?.includes(address.toLowerCase()) ?? false;
}
