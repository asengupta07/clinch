/**
 * End-to-end exercise of every write path, using the app's own helpers: faucet, launch bid (with
 * decoded reverts), batch orders (marketability and depth checks), keeper settlement, claims that
 * must equal claimable(), launch settlement + ladder verification, launch claim, issuer withdraw,
 * and an order on the launch-seeded pool.
 *
 * It SETTLES the seeded launch and batches, so it refuses to run against the shared demo chain.
 * Use a private anvil with a short launch:
 *   anvil --port 8546 --block-time 1
 *   (cd ../contracts && LAUNCH_SECONDS=150 forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8546 --broadcast \
 *      && forge script script/SeedDemo.s.sol --rpc-url http://127.0.0.1:8546 --broadcast)   # writes contracts/deployments/local.json
 *   RPC_URL=http://127.0.0.1:8546 E2E_DEPLOYMENTS=<copy of that json> npx tsx scripts/e2e-private.ts
 */
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbiItem, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { erc20Abi, factoryAbi, hookAbi, launchAbi } from "../src/abi/index.ts";
import { parseDeployments } from "../src/config/deployments.ts";
import { HOOK_MAX_STEPS, twoSided, mulDiv } from "../src/engine/wad.ts";
import { humanError } from "../src/lib/errors.ts";
import { runLaunch, verifyOutcome } from "../src/lib/launch.ts";
import { humanToRawPrice, orderParams, parseDecimal } from "../src/lib/units.ts";

const RPC = process.env.RPC_URL ?? "";
if (!RPC || RPC.includes(":8545")) {
  console.error("Refusing: set RPC_URL to a PRIVATE chain (not the shared demo chain on 8545). This script settles everything.");
  process.exit(1);
}
const d = parseDeployments(JSON.parse(readFileSync(process.env.E2E_DEPLOYMENTS ?? "", "utf8")));
const pub = createPublicClient({ chain: foundry, transport: http(RPC), pollingInterval: 300 });
const PK7 = "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356" as Hex;
const PK0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const a7 = privateKeyToAccount(PK7);
const a0 = privateKeyToAccount(PK0);
const ok = (c: boolean, m: string) => {
  if (!c) throw new Error("FAIL: " + m);
  console.log("  ok:", m);
};

async function send(pk: Hex, address: Address, abi: any, functionName: string, args: any[]) {
  const account = privateKeyToAccount(pk);
  const sim = await pub.simulateContract({ account: account.address, address, abi, functionName, args } as any);
  const w = createWalletClient({ account, chain: foundry, transport: http(RPC) });
  const { account: _x, ...req } = (sim as any).request;
  const hash = await w.writeContract({ ...req, account, chain: foundry });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("reverted " + functionName);
  return { rc, result: (sim as any).result };
}
async function expectRevert(pk: Hex, address: Address, abi: any, fn: string, args: any[], want: RegExp) {
  try {
    await pub.simulateContract({ account: privateKeyToAccount(pk).address, address, abi, functionName: fn, args } as any);
    throw new Error(`expected ${fn} to revert`);
  } catch (e) {
    const msg = humanError(e);
    ok(want.test(msg), `${fn} reverts with decoded message: "${msg}"`);
  }
}
const bal = (t: Address, o: Address) => pub.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [o] });

const key = { currency0: d.swapCurrency0!, currency1: d.swapCurrency1!, fee: 0, tickSpacing: d.swapTickSpacing!, hooks: d.hook };
const m = { baseDecimals: 18, quoteDecimals: 6, baseIsToken0: key.currency0 === d.weth };
console.log("WETH is token0:", m.baseIsToken0);

console.log("1. faucets for fresh wallet #7");
await send(PK7, d.usdc!, erc20Abi, "faucet", []);
await send(PK7, d.weth!, erc20Abi, "faucet", []);
ok((await bal(d.usdc!, a7.address)) === 50_000_000_000n, "USDC faucet 50,000");
ok((await bal(d.weth!, a7.address)) === 20n * 10n ** 18n, "WETH faucet 20");

