/**
 * Demo activity on Sepolia: real orders and bids from the funded seed wallets, so the dashboard
 * shows live demand, settlements and fills. Nothing here is privileged or faked; every action is
 * a normal transaction any wallet could send.
 *
 *   --launches         place a spread of bids on every open, plain-USDC launch (once)
 *   --markets          keep an open batch on every Clinch pool: add buy and sell orders near spot
 *                      each window, then settle the closed batch and claim it for everyone
 *   --minutes N        how long --markets runs (default 30; 0 = until stopped)
 *
 *   cd app && set -a && . ../contracts/.env && set +a && npm run demo:activity -- --launches --markets
 *
 * Env: SEED_KEYS (comma-separated test keys), DEMO_PK (the wallet you present with; defaults to
 * PRIVATE_KEY), SEPOLIA_RPC_URL or RPC_URL, VITE_DEPLOYMENTS. The demo wallet is topped up from the
 * public faucets and takes part in every batch and launch, so its own orders show in the app.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  maxUint256,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { erc20Abi, factoryAbi, hookAbi, launchAbi } from "../src/abi/index.ts";
import { parseDeployments } from "../src/config/deployments.ts";

const args = process.argv.slice(2);
const DO_LAUNCHES = args.includes("--launches");
const DO_MARKETS = args.includes("--markets") || !DO_LAUNCHES;
const MINUTES = Number(args[args.indexOf("--minutes") + 1] ?? NaN);
const RUN_MS = (Number.isFinite(MINUTES) ? MINUTES : 30) * 60_000;

const RPC = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const READ_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const d = parseDeployments(JSON.parse(readFileSync(resolve(process.cwd(), process.env.VITE_DEPLOYMENTS || "src/deployments.sepolia.json"), "utf8")));
const keys = (process.env.SEED_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean) as Hex[];
if (keys.length < 3) {
  console.error("Set SEED_KEYS (at least 3 funded Sepolia test keys).");
  process.exit(1);
}
const DEMO_PK = (process.env.DEMO_PK || process.env.PRIVATE_KEY || "") as Hex;
const demo = DEMO_PK ? privateKeyToAccount(DEMO_PK) : undefined;
const seeds = keys.map((k) => privateKeyToAccount(k)).filter((a) => a.address !== demo?.address);
/** demo wallet first: it is in every batch and bids on every launch */
const wallets = demo ? [demo, ...seeds] : seeds;
const pub = createPublicClient({ chain: sepolia, transport: http(READ_RPC, { retryCount: 4 }) });
const clients = new Map(wallets.map((a) => [a.address, createWalletClient({ account: a, chain: sepolia, transport: http(RPC, { retryCount: 3 }) })]));

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function reason(e: unknown) {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? "revert";
    return e.shortMessage;
  }
  return String(e);
}

/** Simulate, send, wait. One wallet sends one transaction at a time (callers await). */
async function send(acct: PrivateKeyAccount, what: string, req: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) {
  try {
    const { request } = await pub.simulateContract({ ...req, account: acct } as never);
    const hash = await clients.get(acct.address)!.writeContract(request as never);
    const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
    log(`${rc.status === "success" ? "ok " : "REV"} ${what} (${short(acct.address)}, gas ${rc.gasUsed})`);
    return rc.status === "success";
  } catch (e) {
    log(`skip ${what}: ${reason(e)}`);
    return false;
  }
}

const approved = new Set<string>();
async function ensureApproval(acct: PrivateKeyAccount, token: Address, spender: Address, need: bigint) {
  const k = `${acct.address}-${token}-${spender}`;
  if (approved.has(k)) return;
  const cur = await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [acct.address, spender] });
  if (cur < need) await send(acct, `approve ${short(token)}`, { address: token, abi: erc20Abi, functionName: "approve", args: [spender, maxUint256] });
  approved.add(k);
}

const balanceOf = (token: Address, who: Address) => pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

/* ------------------------------------------------------------------ launches */

