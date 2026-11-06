import { useQuery } from "@tanstack/react-query";
import { encodeAbiParameters, getAddress, keccak256, parseAbiItem, type Address, type Hex } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { erc20Abi, factoryAbi, hookAbi, launchAbi } from "../abi";
import { deployments } from "../config/env";
import { publicClient } from "../config/wagmi";
import type { MarketOrientation } from "../lib/units";

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export function poolIdOf(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

export interface TokenMeta {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  faucetAmount: bigint;
}

const STATIC = { staleTime: Infinity, gcTime: Infinity, meta: { static: true } } as const;

export function useToken(address: Address | undefined) {
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: address!, abi: erc20Abi, functionName: "symbol" },
      { address: address!, abi: erc20Abi, functionName: "name" },
      { address: address!, abi: erc20Abi, functionName: "decimals" },
      { address: address!, abi: erc20Abi, functionName: "faucetAmount" },
    ],
    query: { enabled: !!address, ...STATIC },
  });
  const d = q.data;
  const token: TokenMeta | undefined =
    address && d && d[0].status === "success" && d[2].status === "success"
      ? {
          address,
          symbol: d[0].result as string,
          name: d[1].status === "success" ? (d[1].result as string) : (d[0].result as string),
          decimals: Number(d[2].result),
          faucetAmount: d[3].status === "success" ? (d[3].result as bigint) : 0n,
        }
      : undefined;
  return { token, isLoading: q.isLoading, isError: q.isError };
}

export function useBalance(token: Address | undefined, owner: Address | undefined) {
  return useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: owner ? [owner] : undefined,
    query: { enabled: !!token && !!owner },
  });
}

export function useAllowance(token: Address | undefined, owner: Address | undefined, spender: Address | undefined) {
  return useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: owner && spender ? [owner, spender] : undefined,
    query: { enabled: !!token && !!owner && !!spender },
  });
}

// ------------------------------------------------------------------ launches

export const LAUNCH_STATUS = ["Pending", "Live", "Settled", "Cancelled"] as const;

export function useLaunchList() {
  return useReadContract({ address: deployments.factory, abi: factoryAbi, functionName: "allLaunches" });
}

export function useLaunch(address: Address | undefined) {
  const c = { address: address!, abi: launchAbi } as const;
  const q = useReadContracts({
    allowFailure: false,
    contracts: [
          { ...c, functionName: "params" },
          { ...c, functionName: "status" },
          { ...c, functionName: "issuer" },
          { ...c, functionName: "saleIsToken0" },
          { ...c, functionName: "totalBudget" },
          { ...c, functionName: "sold" },
          { ...c, functionName: "proceeds" },
          { ...c, functionName: "clearingPrice" },
          { ...c, functionName: "steps" },
          { ...c, functionName: "issuerQuote" },
          { ...c, functionName: "issuerSale" },
          { ...c, functionName: "poolSeeded" },
          { ...c, functionName: "lpLiquidity" },
          { ...c, functionName: "getBids" },
          { ...c, functionName: "poolKey" },
        ],
    query: { enabled: !!address },
  });
  const d = q.data;
  const data = d
    ? {
        params: d[0],
        status: Number(d[1]),
        issuer: d[2],
        saleIsToken0: d[3],
        totalBudget: d[4],
        sold: d[5],
        proceeds: d[6],
        clearingPrice: d[7],
        steps: d[8],
        issuerQuote: d[9],
        issuerSale: d[10],
        poolSeeded: d[11],
        lpLiquidity: d[12],
        bids: d[13],
        poolKey: d[14] as PoolKey,
      }
    : undefined;
  return { data, isLoading: q.isLoading, isError: q.isError, error: q.error };
}

export type LaunchData = NonNullable<ReturnType<typeof useLaunch>["data"]>;

export function useLaunchPreview(address: Address | undefined, enabled: boolean) {
  return useReadContract({ address, abi: launchAbi, functionName: "previewSettle", query: { enabled: !!address && enabled, retry: false } });
}

// ------------------------------------------------------------------ pools

export interface MarketInfo {
  id: Hex;
  key: PoolKey;
  /** the asset being bought and sold (e.g. WETH, CLNCH) */
  base: Address;
  /** the asset prices are quoted in (e.g. USDC) */
  quote: Address;
  baseIsToken0: boolean;
  initBlock: bigint;
}

const poolInitializedEvent = parseAbiItem(
  "event PoolInitialized(bytes32 indexed id, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96, (uint32 windowBlocks, uint32 rescueBlocks, uint16 maxOrders, uint16 maxDepthBps, uint64 eps, uint128 minOrder0, uint128 minOrder1) cfg)",
);