console.log("2. launch bid");
const L = d.launch!;
const p = await pub.readContract({ address: L, abi: launchAbi, functionName: "params" });
const now = (await pub.getBlock()).timestamp;
console.log("  seconds left:", Number(p.endTime - now), "eps", p.eps);
await send(PK7, d.usdc!, erc20Abi, "approve", [L, 5_000_000_000n]);
await expectRevert(PK7, L, launchAbi, "bid", [humanToRawPrice("0.05", 18, 6)!, 5_000_000_000n], /reserve price/);
await expectRevert(PK7, L, launchAbi, "bid", [humanToRawPrice("0.5", 18, 6)!, 1_000_000n], /minimum bid/);
const limit = humanToRawPrice("0.50", 18, 6)!;
const budget = parseDecimal("5000", 6)!;
ok(limit === 500_000n, "0.50 USDC per CLNCH -> raw 500000");
const before = await pub.readContract({ address: L, abi: launchAbi, functionName: "getBids" });
const est = runLaunch(p, [...before, { limit, budget }]);
await send(PK7, L, launchAbi, "bid", [limit, budget]);
const pv = await pub.readContract({ address: L, abi: launchAbi, functionName: "previewSettle" });
const idx = before.length;
ok(pv.qty[idx] === est.qty[idx] && pv.paid[idx] === est.paid[idx], `"what would I get" estimate equals chain preview (qty ${est.qty[idx]}, paid ${est.paid[idx]})`);

console.log("3. batch orders on WETH/USDC");
await send(PK7, d.usdc!, erc20Abi, "approve", [d.hook, 2n ** 255n]);
await send(PK7, d.weth!, erc20Abi, "approve", [d.hook, 2n ** 255n]);
const [r0, r1] = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "reserves", args: [key] });
const bad = orderParams("buy", "2900", m)!;
await expectRevert(PK7, d.hook, hookAbi, "placeOrder", [key, bad.zeroForOne, bad.limit, 1_000_000_000n], /worse than the current price/);
const huge = orderParams("buy", "3100", m)!;
await send(PK7, d.usdc!, erc20Abi, "mint", [a7.address, 200_000_000_000n]);
const cap = (r1 * 500n) / 10_000n; // 5% of the USDC reserve (WETH is token0)
await expectRevert(PK7, d.hook, hookAbi, "placeOrder", [key, huge.zeroForOne, huge.limit, cap + 1_000_000n], /batch is full/);
const buy = orderParams("buy", "3050", m)!;
const sell = orderParams("sell", "2980", m)!;
const st0 = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "poolState", args: [key] });
const { result: rb } = await send(PK7, d.hook, hookAbi, "placeOrder", [key, buy.zeroForOne, buy.limit, 6_000_000_000n]);
const { result: rs } = await send(PK7, d.hook, hookAbi, "placeOrder", [key, sell.zeroForOne, sell.limit, 10n ** 18n]);
const batchId = rb[0] as bigint;
console.log("  orders in batch", batchId, "indices", rb[1], rs[1], "(nextToSettle", st0.nextToSettle, ")");
const orders = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "getOrders", args: [key, batchId] });
const hp = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "previewSettle", args: [key, batchId] });
const [r0b, r1b] = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "reserves", args: [key] });
const loc = twoSided(orders.map((o) => ({ ...o })), r0b, r1b, { eps: st0.cfg.eps, pMax: 0n, maxSteps: HOOK_MAX_STEPS });
ok(JSON.stringify(loc.received.map(String)) === JSON.stringify(hp.received.map(String)) && loc.poolIn === hp.poolIn, "order-form estimate engine equals hook previewSettle()");
void r0; void r1;

console.log("4. keeper settles batches (wait for windows)");
const keeper = async () => {
  const { execFileSync } = await import("node:child_process");
  return execFileSync("npx", ["tsx", "scripts/keeper.ts", "--once"], { env: { ...process.env, RPC_URL: RPC, VITE_DEPLOYMENTS: process.env.E2E_DEPLOYMENTS }, encoding: "utf8" });
};
for (let i = 0; i < 30; i++) {
  const st = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "poolState", args: [key] });
  if (st.nextToSettle > batchId) break;
  const out = await keeper();
  out.split("\n").filter((l) => /settle|cancel/.test(l)).forEach((l) => console.log("  keeper:", l));
  await new Promise((r) => setTimeout(r, 1000));
}
const b2 = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "getBatch", args: [key, batchId] });
ok(b2.status === 2, `batch ${batchId} settled by keeper`);
const settledLogs = await pub.getLogs({ address: d.hook, event: parseAbiItem("event BatchSettled(bytes32 indexed id, uint64 indexed batchId, bool buyersDominant, uint256 pFinal, uint256 steps, uint256 minoritySupply, uint256 poolIn, uint256 poolOut, uint256 engineBought, address settler)"), fromBlock: 0n });
const ev = settledLogs.find((l) => l.args.batchId === batchId)!.args;
console.log("  settled: buyersDominant", ev.buyersDominant, "rebate factor", Number(((ev.poolOut! + ev.minoritySupply!) * 10n ** 12n) / ev.engineBought!) / 1e12);