async function bidOnLaunches() {
  const launches = await pub.readContract({ address: d.factory, abi: factoryAbi, functionName: "allLaunches" });
  for (const l of launches) {
    const [status, p, n] = await Promise.all([
      pub.readContract({ address: l, abi: launchAbi, functionName: "status" }),
      pub.readContract({ address: l, abi: launchAbi, functionName: "params" }),
      pub.readContract({ address: l, abi: launchAbi, functionName: "bidCount" }),
    ]);
    const now = Math.floor(Date.now() / 1000);
    // plain USDC launches that are open and still quiet; the human-capped ones need World ID
    if (status !== 1 || p.quoteToken.toLowerCase() !== d.usdc!.toLowerCase() || Number(p.endTime) < now + 300 || n >= 4n) continue;
    const toPlace = Math.min(Number(p.maxBids) - Number(n), 4 + Math.floor(Math.random() * 4));
    log(`launch ${short(l)}: placing ${toPlace} bids`);
    const reserve = Number(p.reservePrice) / 1e6; // USDC per token (6 vs 18 decimals, WAD)
    const ceil = Number(p.maxPrice) / 1e6;
    await Promise.all(
      wallets.slice(0, toPlace).map(async (acct) => {
        // limits spread log-uniformly between reserve and about 60% of the ceiling; budgets 300 to 12,000 USDC
        const limit = Math.exp(rand(Math.log(reserve * 1.2), Math.log(ceil * 0.6)));
        const budget = BigInt(Math.round(rand(300, 12_000))) * 1_000_000n;
        if ((await balanceOf(d.usdc!, acct.address)) < budget) return;
        await ensureApproval(acct, d.usdc!, l, budget);
        await send(acct, `bid ${short(l)} $${limit.toFixed(3)} x ${budget / 1_000_000n} USDC`, {
          address: l,
          abi: launchAbi,
          functionName: "bid",
          args: [BigInt(Math.round(limit * 1e6)), budget],
        });
      }),
    );
  }
}

/* ------------------------------------------------------------------ markets */

type Key = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

async function poolKeys(): Promise<{ name: string; key: Key; dec0: number; dec1: number }[]> {
  const out = [];
  if (d.swapCurrency0 && d.swapCurrency1) {
    out.push({ name: "WETH/USDC", key: { currency0: d.swapCurrency0, currency1: d.swapCurrency1, fee: 0, tickSpacing: d.swapTickSpacing ?? 60, hooks: d.hook }, dec0: 18, dec1: 6 });
  }
  if (d.launch) {
    const k = (await pub.readContract({ address: d.launch, abi: launchAbi, functionName: "poolKey" })) as Key;
    out.push({ name: "CLNCH/USDC", key: k, dec0: 18, dec1: 6 });
  }
  return out;
}