export function marketFromKey(key: PoolKey, initBlock = 0n): MarketInfo {
  const c0 = getAddress(key.currency0);
  const c1 = getAddress(key.currency1);
  const usdc = deployments.usdc;
  // Quote in the dollar token when there is one; otherwise quote in token1.
  const quote = usdc && c0 === usdc ? c0 : usdc && c1 === usdc ? c1 : c1;
  const base = quote === c0 ? c1 : c0;
  return { id: poolIdOf(key), key: { ...key, currency0: c0, currency1: c1, hooks: getAddress(key.hooks) }, base, quote, baseIsToken0: base === c0, initBlock };
}

/** All Clinch pools, from the hook's PoolInitialized events. */
export function useMarkets() {
  return useQuery({
    queryKey: ["markets", deployments.hook],
    queryFn: async () => {
      const logs = await publicClient.getLogs({
        address: deployments.hook,
        event: poolInitializedEvent,
        fromBlock: BigInt(deployments.deployBlock),
        toBlock: "latest",
      });
      return logs.map((l) => marketFromKey(l.args.key as PoolKey, l.blockNumber ?? 0n));
    },
  });
}

export function orientation(m: MarketInfo, base: TokenMeta | undefined, quote: TokenMeta | undefined): MarketOrientation | undefined {
  if (!base || !quote) return undefined;
  return { baseDecimals: base.decimals, quoteDecimals: quote.decimals, baseIsToken0: m.baseIsToken0 };
}

export function usePool(key: PoolKey | undefined) {
  const c = { address: deployments.hook, abi: hookAbi } as const;
  const q = useReadContracts({
    allowFailure: false,
    contracts: [
      { ...c, functionName: "poolState", args: [key!] },
      { ...c, functionName: "reserves", args: [key!] },
    ],
    query: { enabled: !!key },
  });
  const d = q.data;
  return {
    data: d ? { state: d[0], reserves: d[1] as readonly [bigint, bigint] } : undefined,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
  };
}

export function useBatch(key: PoolKey | undefined, batchId: bigint | undefined) {
  const c = { address: deployments.hook, abi: hookAbi } as const;
  const enabled = !!key && batchId !== undefined && batchId > 0n;
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...c, functionName: "getBatch", args: [key!, batchId ?? 0n] },
      { ...c, functionName: "getOrders", args: [key!, batchId ?? 0n] },
      { ...c, functionName: "previewSettle", args: [key!, batchId ?? 0n] },
    ],
    query: { enabled },
  });
  const d = q.data;
  return {
    data:
      d && d[0].status === "success" && d[1].status === "success"
        ? {
            batch: d[0].result,
            orders: d[1].result,
            preview: d[2].status === "success" ? d[2].result : undefined,
            previewError: d[2].status === "failure" ? d[2].error : undefined,
          }
        : undefined,
    isLoading: q.isLoading,
  };
}

export const orderPlacedEvent = parseAbiItem(
  "event OrderPlaced(bytes32 indexed id, uint64 indexed batchId, uint256 index, address indexed owner, bool zeroForOne, uint256 limit, uint256 budget)",
);
export const batchSettledEvent = parseAbiItem(
  "event BatchSettled(bytes32 indexed id, uint64 indexed batchId, bool buyersDominant, uint256 pFinal, uint256 steps, uint256 minoritySupply, uint256 poolIn, uint256 poolOut, uint256 engineBought, address settler)",
);
export const batchCancelledEvent = parseAbiItem("event BatchCancelled(bytes32 indexed id, uint64 indexed batchId, address caller, bool overDepth)");
/** First deployment emitted BatchCancelled without the overDepth flag. */
export const batchCancelledLegacyEvent = parseAbiItem("event BatchCancelled(bytes32 indexed id, uint64 indexed batchId, address caller)");

export interface MyOrder {
  batchId: bigint;
  index: bigint;
  zeroForOne: boolean;
  limit: bigint;
  budget: bigint;
  refund: bigint;
  proceeds: bigint;
  claimed: boolean;
  status: number; // batch status: 1 open, 2 settled, 3 cancelled
}

