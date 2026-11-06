# Clinch

**Clinch your token.** Token launches and batch swaps where a thousand wallets never beat one.

Clinch is the first implementation of the sybil-proof adaptive clinching mechanism of Zhang, Li, Shi, Zhang, Xia and Han ([arXiv 2610.36629](https://arxiv.org/abs/2610.36629), Oct 2026). It ships in two forms:

- **ClinchLaunch:** a token sale that seeds a Uniswap v4 pool at the discovered price.
- **ClinchHook:** a Uniswap v4 hook that turns a pool into a two-sided batch auction.

In both, bidding your true value and budget is a dominant strategy, and splitting a budget across wallets never helps. There is no identity layer.

## Why

Every fair-launch design today picks two of three:

| | Honest bidding is best | Splitting wallets doesn't help | No KYC needed |
| --- | --- | --- | --- |
| Uniform price / CCA | ❌ a whale gains **+44%** by understating demand | ✅ | ✅ |
| Per-wallet caps | ❌ | ❌ whale utility **40 → 602** by splitting | ✅ |
| Caps + proof of human | ❌ | ✅ | ❌ |
| **Clinch** | ✅ | ✅ splitting **hurts** (680 → 270) | ✅ |

Numbers are from our simulations; see [research/FINDINGS.md](research/FINDINGS.md).

What we do **not** claim: that whales get less. They get what their budget buys, and in our simulations a whale can end up with *more* than under uniform price. The guarantee is about incentives: no strategy (splitting, lying about value, reordering) beats bidding the truth.

## How it works

1. **Escrow.** Every bid locks its full budget. This is the theorem's hypothesis: a reported budget is a deposited budget, so the budgets across any set of wallets add up to at most what their owner holds.
2. **Ascending price.** The price rises on a ladder from the reserve or spot price. At each price, a bidder *clinches* whatever supply the other bidders can no longer absorb, at that price. Bidders drop out exactly at their limit.
3. **AMM supply.** In the hook, supply comes from the pool's own constant-product curve through the paper's chord target. When both sides trade, the smaller side is filled at spot and folded into the larger side's cost curve (paper §5).
4. **One swap.** Settlement makes one residual exact-input swap inside `unlock`. Whatever the pool delivers beyond the engine's allocation, which is the discretization surplus, is rebated to buyers pro-rata.

Prices are non-uniform, because each bidder pays the price at which they clinched. That is a property of the mechanism, not a bug.

## Quick start (local)

Requirements: Foundry, Node 20+, `jq`, Python 3 (only needed for the differential tests).

```bash
git clone --recursive <this repo> && cd clinch
./scripts/demo.sh
```

This starts anvil (2-second blocks), deploys the PoolManager, hook (CREATE2-mined address), factory and demo tokens, seeds a live launch and an open WETH/USDC batch, and serves the app at http://localhost:5173. In the app, use **Demo wallets** to click through without MetaMask on the local chain. `cd app && npm run keeper` runs the optional settlement keeper.

To run the tests:

```bash
cd contracts && forge test                      # 84 tests
FOUNDRY_PROFILE=ci forge test                   # 2,000 fuzz runs per property
```

## Live on Sepolia

Deployed against Uniswap's official Sepolia v4 PoolManager. Hook, factory, demo tokens and the demo launch are verified on Etherscan.

### Core contracts

| Contract | Address |
| --- | --- |
| PoolManager (Uniswap v4, official) | [`0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`](https://sepolia.etherscan.io/address/0xE03A1074c86CFeDd5C142C4F04F1a1536e203543) |
| ClinchHook (flags `0x2880`) | [`0x3e755Ab2f2784b7B6e66B2Ac302a1Ab2a0a26880`](https://sepolia.etherscan.io/address/0x3e755Ab2f2784b7B6e66B2Ac302a1Ab2a0a26880#code) |
| ClinchLaunchFactory | [`0x065AeDe864D1Fd2a8c0044dD859e50eff1927694`](https://sepolia.etherscan.io/address/0x065AeDe864D1Fd2a8c0044dD859e50eff1927694#code) |
| Deployer / issuer | [`0xF23be0fbE9DEf26570278F91f3F150Af015a3ECf`](https://sepolia.etherscan.io/address/0xF23be0fbE9DEf26570278F91f3F150Af015a3ECf) |

### Demo tokens (public faucet, mock ERC-20s)

| Token | Address | Decimals |
| --- | --- | --- |
| Demo USD Coin (USDC) | [`0x6D20b101CF658d82A118861FAa9bFA52ce290697`](https://sepolia.etherscan.io/address/0x6D20b101CF658d82A118861FAa9bFA52ce290697#code) | 6 |
| Demo Wrapped Ether (WETH) | [`0x351d5515de46fF8D45C36c93df65Da6BB0dacD11`](https://sepolia.etherscan.io/address/0x351d5515de46fF8D45C36c93df65Da6BB0dacD11#code) | 18 |
| Clinch Demo Token (CLNCH) | [`0x57bb725F7D9Ed1D24dF4fc3c27De505D6065B023`](https://sepolia.etherscan.io/address/0x57bb725F7D9Ed1D24dF4fc3c27De505D6065B023#code) | 18 |

### Clinch pools (on the hook)

| Pool | Pool ID | Notes |
| --- | --- | --- |
| WETH/USDC | `0x191dcdad98a9512cfa30b53d9d025e9f8cddcd822483ceb1086a21bb35903dbe` | 5-block batches, fee 0, tick spacing 60; one batch of five orders settled (spot $3,000 to $3,048.92) |
| CLNCH/USDC | `0xee1b6b26384e9a7733ca4601ff7b912907aec407d26d17e36e10b9769e13ac2a` | Seeded by the demo launch at its $0.42 clearing price |

### Launches

| Launch | Sale token | Status |
| --- | --- | --- |
| [`0x399C300b8D7E18B5DEc2D7dA503c3EE0efE6e97c`](https://sepolia.etherscan.io/address/0x399C300b8D7E18B5DEc2D7dA503c3EE0efE6e97c#code) | CLNCH [`0x57bb725F7D9Ed1D24dF4fc3c27De505D6065B023`](https://sepolia.etherscan.io/address/0x57bb725F7D9Ed1D24dF4fc3c27De505D6065B023) | Settled: 1M CLNCH for 252,631.85 USDC at $0.42, six bidders |
| [`0xcBD1D9584C3cfFd6C85D7c442A2Cba15DE56776B`](https://sepolia.etherscan.io/address/0xcBD1D9584C3cfFd6C85D7c442A2Cba15DE56776B) | LIVE [`0x59dd3c61759890d993fdceb8dc3a644c0c837b60`](https://sepolia.etherscan.io/address/0x59dd3c61759890d993fdceb8dc3a644c0c837b60) | Open until 20 Nov 2026, 12:33 UTC |
| [`0x1beD0917943b2E9fCfFc233d899c3f07aC8E60eB`](https://sepolia.etherscan.io/address/0x1beD0917943b2E9fCfFc233d899c3f07aC8E60eB) | MNSN* [`0x428dc4c8a0361c76b613b39144670e5f0e7d4981`](https://sepolia.etherscan.io/address/0x428dc4c8a0361c76b613b39144670e5f0e7d4981) | Open until 20 Nov 2026 |
| [`0x012830eE801C818b5369AcFddb2af5d6f2EAC039`](https://sepolia.etherscan.io/address/0x012830eE801C818b5369AcFddb2af5d6f2EAC039) | CHAI* [`0xd839d5f9152958f085c0989f42d70987ca4b8206`](https://sepolia.etherscan.io/address/0xd839d5f9152958f085c0989f42d70987ca4b8206) | Open until 20 Nov 2026 |
| [`0x6661d548fa43B986C06266564cE496D35b3a194C`](https://sepolia.etherscan.io/address/0x6661d548fa43B986C06266564cE496D35b3a194C) | DABBA* [`0x3f888fa8ee1fbe9eee14ae28b913d828d02e5c4c`](https://sepolia.etherscan.io/address/0x3f888fa8ee1fbe9eee14ae28b913d828d02e5c4c) | Open until 20 Nov 2026 |
| [`0x7e971Db0B08531EFbc251003a4d78b04fda5Cb3b`](https://sepolia.etherscan.io/address/0x7e971Db0B08531EFbc251003a4d78b04fda5Cb3b) | LIVE [`0xa1af785811d741592cdc8250bdd4f9bd6ddc8cae`](https://sepolia.etherscan.io/address/0xa1af785811d741592cdc8250bdd4f9bd6ddc8cae) | Open until 20 Nov 2026, 12:42 UTC |

All open launches share one config: 500k tokens for sale plus 100k for the LP, 40% of proceeds to the pool, reserve $0.05, max $1.00, min bid 10 USDC, 40 bids max, 1-day rescue delay. Four of them are accidental duplicates from a retried deploy script; on chain they are all "Clinch Live Token" (LIVE). \*The app shows three of them under display names (Monsoon, Chai, Dabba) from `app/src/config/tokenLabels.ts`; anything created later shows its on-chain name.

Deploy block 12075934. The machine-readable copy is [`contracts/deployments/sepolia.json`](contracts/deployments/sepolia.json) (the app reads `app/src/deployments.sepolia.json`).

What is on chain: the demo launch settled with six bidders (ladder replay in the app matches `settle()` exactly), seeded the CLNCH/USDC Clinch pool at its $0.42 clearing price, a WETH/USDC batch of five orders cleared in one settlement, and claims were paid out on both.

Run the app against Sepolia (connect MetaMask on Sepolia, then use the **Faucet** buttons in the wallet menu for demo USDC and WETH):

```bash
cd app && npm install && npm run dev:sepolia
```

Settlement keeper (any funded Sepolia key; the public RPC is fine, and `LOG_RANGE=10` makes it work on Alchemy's free tier):

```bash
cd app && RPC_URL=https://ethereum-sepolia-rpc.publicnode.com KEEPER_PK=0x... VITE_DEPLOYMENTS=src/deployments.sepolia.json npm run keeper
```

### Deploying your own

Sepolia charges far more gas for contract creation than forge's local estimate, and HookMiner's CREATE2 search can exceed the simulation block gas limit, so both flags below are needed:

```bash
cd contracts
POOL_MANAGER=0xE03A1074c86CFeDd5C142C4F04F1a1536e203543 PRIVATE_KEY=0x... DEPLOY_OUT=./deployments/sepolia.json \
  forge script script/DeployLocal.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --slow \
  --gas-estimate-multiplier 1000 --disable-block-gas-limit
SEED_KEYS=0x..,0x..,0x..,0x..,0x..,0x.. DEPLOYMENTS=./deployments/sepolia.json PRIVATE_KEY=0x... \
  forge script script/SeedDemo.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --slow   # optional: 6 bidders + 5 orders
DEPLOYMENTS=./deployments/sepolia.json PRIVATE_KEY=0x... \
  forge script script/CreateLaunch.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --slow \
  --gas-estimate-multiplier 1000  # a fresh 14-day launch
```

`script/DeployTestnet.s.sol` deploys only the hook and factory (no demo tokens or pools). Copy the output JSON to `app/src/deployments.sepolia.json` and point `app/.env.sepolia` at it.

## Where the Uniswap integration lives

| What | Where |
| --- | --- |
| Hook permissions (beforeInitialize, beforeAddLiquidity, beforeSwap) | [contracts/src/ClinchHook.sol:179](contracts/src/ClinchHook.sol) `getHookPermissions` |
| Pools initialize only through the hook; launch keys reserved | `ClinchHook.sol:499` `beforeInitialize`, `:204` `initializePool`, `:189` `reservePool` |
| Full-range liquidity only (the pool is exactly x·y=k) | `ClinchHook.sol:504` `beforeAddLiquidity` |
| Direct swaps disabled | `ClinchHook.sol:517` `beforeSwap` |
| Escrowed limit orders in block windows | `ClinchHook.sol:249` `placeOrder` |
| Settlement: engine, then one residual swap via `unlock` | `ClinchHook.sol:306` `settle`, `:346` `poolManager.unlock`, `:387` `unlockCallback`, `:389` `poolManager.swap` |
| Reserves from `StateLibrary.getSlot0` / `getLiquidity` | `ClinchHook.sol:452` `reserves` |
| Pool seeding after a launch (`modifyLiquidity` in `unlock`) | [contracts/src/ClinchLaunch.sol:194](contracts/src/ClinchLaunch.sol) `_seedPool`, `:210` `unlockCallback` |
| Mechanism engine (pure library) | [contracts/src/libraries/ClinchEngine.sol](contracts/src/libraries/ClinchEngine.sol): `target` :65, `run` :100, `twoSided` :233 |

**Forked from CCA:** nothing. Everything here is new code. CCA is the baseline we compare against.

## Guarantees and how they are checked

| Property | Source | Check |
| --- | --- | --- |
| Truthful bidding is dominant; sybil splits never help | Thm 1.3 (launch), Thm 4.19 / 6.6 (hook) | Engine and on-chain fuzz: no split gained more than ε·budget (`testFuzz_Prop4_SybilSplit`, `test_SybilSplitDoesNotHelp`, `test_WhaleSplitNeverHelps`) |
| Splitting can strictly hurt | simulation F1 | `test_Prop4b_EqualValueSplitHurts` |
| No free lunch (sandwich bots earn nothing risk-free) | Fact 2.9 | `test_SandwichBotNoFreeLunch` |
| Pool never underpaid; exact settlement up to dust | Thm 4.11 / 6.3 | `testFuzz_Prop2_ExactSettlement`, `testFuzz_TwoSided_Settlement` |
| Bid order irrelevant (builder reordering useless) | Remark 2.5 | `testFuzz_Prop3_OrderIndependence` |
| Individual rationality | Thm 4.11 | `testFuzz_Prop6_IndividualRationality` |
| Termination bound | Lemma 6.2 | `test_Prop10_TerminationBound` |
| Solidity ≡ reference engine | — | `testFuzz_Differential_*` (bit-exact vs `research/clinch/wad.py` over FFI) |
| Hook never pays out more than it holds | — | `testFuzz_HookConservation`, `testFuzz_Conservation2` |

## Measured gas

| Case | Gas |
| --- | --- |
| Hook settle, 32 orders, batch ≈ 5% of pool, ε = 0.1% | 1.38M |
| Launch settle, 40 bids, ε = 1%, price range 10× (205 ladder steps) | 10.0M |

Configs are bounded so settle always fits in a block: the hook's `isValidConfig` and the factory's `ladderWork` / `MAX_WORK`.

## CROPS

- **C, control.** `settle()`, `claim()` and `cancelStuck()` / `cancel()` are permissionless. If our frontend and keeper disappear, anyone can settle from any wallet and every order stays claimable. A stuck batch or launch can always be cancelled with full refunds after its rescue window. The hook and launches have no owner and no admin keys. The factory's only privileged action is a one-time `setHook`.
- **O, open.** MIT licensed. Everything builds from this repo with `forge build` and `npm run build`. The deploy scripts are included.
- **P, privacy.** Reads can go through **Anon-RPC** (`@anon-rpc/browser-harness`) when an anon-client specifier is configured for the chain (Sepolia or mainnet). The RPC provider then cannot link reads to the user. On the local demo chain there is no specifier, and the app says so instead of pretending. Writes always go to a normal RPC and are public on-chain. The mechanism also gives no edge from hiding: bids are escrowed, and order inside a batch doesn't matter.
- **S, security.** Keys stay in the user's wallet; the demo wallets exist only on the local chain. No trackers or analytics.

## Known limitations

- **Censorship resilience is assumed.** As in the paper (and Otter, Theorem 23), a builder who can censor bids breaks sybil-robustness, and no mechanism fixes that.
- **Weak, not full, Pareto optimality.** The AMM is weakly Pareto optimal for eligible bids. Full Pareto optimality together with sybil-proofness is impossible (SZCL26, LSZ26).
- **Non-uniform prices and escrow during the window** are inherent to the design.
- **Discretization.** The ε-ladder makes incentive-compatibility ε-approximate. Deviation gains we measured stayed under ε·budget (worst 1.5e-5 at ε = 0.1%). This is an empirical claim, not a theorem.
- **Slot griefing.** Batches and launches have a bounded number of slots (`maxOrders`, `maxBids`). One actor can fill them with minimum-size orders or bids, which locks their capital and makes the batch fail for others. This is mitigated by minimum sizes, not prevented (`test_KnownLimitation_BidSlotGriefing`).
- **Pool-key griefing.** A launch's pool key is reserved atomically at creation, but someone could pre-initialize all 32 candidate tick spacings for a pair. Issuers can submit privately.
- **Hook pools are fee-0, full-range, ERC20-only.** LPs earn nothing from swaps; their exposure is to price only. The pool must hold at least 1e9 raw units per side.
- **Liquidity can change between order and settle.** If the batch grows beyond 2× the depth cap relative to current reserves, settle auto-cancels it (full refunds) rather than running an unbounded ladder.
- **v4 protocol fee.** If Uniswap governance turns on a protocol fee, it is tolerated, and buyers share it pro-rata.
- **Not audited.** This is hackathon code. An independent internal review found no way for the hook to pay out more than it holds; the liveness issues it found are fixed (`test/Regression.t.sol`).

## Repo map

```text
contracts/   Foundry: ClinchEngine, ClinchHook, ClinchLaunch, ClinchLaunchFactory, tests, deploy scripts
app/         Vite + React frontend and settlement keeper
research/    Python reference engines, simulations, FINDINGS.md, figures
docs/        Build handoff and the source paper (arXiv 2610.36629)
scripts/     demo.sh
FEEDBACK.md  Uniswap v4 developer feedback
```

## References

Zhang, Li, Shi, Zhang, Xia, Han. *Sybil-Proofness of Generalized Adaptive Clinching and Implications for Blockchain Mechanism Design.* arXiv 2610.36629 / ePrint 2026/2674. · Dobzinski, Lavi, Nisan. *Multi-unit auctions with budget limits.* FOCS 2008. · Shi, Zhang, Chung, Li. *Otter.* arXiv 2609.03474. · Uniswap Labs. *Continuous Clearing Auction*, 2025.