async function tickPool(pool: { name: string; key: Key; dec0: number; dec1: number }, block: bigint) {
  const { key, name } = pool;
  const st = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "poolState", args: [key] });

  // 1) settle and claim the oldest closed batch, from a wallet that is not necessarily in it
  if (st.nextToSettle <= st.currentBatch && st.nextToSettle > 0n) {
    const b = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "getBatch", args: [key, st.nextToSettle] });
    if (b.status === 1 && block >= b.endBlock) {
      const settler = pick(wallets);
      const id = st.nextToSettle;
      if (await send(settler, `settle ${name} batch #${id} (${b.nOrders} orders)`, { address: d.hook, abi: hookAbi, functionName: "settle", args: [key] })) {
        const idx = Array.from({ length: b.nOrders }, (_, i) => BigInt(i));
        if (idx.length) await send(settler, `claim ${name} batch #${id} for everyone`, { address: d.hook, abi: hookAbi, functionName: "claimMany", args: [key, id, idx] });
      }
      return;
    }
  }

  // 2) keep the current batch busy: 2 to 5 orders on both sides, near spot
  const cur = st.currentBatch > 0n ? await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "getBatch", args: [key, st.currentBatch] }) : undefined;
  const open = cur && cur.status === 1 && block + 2n < cur.endBlock;
  const have = open ? cur!.nOrders : 0;
  const target = 2 + Math.floor(Math.random() * 4);
  if (have >= target) return;

  const spot = await pub.readContract({ address: d.hook, abi: hookAbi, functionName: "spotPrice", args: [key] }); // token1 raw per token0 raw, WAD
  const spotHuman = (Number(spot) / 1e18) * 10 ** (pool.dec0 - pool.dec1);
  const n = Math.min(target - have, 3);
  // the demo wallet always takes part; the rest are shuffled
  const rest = (demo ? seeds : wallets).slice().sort(() => Math.random() - 0.5);
  const shuffled = demo && have === 0 ? [demo, ...rest] : rest;
  await Promise.all(
    shuffled.slice(0, n).map(async (acct, i) => {
      const buy = i === 0 ? true : i === 1 ? false : Math.random() < 0.55;
      const edge = rand(0.003, 0.03);
      if (buy) {
        // spend USDC (token1): 50 to 400 on CLNCH, 150 to 3,000 on WETH
        const usd = name.startsWith("WETH") ? rand(150, 3000) : rand(50, 400);
        const budget = BigInt(Math.round(usd * 1e6));
        if ((await balanceOf(key.currency1, acct.address)) < budget) return;
        await ensureApproval(acct, key.currency1, d.hook, budget);
        const limit = (spot * BigInt(Math.round((1 + edge) * 1e6))) / 1_000_000n;
        await send(acct, `${name} buy ${usd.toFixed(0)} USDC, max ${(spotHuman * (1 + edge)).toPrecision(6)}`, {
          address: d.hook,
          abi: hookAbi,
          functionName: "placeOrder",
          args: [key, false, limit, budget],
        });
      } else {
        // sell token0 worth 50 to 2,500 USDC
        const usd = name.startsWith("WETH") ? rand(150, 2500) : rand(50, 350);
        const amt = BigInt(Math.round((usd / spotHuman) * 1e6)) * 10n ** BigInt(pool.dec0 - 6);
        if ((await balanceOf(key.currency0, acct.address)) < amt) return;
        await ensureApproval(acct, key.currency0, d.hook, amt);
        const limit = (spot * BigInt(Math.round((1 - edge) * 1e6))) / 1_000_000n;
        await send(acct, `${name} sell ~${usd.toFixed(0)} USDC worth, min ${(spotHuman * (1 - edge)).toPrecision(6)}`, {
          address: d.hook,
          abi: hookAbi,
          functionName: "placeOrder",
          args: [key, true, limit, amt],
        });
      }
    }),
  );
}

async function runMarkets() {
  const pools = await poolKeys();
  const until = RUN_MS > 0 ? Date.now() + RUN_MS : Infinity;
  log(`markets: ${pools.map((p) => p.name).join(", ")}; running ${RUN_MS > 0 ? `${RUN_MS / 60_000} min` : "until stopped"}`);
  while (Date.now() < until) {
    try {
      const block = await pub.getBlockNumber();
      // pools in sequence so one wallet never has two transactions in flight
      for (const p of pools) await tickPool(p, block);
    } catch (e) {
      log(`tick failed: ${reason(e)}`);
    }
    await sleep(10_000);
  }
}

const faucetAbi = [{ type: "function", name: "faucet", inputs: [], outputs: [], stateMutability: "nonpayable" }] as const;

/** Top the demo wallet up from the public demo-token faucets. */
async function topUpDemo() {
  if (!demo) return;
  const want: [Address | undefined, bigint, number][] = [
    [d.usdc, 20_000n * 1_000_000n, 2],
    [d.weth, 10n * 10n ** 18n, 1],
  ];
  for (const [token, min, times] of want) {
    if (!token) continue;
    if ((await balanceOf(token, demo.address)) >= min) continue;
    for (let i = 0; i < times; i++) await send(demo, `faucet ${short(token)} for demo wallet`, { address: token, abi: faucetAbi, functionName: "faucet", args: [] });
  }
}

async function main() {
  log(`${wallets.length} wallets${demo ? ` (demo ${short(demo.address)})` : ""}, hook ${short(d.hook)}, factory ${short(d.factory)}`);
  await topUpDemo();
  if (DO_LAUNCHES) await bidOnLaunches();
  if (DO_MARKETS) await runMarkets();
  log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