console.log("5. claims include rebate");
const ordersAfter = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "getOrders", args: [key, batchId] });
for (const ix of [rb[1] as bigint, rs[1] as bigint]) {
  const o = ordersAfter[Number(ix)];
  const [refund, proceeds] = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "claimable", args: [key, batchId, ix] });
  const isBuyer = !o.zeroForOne;
  const expected = isBuyer === b2.buyersDominant && b2.availDen > 0n ? mulDiv(o.received, b2.availNum, b2.availDen) : o.received;
  ok(proceeds === expected && refund === o.budget - o.spent, `order ${ix}: claimable (${refund}, ${proceeds}) = engine received x rebate`);
  const soldTok = o.zeroForOne ? key.currency0 : key.currency1;
  const boughtTok = o.zeroForOne ? key.currency1 : key.currency0;
  const [s0, b0] = [await bal(soldTok, a7.address), await bal(boughtTok, a7.address)];
  await send(PK7, d.hook, hookAbi, "claim", [key, batchId, ix]);
  ok((await bal(soldTok, a7.address)) - s0 === refund && (await bal(boughtTok, a7.address)) - b0 === proceeds, `order ${ix}: wallet received exactly the claimable amounts`);
}
await expectRevert(PK7, d.hook, hookAbi, "claim", [key, batchId, rb[1]], /already been claimed/);

console.log("6. launch: wait for end, keeper settles");
for (let i = 0; i < 200; i++) {
  const s = await pub.readContract({ address: L, abi: launchAbi, functionName: "status" });
  if (s === 2) break;
  const t = (await pub.getBlock()).timestamp;
  if (t + 1n >= p.endTime) {
    const out = await keeper();
    out.split("\n").filter((l) => /launch/.test(l)).forEach((l) => console.log("  keeper:", l));
  }
  await new Promise((r) => setTimeout(r, 1500));
}
const bids = await pub.readContract({ address: L, abi: launchAbi, functionName: "getBids" });
const [sold, proceeds, cp] = await Promise.all(["sold", "proceeds", "clearingPrice"].map((f) => pub.readContract({ address: L, abi: launchAbi, functionName: f as any })));
const v = verifyOutcome(runLaunch(p, bids), { qty: bids.map((b) => b.qty), paid: bids.map((b) => b.paid), X: sold as bigint, Y: proceeds as bigint, pFinal: cp as bigint }, p.supply);
ok(v.ok && v.details.length === 0, `ladder replay matches the settled launch exactly (price ${cp})`);
const mine = bids[idx];
const [c0, u0] = [await bal(d.clnch!, a7.address), await bal(d.usdc!, a7.address)];
await send(PK7, L, launchAbi, "claim", [BigInt(idx)]);
ok((await bal(d.clnch!, a7.address)) - c0 === mine.qty && (await bal(d.usdc!, a7.address)) - u0 === mine.budget - mine.paid, `launch claim paid ${mine.qty} CLNCH and refunded ${mine.budget - mine.paid} USDC`);
await expectRevert(PK7, L, launchAbi, "issuerWithdraw", [], /Only the issuer/);
const [iq, is] = [await pub.readContract({ address: L, abi: launchAbi, functionName: "issuerQuote" }), await pub.readContract({ address: L, abi: launchAbi, functionName: "issuerSale" })];
const q0 = await bal(d.usdc!, a0.address);
await send(PK0, L, launchAbi, "issuerWithdraw", []);
ok((await bal(d.usdc!, a0.address)) - q0 === iq, `issuer withdrew ${iq} USDC and ${is} CLNCH`);

console.log("7. seeded launch pool is tradable");
const lkey = await pub.readContract({ address: L, abi: launchAbi, functionName: "poolKey" });
const lst = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "poolState", args: [lkey] });
ok(lst.initialized, "launch pool initialized on the hook");
const [lr0, lr1] = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "reserves", args: [lkey] });
const lm = { baseDecimals: 18, quoteDecimals: 6, baseIsToken0: lkey.currency0 === d.clnch };
const spot = Number(lr1) / Number(lr0) * (lm.baseIsToken0 ? 1e12 : 1);
console.log("  CLNCH spot ~", lm.baseIsToken0 ? spot : 1 / (Number(lr1) / Number(lr0)) * 1e-12, "launch clearing", Number(cp) / 1e6 * 1e12 / 1e18);
const lb = orderParams("buy", "1.00", lm)!;
await send(PK7, d.usdc!, erc20Abi, "approve", [d.hook, 2n ** 255n]);
await send(PK7, d.hook, hookAbi, "placeOrder", [lkey, lb.zeroForOne, lb.limit, 100_000_000n]);
ok(true, "placed a buy order on the CLNCH/USDC pool");
console.log("\nALL E2E CHECKS PASSED");
console.log("factory launches", await pub.readContract({ address: d.factory, abi: factoryAbi, functionName: "allLaunches" }));