/** Orders placed by `owner` in this pool across all batches, with claimable amounts. */
export function useMyOrders(m: MarketInfo | undefined, owner: Address | undefined, blockNumber: bigint | undefined) {
  return useQuery({
    queryKey: ["myOrders", m?.id, owner, blockNumber?.toString()],
    enabled: !!m && !!owner,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<MyOrder[]> => {
      const logs = await publicClient.getLogs({
        address: deployments.hook,
        event: orderPlacedEvent,
        args: { id: m!.id, owner },
        fromBlock: m!.initBlock || BigInt(deployments.deployBlock),
        toBlock: "latest",
      });
      const batchIds = [...new Set(logs.map((l) => l.args.batchId!))];
      const batches = new Map<bigint, { status: number }>();
      await Promise.all(
        batchIds.map(async (b) => {
          const r = await publicClient.readContract({ address: deployments.hook, abi: hookAbi, functionName: "getBatch", args: [m!.key, b] });
          batches.set(b, { status: Number(r.status) });
        }),
      );
      const rows = await Promise.all(
        logs.map(async (l): Promise<MyOrder> => {
          const batchId = l.args.batchId!;
          const index = l.args.index!;
          const st = batches.get(batchId)!.status;
          let refund = 0n;
          let proceeds = 0n;
          let claimed = false;
          if (st === 2 || st === 3) {
            const [orders, cl] = await Promise.all([
              publicClient.readContract({ address: deployments.hook, abi: hookAbi, functionName: "getOrders", args: [m!.key, batchId] }),
              publicClient.readContract({ address: deployments.hook, abi: hookAbi, functionName: "claimable", args: [m!.key, batchId, index] }),
            ]);
            claimed = orders[Number(index)].claimed;
            [refund, proceeds] = cl as readonly [bigint, bigint];
          }
          return { batchId, index, zeroForOne: l.args.zeroForOne!, limit: l.args.limit!, budget: l.args.budget!, refund, proceeds, claimed, status: st };
        }),
      );
      return rows.sort((a, b) => (a.batchId === b.batchId ? Number(b.index - a.index) : Number(b.batchId - a.batchId)));
    },
  });
}

export interface Settlement {
  batchId: bigint;
  buyersDominant: boolean;
  pFinal: bigint;
  steps: bigint;
  minoritySupply: bigint;
  poolIn: bigint;
  poolOut: bigint;
  engineBought: bigint;
  settler: Address;
  blockNumber: bigint;
  txHash: Hex;
}

export function useLastSettlement(m: MarketInfo | undefined, nextToSettle: bigint | undefined) {
  return useQuery({
    queryKey: ["lastSettlement", m?.id, nextToSettle?.toString()],
    enabled: !!m,
    meta: { static: true },
    staleTime: Infinity,
    queryFn: async (): Promise<Settlement | null> => {
      const logs = await publicClient.getLogs({
        address: deployments.hook,
        event: batchSettledEvent,
        args: { id: m!.id },
        fromBlock: m!.initBlock || BigInt(deployments.deployBlock),
        toBlock: "latest",
      });
      const l = logs[logs.length - 1];
      if (!l) return null;
      const a = l.args;
      return {
        batchId: a.batchId!,
        buyersDominant: a.buyersDominant!,
        pFinal: a.pFinal!,
        steps: a.steps!,
        minoritySupply: a.minoritySupply!,
        poolIn: a.poolIn!,
        poolOut: a.poolOut!,
        engineBought: a.engineBought!,
        settler: a.settler!,
        blockNumber: l.blockNumber!,
        txHash: l.transactionHash!,
      };
    },
  });
}

export { erc20Abi, hookAbi, launchAbi };

export interface Cancellation {
  batchId: bigint;
  overDepth: boolean;
  caller: Address;
  blockNumber: bigint;
}

/** Most recent BatchCancelled for this pool (both event versions), or null. */
export function useLastCancellation(m: MarketInfo | undefined, next: bigint | undefined) {
  return useQuery({
    queryKey: ["lastCancellation", m?.id, next?.toString()],
    enabled: !!m,
    meta: { static: true },
    staleTime: Infinity,
    queryFn: async (): Promise<Cancellation | null> => {
      const range = { address: deployments.hook, args: { id: m!.id }, fromBlock: m!.initBlock || BigInt(deployments.deployBlock), toBlock: "latest" as const };
      const [a, b] = await Promise.all([
        publicClient.getLogs({ ...range, event: batchCancelledEvent }),
        publicClient.getLogs({ ...range, event: batchCancelledLegacyEvent }),
      ]);
      const all: Cancellation[] = [
        ...a.map((l) => ({ batchId: l.args.batchId!, overDepth: !!l.args.overDepth, caller: l.args.caller!, blockNumber: l.blockNumber! })),
        ...b.map((l) => ({ batchId: l.args.batchId!, overDepth: false, caller: l.args.caller!, blockNumber: l.blockNumber! })),
      ];
      all.sort((x, y) => Number(x.batchId - y.batchId));
      return all[all.length - 1] ?? null;
    },
  });
}
