import type { Address } from "viem";
import { getAddress, isAddress } from "viem";

/** Shape written by contracts/script/DeployLocal.s.sol (deployments/local.json). */
export interface Deployments {
  chainId: number;
  poolManager: Address;
  hook: Address;
  factory: Address;
  launch?: Address;
  usdc?: Address;
  weth?: Address;
  clnch?: Address;
  swapCurrency0?: Address;
  swapCurrency1?: Address;
  swapTickSpacing?: number;
  deployBlock: number;
}

export function parseDeployments(raw: Record<string, unknown>): Deployments {
  const addr = (k: string, required = false): Address | undefined => {
    const v = raw[k];
    if (typeof v === "string" && isAddress(v)) return getAddress(v);
    if (required) throw new Error(`deployments: missing or invalid address "${k}"`);
    return undefined;
  };
  return {
    chainId: Number(raw.chainId ?? 31337),
    poolManager: addr("poolManager", true)!,
    hook: addr("hook", true)!,
    factory: addr("factory", true)!,
    launch: addr("launch"),
    usdc: addr("usdc"),
    weth: addr("weth"),
    clnch: addr("clnch"),
    swapCurrency0: addr("swapCurrency0"),
    swapCurrency1: addr("swapCurrency1"),
    swapTickSpacing: raw.swapTickSpacing === undefined ? undefined : Number(raw.swapTickSpacing),
    deployBlock: Number(raw.deployBlock ?? 0),
  };
}
