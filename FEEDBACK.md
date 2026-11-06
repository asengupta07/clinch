# Uniswap v4 developer feedback

What it was like to build ClinchHook, a batch-auction hook that settles through one residual swap inside `unlock`. This is concrete and specific to the friction we actually hit.

## Time to first working hook

We had a hook on a local PoolManager rejecting direct swaps and settling a batch through `unlock` → `swap` → `sync`/`settle`/`take` within the first build session. Most of that time went into the items below, not into v4's core model. Once understood, `unlock` and the delta accounting were clean to work with.

## What was missing or hard to find

1. **`BaseHook` is not in v4-periphery any more.** Many tutorials and templates still import `v4-periphery/src/utils/BaseHook.sol`, which no longer exists at the current periphery commit. We implemented `IHooks` directly: 14 functions, 11 of them reverting stubs. A one-line note in the periphery README pointing to where `BaseHook` lives now would save every new hook author this detour.
2. **`HookMiner` lives in `v4-periphery/test/shared/`**, not under `src/`. Scripts that deploy a hook have to import from a test folder. Hook deployment is a production concern, so the miner deserves a stable `src/` path.
3. **No documented pattern for "only full-range liquidity".** Our mechanism needs the pool to be exactly x·y = k. We enforce it in `beforeAddLiquidity` by recomputing `(MIN_TICK / spacing) * spacing`. A `TickMath.minUsableTick(spacing)` / `maxUsableTick(spacing)` in core, as v3 had in its test utils, plus a short doc section, would make this a one-liner.
4. **No documented pattern for "initialize only through the hook".** We gate `beforeInitialize` on `sender == address(this)` and expose our own `initializePool`. That works, but a recipe in the docs ("permissioned pool creation") would stop people from shipping hooks whose pools can be initialized at a manipulated price.
5. **Reading constant-product reserves for a full-range pool** needs `StateLibrary.getSlot0` plus `getLiquidity`, then `L·2^96/√P` and `L·√P/2^96`. A tiny helper or doc snippet for "virtual reserves" would help any hook that reasons about the curve.
6. **Foundry via-IR gotcha (not v4's fault, but v4 forces via-IR):** with `via_ir = true`, `block.number` and `block.timestamp` read after `vm.roll`/`vm.warp` in the same test function can be stale. Batch hooks are block-window driven, so this bites immediately. Worth a callout in the hook testing guide.

## The one improvement with the greatest impact

**A maintained `BaseHook` (or hook template) with permissioned-initialize and full-range-only switches, versioned alongside periphery.** Every batch / auction / custom-curve hook needs "who may initialize" and "which ranges are allowed". Today each team re-derives them, and getting the first one wrong is a real security bug.

## What worked well

- `unlock` plus transient deltas made "run an auction, then do one swap" straightforward and atomic.
- `v4-core/test/utils/Deployers.sol` gave us a working PoolManager, routers and tokens in two lines for integration tests.
- `PoolSwapTest` reverting through our `beforeSwap` let us prove "direct swaps disabled" in a single test.
