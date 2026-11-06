/**
 * Clinch keeper. Every block it:
 *   - settles the oldest unsettled batch of every Clinch pool once its window has closed
 *     (the WETH/USDC pool and every pool seeded by a launch: all PoolInitialized events),
 *   - settles every launch whose bidding has ended,
 *   - falls back to the permissionless rescue (cancelStuck / cancel) only when settling is
 *     impossible and the rescue delay has passed.
 *
 * Nothing here is privileged: every call is one any wallet can make. If the keeper dies,
 * anyone settles from the app or a block explorer.
 *
 *   npx tsx scripts/keeper.ts            # run (anvil key #9 by default)
 *   npx tsx scripts/keeper.ts --dry      # log what it would do, send nothing
 *   add --once to check a single block and exit
 *
 * Env: RPC_URL (or VITE_RPC_URL), KEEPER_PK, VITE_DEPLOYMENTS (path to the deployments JSON).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { factoryAbi, hookAbi, launchAbi } from "../src/abi/index.ts";
import { parseDeployments } from "../src/config/deployments.ts";

const DRY = process.argv.includes("--dry");
const RPC_URL = process.env.RPC_URL || process.env.VITE_RPC_URL || "http://127.0.0.1:8545";
// anvil dev account #9: a public test key, only meaningful on a local chain
const DEFAULT_PK = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6";
const PK = (process.env.KEEPER_PK || DEFAULT_PK) as Hex;
const DEPLOYMENTS = resolve(process.cwd(), process.env.VITE_DEPLOYMENTS || "src/deployments.local.json");

const d = parseDeployments(JSON.parse(readFileSync(DEPLOYMENTS, "utf8")));
const account = privateKeyToAccount(PK);
const transport = http(RPC_URL);
const pub = createPublicClient({ transport, pollingInterval: 1000 });

const poolInitialized = parseAbiItem(
  "event PoolInitialized(bytes32 indexed id, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96, (uint32 windowBlocks, uint32 rescueBlocks, uint16 maxOrders, uint16 maxDepthBps, uint64 eps, uint128 minOrder0, uint128 minOrder1) cfg)",
);

type Key = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const errName = (e: unknown) => {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? "revert";
    return e.shortMessage;
  }
  return String(e);
};

const inflight = new Set<string>();
const symbols = new Map<Address, string>();

async function symbol(a: Address) {
  if (!symbols.has(a)) {
    try {
      symbols.set(a, await pub.readContract({ address: a, abi: [parseAbiItem("function symbol() view returns (string)")], functionName: "symbol" }));
    } catch {
      symbols.set(a, a.slice(0, 8));
    }
  }
  return symbols.get(a)!;
}

async function main() {
  const chainId = await pub.getChainId();
  const chain = defineChain({ id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } });
  const wallet = createWalletClient({ account, chain, transport });
  if (!DRY && PK === DEFAULT_PK && chainId !== 31337) {
    console.error("Refusing to use the public anvil key on a non-local chain. Set KEEPER_PK.");
    process.exit(1);
  }
  log(`keeper ${DRY ? "(dry run) " : ""}on chain ${chainId} via ${RPC_URL}`);
  log(`keeper address ${account.address}; hook ${d.hook}; factory ${d.factory}`);

  /** simulate, then (unless dry) send and wait. `id` de-duplicates across blocks. */
  async function act(id: string, what: string, req: Parameters<typeof pub.simulateContract>[0]): Promise<"sent" | "dry" | "reverted" | "busy"> {
    if (inflight.has(id)) return "busy";
    try {
      const sim = await pub.simulateContract({ ...req, account: account.address } as never);
      if (DRY) {
        log(`[dry] would ${what}`);
        return "dry";
      }
      inflight.add(id);
      const { account: _a, ...request } = (sim as { request: Record<string, unknown> }).request;
      void _a;
      const hash = await wallet.writeContract({ ...(request as object), account, chain } as never);
      log(`${what}: sent ${hash}`);
      const rc = await pub.waitForTransactionReceipt({ hash });
      log(`${what}: ${rc.status} in block ${rc.blockNumber} (gas ${rc.gasUsed})`);
      return "sent";
    } catch (e) {
      log(`${what}: not possible (${errName(e)})`);
      return "reverted";
    } finally {
      inflight.delete(id);
    }
  }

  async function pools(): Promise<Key[]> {
    const logs = await pub.getLogs({ address: d.hook, event: poolInitialized, fromBlock: BigInt(d.deployBlock), toBlock: "latest" });
    return logs.map((l) => l.args.key as Key);
  }

  async function tickPools(block: bigint) {
    for (const key of await pools()) {
      const name = `${await symbol(key.currency0)}/${await symbol(key.currency1)}`;
      const st = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "poolState", args: [key] });
      if (st.nextToSettle > st.currentBatch) continue;
      const id = st.nextToSettle;
      const b = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "getBatch", args: [key, id] });
      if (b.status !== 1) continue;
      // the next block is the first one in which settle() can succeed once block.number >= endBlock
      if (block + 1n < b.endBlock) continue;
      const r = await act(`settle-${name}-${id}`, `settle ${name} batch #${id} (${b.nOrders} orders)`, {
        address: d.hook,
        abi: hookAbi,
        functionName: "settle",
        args: [key],
      });
      if (r === "reverted" && block + 1n >= b.endBlock + BigInt(st.cfg.rescueBlocks)) {
        await act(`cancel-${name}-${id}`, `cancel stuck ${name} batch #${id}`, { address: d.hook, abi: hookAbi, functionName: "cancelStuck", args: [key] });
      }
    }
  }

  async function tickLaunches(ts: bigint) {
    const launches = await pub.readContract({ address: d.factory, abi: factoryAbi, functionName: "allLaunches" });
    for (const l of launches) {
      const status = await pub.readContract({ address: l, abi: launchAbi, functionName: "status" });
      if (status !== 1) continue;
      const p = await pub.readContract({ address: l, abi: launchAbi, functionName: "params" });
      // next block's timestamp is strictly greater than the latest one
      if (ts + 1n < p.endTime) continue;
      const r = await act(`launch-${l}`, `settle launch ${l}`, { address: l, abi: launchAbi, functionName: "settle", args: [] });
      if (r === "reverted" && ts + 1n >= p.endTime + BigInt(p.rescueDelay)) {
        await act(`launch-cancel-${l}`, `cancel launch ${l}`, { address: l, abi: launchAbi, functionName: "cancel", args: [] });
      }
    }
  }

  let busy = false;
  let last = 0n;
  const onBlock = async (n: bigint) => {
    if (busy || n <= last) return;
    busy = true;
    last = n;
    try {
      const blk = await pub.getBlock({ blockNumber: n });
      await tickPools(n);
      await tickLaunches(blk.timestamp);
    } catch (e) {
      log(`block ${n}: ${errName(e)}`);
    } finally {
      busy = false;
    }
  };
  if (process.argv.includes("--once")) {
    await onBlock(await pub.getBlockNumber());
    process.exit(0);
  }
  pub.watchBlockNumber({ onBlockNumber: (n) => void onBlock(n), emitOnBegin: true, poll: true, pollingInterval: 1000 });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

