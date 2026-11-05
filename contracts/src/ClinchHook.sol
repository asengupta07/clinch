// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/types/PoolOperation.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";

import {ClinchEngine} from "./libraries/ClinchEngine.sol";

/// @title ClinchHook
/// @notice Uniswap v4 hook that turns a pool into a sybil-proof batch auction.
///         Swaps are collected as escrowed limit orders during a window of blocks; anyone can settle a
///         closed window. Settlement runs the two-sided AMM adaptive clinching mechanism
///         (arXiv 2610.36629, Section 5) against the pool's constant-product curve, then executes ONE
///         residual exact-input swap on the PoolManager. The pool's output beyond the engine's allocation
///         (the discretization surplus) is rebated pro-rata to the dominant side (research/FINDINGS.md, F6).
/// @dev    Pool invariants enforced by the hook so the pool is exactly the constant-product curve the
///         mechanism is defined on: LP fee 0, ERC20 currencies only, full-range liquidity only, and no
///         swaps except the hook's own settlement swap.
contract ClinchHook is IHooks, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using SafeTransferLib for ERC20;

    uint256 internal constant WAD = 1e18;
    uint256 internal constant MAX_STEPS = 4000;
    /// @dev Upper bound on (ladder steps x orders) a config may imply. Measured cost is ~1.2-1.8k gas
    ///      per unit, so 10,000 units keeps settle under a 30M-gas block (research/FINDINGS.md).
    uint256 internal constant MAX_WORK = 10_000;
    /// @dev Spot price bounds (token1 per token0, WAD) so neither clock (p0 or 1/p0) loses precision.
    uint256 internal constant MIN_PRICE_WAD = 1e4;
    uint256 internal constant MAX_PRICE_WAD = 1e32;
    /// @dev Below this many raw units per side, v4's sqrt-price rounding is no longer negligible against the
    ///      closed-form curve. Orders are refused and settlement auto-cancels (e.g. 1e9 = $1,000 of USDC).
    uint256 internal constant MIN_RESERVE = 1e9;

    // ------------------------------------------------------------------ types

    struct PoolConfig {
        uint32 windowBlocks; // blocks a batch stays open after its first order
        uint32 rescueBlocks; // blocks after close before an unsettled batch can be cancelled
        uint16 maxOrders; // orders per batch (bounds settle gas)
        uint16 maxDepthBps; // per-side batch budget cap, bps of that token's reserve (bounds ladder length)
        uint64 eps; // ladder step, WAD
        uint128 minOrder0; // minimum budget for token0 sellers
        uint128 minOrder1; // minimum budget for token1 sellers
    }

    struct Order {
        address owner;
        bool zeroForOne; // sells token0 for token1
        bool claimed;
        uint256 limit; // token1 per token0, WAD: max for buyers, min for sellers
        uint128 budget; // escrowed amount of the token sold
        uint128 spent; // amount of the sold token used (set at settlement)
        uint128 received; // engine allocation of the other token (pre-rebate for the dominant side)
    }

    enum Status {
        None,
        Open,
        Settled,
        Cancelled
    }

    struct Batch {
        uint64 startBlock;
        uint64 endBlock;
        Status status;
        bool buyersDominant;
        uint16 nOrders;
        uint128 sum0; // total token0 escrowed
        uint128 sum1; // total token1 escrowed
        uint256 availNum; // dominant payout scale: available / engineBought
        uint256 availDen;
        uint256 pFinal; // dominant-side clock price at termination (dominant side's units)
        uint64 steps;
    }

    struct PoolState {
        bool initialized;
        uint64 currentBatch; // id of the latest batch (0 = none yet)
        uint64 nextToSettle; // lowest unsettled batch id
        PoolConfig cfg;
    }

    // ------------------------------------------------------------------ storage

    IPoolManager public immutable poolManager;
    address public immutable launchFactory;

    mapping(PoolId => PoolState) internal _pools;
    mapping(PoolId => mapping(uint64 => Batch)) internal _batches;
    mapping(PoolId => mapping(uint64 => Order[])) internal _orders;
    mapping(PoolId => address) public reservedBy;

    uint256 private _lock = 1;

    // ------------------------------------------------------------------ events / errors

    event PoolInitialized(PoolId indexed id, PoolKey key, uint160 sqrtPriceX96, PoolConfig cfg);
    event PoolReserved(PoolId indexed id, address indexed reserver);
    event OrderPlaced(
        PoolId indexed id, uint64 indexed batchId, uint256 index, address indexed owner, bool zeroForOne, uint256 limit, uint256 budget
    );
    event BatchSettled(
        PoolId indexed id,
        uint64 indexed batchId,
        bool buyersDominant,
        uint256 pFinal,
        uint256 steps,
        uint256 minoritySupply,
        uint256 poolIn,
        uint256 poolOut,
        uint256 engineBought,
        address settler
    );
    event BatchCancelled(PoolId indexed id, uint64 indexed batchId, address caller, bool overDepth);
    event Claimed(PoolId indexed id, uint64 indexed batchId, uint256 index, address indexed owner, uint256 refund, uint256 proceeds);

    error NotPoolManager();
    error NotSelf();
    error NotFactory();
    error HookNotImplemented();
    error DirectSwapDisabled();
    error FullRangeOnly();
    error InvalidPool();
    error InvalidConfig();
    error PoolNotInitialized();
    error PoolReservedFor(address reserver);
    error AlreadyInitialized();
    error OrderTooSmall();
    error InvalidLimit();
    error BatchFull();
    error DepthExceeded();
    error BatchNotClosed();
    error NothingToSettle();
    error NotSettleable();
    error RescueNotReady();
    error AlreadyClaimed();
    error NotFinal();
    error TransferAmountMismatch();
    error SettlementShortfall(uint256 needed, uint256 got);
    error Reentrancy();
    error PriceOutOfRange();
    error OrderNotMarketable();
    error PoolTooShallow();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(IPoolManager _poolManager, address _launchFactory) {
        poolManager = _poolManager;
        launchFactory = _launchFactory;
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory p) {
        p.beforeInitialize = true;
        p.beforeAddLiquidity = true;
        p.beforeSwap = true;
    }

    // ------------------------------------------------------------------ pool lifecycle

    /// @notice Lets the launch factory reserve a pool key for a launch, so nobody can initialize it at a
    ///         manipulated price before the launch settles.
    function reservePool(PoolKey calldata key, address reserver) external {
        if (msg.sender != launchFactory) revert NotFactory();
        _validateKey(key);
        PoolId id = key.toId();
        if (_pools[id].initialized || reservedBy[id] != address(0)) revert AlreadyInitialized();
        reservedBy[id] = reserver;
        emit PoolReserved(id, reserver);
    }

    function isFree(PoolKey calldata key) external view returns (bool) {
        PoolId id = key.toId();
        return !_pools[id].initialized && reservedBy[id] == address(0);
    }

    /// @notice Initialize a Clinch pool. Pools can only be initialized through this function.
    function initializePool(PoolKey calldata key, uint160 sqrtPriceX96, PoolConfig calldata cfg) external nonReentrant {
        _validateKey(key);
        if (!isValidConfig(cfg)) revert InvalidConfig();
        uint256 pWad = FullMath.mulDiv(FullMath.mulDiv(sqrtPriceX96, sqrtPriceX96, 1 << 96), WAD, 1 << 96);
        if (pWad < MIN_PRICE_WAD || pWad > MAX_PRICE_WAD) revert PriceOutOfRange();
        PoolId id = key.toId();
        address r = reservedBy[id];
        if (r != address(0) && r != msg.sender) revert PoolReservedFor(r);
        PoolState storage ps = _pools[id];
        if (ps.initialized) revert AlreadyInitialized();
        ps.initialized = true;
        ps.cfg = cfg;
        ps.nextToSettle = 1;
        poolManager.initialize(key, sqrtPriceX96);
        emit PoolInitialized(id, key, sqrtPriceX96, cfg);
    }

    function _validateKey(PoolKey calldata key) internal view {
        if (address(key.hooks) != address(this)) revert InvalidPool();
        if (key.fee != 0) revert InvalidPool();
        if (Currency.unwrap(key.currency0) == address(0)) revert InvalidPool(); // ERC20 only
        if (key.tickSpacing <= 0) revert InvalidPool();
    }

    /// @notice Config bounds. The ladder for a batch whose budget is d (fraction of reserves) needs about
    ///         2 ln(1 + d) / eps + n steps (paper Lemma 6.2). Settle tolerates 2x the depth cap before it
    ///         auto-cancels, so the bound uses 2 * maxDepth.
    function isValidConfig(PoolConfig memory c) public pure returns (bool) {
        if (c.windowBlocks == 0 || c.windowBlocks > 50_000) return false;
        if (c.rescueBlocks < 10 || c.rescueBlocks > 1_000_000) return false;
        if (c.maxOrders == 0 || c.maxOrders > 64) return false;
        if (c.maxDepthBps == 0 || c.maxDepthBps > 1000) return false;
        if (c.eps < 5e14 || c.eps > 5e16) return false;
        if (c.minOrder0 == 0 || c.minOrder1 == 0) return false;
        // steps ~ 2 * (2 * depth) / eps + orders, with ln(1+d) <= d
        uint256 stepsBound = (4 * uint256(c.maxDepthBps) * 1e14) / c.eps + c.maxOrders;
        return stepsBound * c.maxOrders <= MAX_WORK;
    }

    // ------------------------------------------------------------------ orders

    /// @notice Escrow `budget` of the sold token as a limit order in the current batch.
    /// @param zeroForOne true = sell token0 for token1.
    /// @param limit token1 per token0 (WAD). Buyers (selling token1): the highest price accepted.
    ///        Sellers (selling token0): the lowest price accepted (0 = any price).
    function placeOrder(PoolKey calldata key, bool zeroForOne, uint256 limit, uint128 budget)
        external
        nonReentrant
        returns (uint64 batchId, uint256 index)
    {
        PoolId id = key.toId();
        PoolState storage ps = _pools[id];
        if (!ps.initialized) revert PoolNotInitialized();
        PoolConfig memory cfg = ps.cfg;
        if (budget < (zeroForOne ? cfg.minOrder0 : cfg.minOrder1)) revert OrderTooSmall();
        if (!zeroForOne && limit == 0) revert InvalidLimit();

        batchId = ps.currentBatch;
        Batch storage b = _batches[id][batchId];
        if (batchId == 0 || block.number >= b.endBlock) {
            batchId += 1;
            ps.currentBatch = batchId;
            b = _batches[id][batchId];
            b.startBlock = uint64(block.number);
            b.endBlock = uint64(block.number) + cfg.windowBlocks;
            b.status = Status.Open;
        }
        if (b.nOrders >= cfg.maxOrders) revert BatchFull();

        (uint256 r0, uint256 r1) = reserves(key);
        if (r0 < MIN_RESERVE || r1 < MIN_RESERVE) revert PoolTooShallow();
        {
            uint256 spot = FullMath.mulDiv(r1, WAD, r0);
            // buyers must accept at least spot; sellers must accept spot (limit is their minimum)
            if (zeroForOne ? limit > spot : limit < spot) revert OrderNotMarketable();
        }
        if (zeroForOne) {
            uint256 s = uint256(b.sum0) + budget;
            if (s * 10_000 > r0 * cfg.maxDepthBps) revert DepthExceeded();
            b.sum0 = uint128(s);
        } else {
            uint256 s = uint256(b.sum1) + budget;
            if (s * 10_000 > r1 * cfg.maxDepthBps) revert DepthExceeded();
            b.sum1 = uint128(s);
        }

        ERC20 token = ERC20(Currency.unwrap(zeroForOne ? key.currency0 : key.currency1));
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), budget);
        if (token.balanceOf(address(this)) - before != budget) revert TransferAmountMismatch();

        index = b.nOrders;
        b.nOrders += 1;
        _orders[id][batchId].push(
            Order({owner: msg.sender, zeroForOne: zeroForOne, claimed: false, limit: limit, budget: budget, spent: 0, received: 0})
        );
        emit OrderPlaced(id, batchId, index, msg.sender, zeroForOne, limit, budget);
    }

    // ------------------------------------------------------------------ settlement

    /// @notice Settle the oldest unsettled batch once its window has closed. Permissionless.
    function settle(PoolKey calldata key) external nonReentrant returns (uint64 batchId) {
        PoolId id = key.toId();
        PoolState storage ps = _pools[id];
        if (!ps.initialized) revert PoolNotInitialized();
        batchId = ps.nextToSettle;
        Batch storage b = _batches[id][batchId];
        if (b.status != Status.Open) revert NothingToSettle();
        if (block.number < b.endBlock) revert BatchNotClosed();

        (uint256 r0, uint256 r1) = reserves(key);
        // Liquidity may have been removed since the orders were placed. If the batch is now more than 2x
        // the depth cap (or the pool is empty), the ladder could exceed a block: cancel instead of bricking.
        {
            uint256 cap2 = uint256(ps.cfg.maxDepthBps) * 2;
            if (
                r0 < MIN_RESERVE || r1 < MIN_RESERVE || uint256(b.sum0) * 10_000 > r0 * cap2
                    || uint256(b.sum1) * 10_000 > r1 * cap2
            ) {
                b.status = Status.Cancelled;
                ps.nextToSettle = batchId + 1;
                emit BatchCancelled(id, batchId, msg.sender, true);
                return batchId;
            }
        }

        Order[] storage os = _orders[id][batchId];
        uint256 n = os.length;
        ClinchEngine.Order[] memory eo = new ClinchEngine.Order[](n);
        for (uint256 i; i < n; ++i) {
            Order storage o = os[i];
            eo[i] = ClinchEngine.Order({zeroForOne: o.zeroForOne, limit: o.limit, budget: o.budget});
        }

        ClinchEngine.TwoSided memory t =
            ClinchEngine.twoSided(eo, r0, r1, ClinchEngine.Params({eps: ps.cfg.eps, pMax: 0, maxSteps: MAX_STEPS}));

        uint256 poolOut;
        uint256 needed = t.dominantBought > t.minoritySupply ? t.dominantBought - t.minoritySupply : 0;
        if (needed > 0 && t.poolIn > 0) {
            // buyers dominant: they pay token1 into the pool and receive token0 -> zeroForOne = false
            poolOut = abi.decode(poolManager.unlock(abi.encode(key, !t.buyersDominant, t.poolIn)), (uint256));
            // The engine keeps the state on or above the curve, so the pool must deliver about `needed`.
            // Tolerances: v4 sqrt-price rounding (1 ppm + 16 wei) and any v4 protocol fee on this pool.
            // Payouts are scaled by what actually arrived, so a small shortfall is shared pro-rata.
            (,, uint24 protocolFee,) = poolManager.getSlot0(id);
            uint256 feePips = t.buyersDominant ? (protocolFee >> 12) : (protocolFee & 0xfff);
            if (poolOut * 1_000_000 + 16_000_000 < needed * (999_999 - feePips)) revert SettlementShortfall(needed, poolOut);
        }

        for (uint256 i; i < n; ++i) {
            Order storage o = os[i];
            o.spent = uint128(t.spent[i]);
            o.received = uint128(t.received[i]);
        }
        b.status = Status.Settled;
        b.buyersDominant = t.buyersDominant;
        b.availNum = t.minoritySupply + poolOut;
        b.availDen = t.dominantBought;
        b.pFinal = t.pFinal;
        b.steps = uint64(t.steps);
        ps.nextToSettle = batchId + 1;

        emit BatchSettled(
            id, batchId, t.buyersDominant, t.pFinal, t.steps, t.minoritySupply, t.poolIn, poolOut, t.dominantBought, msg.sender
        );
    }

    /// @notice Failure path: if a closed batch is still unsettled `rescueBlocks` after it closed
    ///         (e.g. settle cannot fit in a block), anyone can cancel it; every order is then fully refundable.
    function cancelStuck(PoolKey calldata key) external nonReentrant returns (uint64 batchId) {
        PoolId id = key.toId();
        PoolState storage ps = _pools[id];
        batchId = ps.nextToSettle;
        Batch storage b = _batches[id][batchId];
        if (b.status != Status.Open) revert NothingToSettle();
        if (block.number < uint256(b.endBlock) + ps.cfg.rescueBlocks) revert RescueNotReady();
        b.status = Status.Cancelled;
        ps.nextToSettle = batchId + 1;
        emit BatchCancelled(id, batchId, msg.sender, false);
    }

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (PoolKey memory key, bool zeroForOne, uint256 amountIn) = abi.decode(data, (PoolKey, bool, uint256));
        BalanceDelta d = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        (Currency cin, Currency cout) = zeroForOne ? (key.currency0, key.currency1) : (key.currency1, key.currency0);
        int128 dIn = zeroForOne ? d.amount0() : d.amount1();
        int128 dOut = zeroForOne ? d.amount1() : d.amount0();
        uint256 pay = uint256(uint128(-dIn));
        uint256 out = uint256(uint128(dOut));
        poolManager.sync(cin);
        ERC20(Currency.unwrap(cin)).safeTransfer(address(poolManager), pay);
        poolManager.settle();
        if (out > 0) poolManager.take(cout, address(this), out);
        return abi.encode(out);
    }

    // ------------------------------------------------------------------ claims

    /// @notice Pay out a settled or cancelled order to its owner. Anyone may call it for anyone.
    function claim(PoolKey calldata key, uint64 batchId, uint256 index) public nonReentrant {
        _claim(key, batchId, index);
    }

    function claimMany(PoolKey calldata key, uint64 batchId, uint256[] calldata indices) external nonReentrant {
        for (uint256 i; i < indices.length; ++i) {
            _claim(key, batchId, indices[i]);
        }
    }

    function _claim(PoolKey calldata key, uint64 batchId, uint256 index) internal {
        PoolId id = key.toId();
        Batch storage b = _batches[id][batchId];
        Order storage o = _orders[id][batchId][index];
        if (o.claimed) revert AlreadyClaimed();
        (uint256 refund, uint256 proceeds) = _payout(b, o);
        o.claimed = true;
        ERC20 sold = ERC20(Currency.unwrap(o.zeroForOne ? key.currency0 : key.currency1));
        ERC20 bought = ERC20(Currency.unwrap(o.zeroForOne ? key.currency1 : key.currency0));
        if (refund > 0) sold.safeTransfer(o.owner, refund);
        if (proceeds > 0) bought.safeTransfer(o.owner, proceeds);
        emit Claimed(id, batchId, index, o.owner, refund, proceeds);
    }

    function _payout(Batch storage b, Order storage o) internal view returns (uint256 refund, uint256 proceeds) {
        if (b.status == Status.Cancelled) return (o.budget, 0);
        if (b.status != Status.Settled) revert NotFinal();
        refund = uint256(o.budget) - o.spent;
        bool isBuyer = !o.zeroForOne;
        if (isBuyer == b.buyersDominant && b.availDen > 0) {
            proceeds = FullMath.mulDiv(o.received, b.availNum, b.availDen);
        } else {
            proceeds = o.received;
        }
    }

    // ------------------------------------------------------------------ views

    /// @notice Constant-product reserves implied by the pool's full-range liquidity.
    function reserves(PoolKey memory key) public view returns (uint256 r0, uint256 r1) {
        PoolId id = key.toId();
        (uint160 sqrtP,,,) = poolManager.getSlot0(id);
        uint128 L = poolManager.getLiquidity(id);
        if (sqrtP == 0 || L == 0) return (0, 0);
        r0 = FullMath.mulDiv(uint256(L), 1 << 96, sqrtP);
        r1 = FullMath.mulDiv(uint256(L), sqrtP, 1 << 96);
    }

    function spotPrice(PoolKey memory key) external view returns (uint256) {
        (uint256 r0, uint256 r1) = reserves(key);
        return r0 == 0 ? 0 : FullMath.mulDiv(r1, WAD, r0);
    }

    function poolState(PoolKey calldata key) external view returns (PoolState memory) {
        return _pools[key.toId()];
    }

    function getBatch(PoolKey calldata key, uint64 batchId) external view returns (Batch memory) {
        return _batches[key.toId()][batchId];
    }

    function getOrders(PoolKey calldata key, uint64 batchId) external view returns (Order[] memory) {
        return _orders[key.toId()][batchId];
    }

    /// @notice What each order would get if the given batch settled now (no rebate). For the UI.
    function previewSettle(PoolKey calldata key, uint64 batchId) external view returns (ClinchEngine.TwoSided memory t) {
        PoolId id = key.toId();
        Order[] storage os = _orders[id][batchId];
        ClinchEngine.Order[] memory eo = new ClinchEngine.Order[](os.length);
        for (uint256 i; i < os.length; ++i) {
            eo[i] = ClinchEngine.Order({zeroForOne: os[i].zeroForOne, limit: os[i].limit, budget: os[i].budget});
        }
        (uint256 r0, uint256 r1) = reserves(key);
        t = ClinchEngine.twoSided(eo, r0, r1, ClinchEngine.Params({eps: _pools[id].cfg.eps, pMax: 0, maxSteps: MAX_STEPS}));
    }

    function claimable(PoolKey calldata key, uint64 batchId, uint256 index) external view returns (uint256 refund, uint256 proceeds) {
        PoolId id = key.toId();
        Order storage o = _orders[id][batchId][index];
        if (o.claimed) return (0, 0);
        return _payout(_batches[id][batchId], o);
    }

    // ------------------------------------------------------------------ hook callbacks

    function beforeInitialize(address sender, PoolKey calldata, uint160) external view onlyPoolManager returns (bytes4) {
        if (sender != address(this)) revert NotSelf();
        return IHooks.beforeInitialize.selector;
    }

    function beforeAddLiquidity(address, PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4)
    {
        int24 sp = key.tickSpacing;
        if (params.tickLower != (TickMath.MIN_TICK / sp) * sp || params.tickUpper != (TickMath.MAX_TICK / sp) * sp) {
            revert FullRangeOnly();
        }
        return IHooks.beforeAddLiquidity.selector;
    }

    function beforeSwap(address sender, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        view
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (sender != address(this)) revert DirectSwapDisabled();
        return (IHooks.beforeSwap.selector, BeforeSwapDelta.wrap(0), 0);
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, BalanceDelta)
    {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, BalanceDelta, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, BalanceDelta)
    {
        revert HookNotImplemented();
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, int128)
    {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert HookNotImplemented();
    }
}
