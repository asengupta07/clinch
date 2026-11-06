/**
 * Live-chain checks: the TS engines against the deployed contracts' previewSettle().
 * Skipped automatically when no RPC is reachable. RPC_URL defaults to the local anvil.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, parseAbiItem } from "viem";
import { describe, expect, it } from "vitest";
import { factoryAbi, hookAbi, launchAbi } from "../src/abi";
import { parseDeployments } from "../src/config/deployments";
import { HOOK_MAX_STEPS, twoSided } from "../src/engine/wad";
import { runLaunch, verifyOutcome } from "../src/lib/launch";

const RPC = process.env.RPC_URL || "http://127.0.0.1:8545";
const d = parseDeployments(JSON.parse(readFileSync(resolve(__dirname, "..", process.env.VITE_DEPLOYMENTS || "src/deployments.local.json"), "utf8")));
const pub = createPublicClient({ transport: http(RPC, { retryCount: 0, timeout: 3000 }) });

let up = false;
try {
  up = (await pub.getChainId()) === d.chainId && (await pub.getCode({ address: d.factory })) !== undefined;
} catch {
  up = false;
}

describe.skipIf(!up)(`live chain at ${RPC}`, () => {
  it("every launch: TS engine reproduces previewSettle() (clearing price within 0.5%, in fact exact)", async () => {
    const launches = await pub.readContract({ address: d.factory, abi: factoryAbi, functionName: "allLaunches" });
    expect(launches.length).toBeGreaterThan(0);
    for (const l of launches) {
      const [p, bids, status] = await Promise.all([
        pub.readContract({ address: l, abi: launchAbi, functionName: "params" }),
        pub.readContract({ address: l, abi: launchAbi, functionName: "getBids" }),
        pub.readContract({ address: l, abi: launchAbi, functionName: "status" }),
      ]);
      const local = runLaunch(p, bids);
      if (status === 2) {
        // settled: compare with what settle() stored
        const [sold, proceeds, clearingPrice] = await Promise.all([
          pub.readContract({ address: l, abi: launchAbi, functionName: "sold" }),
          pub.readContract({ address: l, abi: launchAbi, functionName: "proceeds" }),
          pub.readContract({ address: l, abi: launchAbi, functionName: "clearingPrice" }),
        ]);
        const v = verifyOutcome(local, { qty: bids.map((b) => b.qty), paid: bids.map((b) => b.paid), X: sold, Y: proceeds, pFinal: clearingPrice }, p.supply);
        expect(v.details).toEqual([]);
        expect(v.ok).toBe(true);
        continue;
      }
      if (bids.length === 0) continue;
      const chain = await pub.readContract({ address: l, abi: launchAbi, functionName: "previewSettle" });
      const rel = Math.abs(Number(local.pFinal - chain.pFinal)) / Number(chain.pFinal);
      expect(rel).toBeLessThan(0.005);
      expect(local.pFinal).toBe(chain.pFinal);
      expect(local.qty).toEqual([...chain.qty]);
      expect(local.paid).toEqual([...chain.paid]);
      expect(local.X).toBe(chain.X);
      expect(local.Y).toBe(chain.Y);
      expect(BigInt(local.steps)).toBe(chain.steps);
    }
  });

  it("every pool batch with orders: TS twoSided() reproduces the hook's previewSettle()", async () => {
    const ev = parseAbiItem(
      "event PoolInitialized(bytes32 indexed id, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96, (uint32 windowBlocks, uint32 rescueBlocks, uint16 maxOrders, uint16 maxDepthBps, uint64 eps, uint128 minOrder0, uint128 minOrder1) cfg)",
    );
    const logs = await pub.getLogs({ address: d.hook, event: ev, fromBlock: BigInt(d.deployBlock), toBlock: "latest" });
    expect(logs.length).toBeGreaterThan(0);
    let compared = 0;
    for (const lg of logs) {
      const key = lg.args.key!;
      const st = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "poolState", args: [key] });
      const [r0, r1] = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "reserves", args: [key] });
      for (let b = st.nextToSettle; b <= st.currentBatch; b++) {
        const orders = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "getOrders", args: [key, b] });
        if (orders.length === 0) continue;
        const chain = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "previewSettle", args: [key, b] });
        const local = twoSided(orders.map((o) => ({ zeroForOne: o.zeroForOne, limit: o.limit, budget: o.budget })), r0, r1, { eps: st.cfg.eps, pMax: 0n, maxSteps: HOOK_MAX_STEPS });
        expect(local.buyersDominant).toBe(chain.buyersDominant);
        expect(local.received).toEqual([...chain.received]);
        expect(local.spent).toEqual([...chain.spent]);
        expect(local.dominantBought).toBe(chain.dominantBought);
        expect(local.minoritySupply).toBe(chain.minoritySupply);
        expect(local.poolIn).toBe(chain.poolIn);
        expect(local.pFinal).toBe(chain.pFinal);
        expect(BigInt(local.steps)).toBe(chain.steps);
        compared++;
      }
    }
    console.log(`compared ${compared} unsettled batch(es)`);
  });
});
