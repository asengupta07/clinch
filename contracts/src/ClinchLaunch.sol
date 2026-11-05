// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";

import {ClinchEngine} from "./libraries/ClinchEngine.sol";
import {ClinchHook} from "./ClinchHook.sol";

/// @title ClinchLaunch
/// @notice A token sale run as fixed-supply adaptive clinching (Dobzinski-Lavi-Nisan). Bidding your true
///         value and budget is a dominant strategy, and splitting a budget across wallets never helps
///         (Theorem 1.3 of arXiv 2610.36629; the escrowed budget is the theorem's hypothesis).
///         After settlement the proceeds seed a Clinch batch pool at the discovered price; that liquidity
///         is locked in this contract forever.
contract ClinchLaunch is IUnlockCallback {
    using SafeTransferLib for ERC20;

    uint256 internal constant WAD = 1e18;
    uint256 internal constant MAX_STEPS = 20_000;

    struct Params {
        address saleToken;
        address quoteToken;
        uint256 supply; // sale tokens auctioned
        uint256 lpTokens; // extra sale tokens reserved for the pool (unsold supply is added too)
        uint16 lpQuoteBps; // share of proceeds paired into the pool
        uint256 reservePrice; // quote per sale token (WAD); bids below are rejected
        uint256 maxPrice; // price ceiling (WAD); required for termination (research F7)
        uint64 eps; // ladder step (WAD)
        uint64 endTime;
        uint32 rescueDelay; // seconds after endTime before an unsettled sale can be cancelled
        uint16 maxBids;
        uint128 minBid; // minimum budget in quote token
        ClinchHook.PoolConfig poolCfg; // batch config for the seeded pool
    }

    struct Bid {
        address owner;
        bool claimed;
        uint256 limit;
        uint128 budget;
        uint128 paid;
        uint256 qty;
    }

    enum Status {
        Pending,
        Live,
        Settled,
        Cancelled
    }

    IPoolManager public immutable poolManager;
    ClinchHook public immutable hook;
    address public immutable factory;
    address public immutable issuer;
    ERC20 public immutable saleToken;
    ERC20 public immutable quoteToken;
    bool public immutable saleIsToken0;

    Params internal _p;
    PoolKey internal _key;

    Status public status;
    Bid[] internal _bids;
    uint256 public totalBudget;
    uint256 public sold;
    uint256 public proceeds;
    uint256 public clearingPrice; // final clock price
    uint256 public steps;
    uint128 public lpLiquidity;
    uint256 public issuerQuote; // withdrawable by issuer
    uint256 public issuerSale; // withdrawable by issuer
    bool public poolSeeded;

    uint256 private _lock = 1;

    event Activated(address indexed launch);
    event BidPlaced(uint256 indexed index, address indexed owner, uint256 limit, uint256 budget);
    event Settled(uint256 clearingPrice, uint256 sold, uint256 proceeds, uint256 steps, address settler);
    event PoolSeeded(uint160 sqrtPriceX96, uint128 liquidity, uint256 saleAmount, uint256 quoteAmount);
    event Cancelled(address caller);
    event Claimed(uint256 indexed index, address indexed owner, uint256 tokens, uint256 refund);
    event IssuerWithdrawn(uint256 sale, uint256 quote);

    error NotFactory();
    error NotIssuer();
    error NotPoolManager();
    error WrongStatus();
    error SaleClosed();
    error SaleOpen();
    error TooManyBids();
    error BidTooSmall();
    error LimitBelowReserve();
    error AlreadyClaimed();
    error RescueNotReady();
    error Underfunded();
    error TransferAmountMismatch();
    error Reentrancy();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(IPoolManager _pm, ClinchHook _hook, Params memory p, PoolKey memory key, address _issuer) {
        poolManager = _pm;
        hook = _hook;
        factory = msg.sender;
        issuer = _issuer;
        saleToken = ERC20(p.saleToken);
        quoteToken = ERC20(p.quoteToken);
        saleIsToken0 = Currency.unwrap(key.currency0) == p.saleToken;
        _p = p;
        _key = key;
    }

    /// @notice Called by the factory once the sale and LP tokens are held.
    function activate() external {
        if (msg.sender != factory) revert NotFactory();
        if (status != Status.Pending) revert WrongStatus();
        if (saleToken.balanceOf(address(this)) < _p.supply + _p.lpTokens) revert Underfunded();
        status = Status.Live;
        emit Activated(address(this));
    }

    // ------------------------------------------------------------------ bidding

    /// @notice Escrow `budget` quote tokens with a maximum price `limit` (quote per sale token, WAD).
    ///         Truthful bidding is a dominant strategy: bid what a token is really worth to you and the
    ///         most you are willing to spend.
    function bid(uint256 limit, uint128 budget) external nonReentrant returns (uint256 index) {
        if (status != Status.Live) revert WrongStatus();
        if (block.timestamp >= _p.endTime) revert SaleClosed();
        if (_bids.length >= _p.maxBids) revert TooManyBids();
        if (budget < _p.minBid) revert BidTooSmall();
        if (limit < _p.reservePrice) revert LimitBelowReserve();

        uint256 before = quoteToken.balanceOf(address(this));
        quoteToken.safeTransferFrom(msg.sender, address(this), budget);
        if (quoteToken.balanceOf(address(this)) - before != budget) revert TransferAmountMismatch();

        index = _bids.length;
        _bids.push(Bid({owner: msg.sender, claimed: false, limit: limit, budget: budget, paid: 0, qty: 0}));
        totalBudget += budget;
        emit BidPlaced(index, msg.sender, limit, budget);
    }

    // ------------------------------------------------------------------ settlement

    /// @notice Run the clinching auction and seed the pool. Permissionless once the sale has ended.
    function settle() external nonReentrant {
        if (status != Status.Live) revert WrongStatus();
        if (block.timestamp < _p.endTime) revert SaleOpen();

        ClinchEngine.Result memory r = ClinchEngine.run(_engineBids(), _supply(), _params());
        uint256 n = _bids.length;
        for (uint256 i; i < n; ++i) {
            Bid storage b = _bids[i];
            b.qty = r.qty[i];
            b.paid = uint128(r.paid[i]);
        }
        sold = r.X;
        proceeds = r.Y;
        clearingPrice = r.pFinal;
        steps = r.steps;
        status = Status.Settled;
        emit Settled(r.pFinal, r.X, r.Y, r.steps, msg.sender);

        uint256 lpSale = _p.lpTokens + (_p.supply - r.X);
        uint256 lpQuote = FullMath.mulDiv(r.Y, _p.lpQuoteBps, 10_000);
        if (r.X > 0 && lpQuote > 0 && lpSale > 0) {
            (uint256 usedSale, uint256 usedQuote) = _seedPool(r.pFinal, lpSale, lpQuote);
            lpSale -= usedSale;
            lpQuote -= usedQuote;
        }
        issuerSale = lpSale;
        issuerQuote = (r.Y - FullMath.mulDiv(r.Y, _p.lpQuoteBps, 10_000)) + lpQuote;
    }

    function _seedPool(uint256 price, uint256 saleAmt, uint256 quoteAmt) internal returns (uint256 usedSale, uint256 usedQuote) {
        uint160 sqrtP = _sqrtPriceX96(price);
        hook.initializePool(_key, sqrtP, _p.poolCfg);
        int24 sp = _key.tickSpacing;
        int24 lo = (TickMath.MIN_TICK / sp) * sp;
        int24 hi = (TickMath.MAX_TICK / sp) * sp;
        (uint256 a0, uint256 a1) = saleIsToken0 ? (saleAmt, quoteAmt) : (quoteAmt, saleAmt);
        uint128 L = LiquidityAmounts.getLiquidityForAmounts(sqrtP, TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), a0, a1);
        if (L == 0) return (0, 0);
        (uint256 p0, uint256 p1) = abi.decode(poolManager.unlock(abi.encode(lo, hi, L)), (uint256, uint256));
        lpLiquidity = L;
        poolSeeded = true;
        (usedSale, usedQuote) = saleIsToken0 ? (p0, p1) : (p1, p0);
        emit PoolSeeded(sqrtP, L, usedSale, usedQuote);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (int24 lo, int24 hi, uint128 L) = abi.decode(data, (int24, int24, uint128));
        (BalanceDelta d,) = poolManager.modifyLiquidity(
            _key, ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: int256(uint256(L)), salt: 0}), ""
        );
        uint256 p0 = uint256(uint128(-d.amount0()));
        uint256 p1 = uint256(uint128(-d.amount1()));
        _pay(_key.currency0, p0);
        _pay(_key.currency1, p1);
        return abi.encode(p0, p1);
    }

    function _pay(Currency c, uint256 amt) internal {
        if (amt == 0) return;
        poolManager.sync(c);
        ERC20(Currency.unwrap(c)).safeTransfer(address(poolManager), amt);
        poolManager.settle();
    }

    /// @notice Failure path: if nobody manages to settle within `rescueDelay` after the end, anyone can
    ///         cancel. Every bidder is then fully refunded and the issuer recovers all tokens.
    function cancel() external nonReentrant {
        if (status != Status.Live) revert WrongStatus();
        if (block.timestamp < uint256(_p.endTime) + _p.rescueDelay) revert RescueNotReady();
        status = Status.Cancelled;
        issuerSale = _p.supply + _p.lpTokens;
        emit Cancelled(msg.sender);
    }

    // ------------------------------------------------------------------ payouts

    function claim(uint256 index) public nonReentrant {
        _claim(index);
    }

    function claimMany(uint256[] calldata indices) external nonReentrant {
        for (uint256 i; i < indices.length; ++i) {
            _claim(indices[i]);
        }
    }

    function _claim(uint256 index) internal {
        if (status != Status.Settled && status != Status.Cancelled) revert WrongStatus();
        Bid storage b = _bids[index];
        if (b.claimed) revert AlreadyClaimed();
        b.claimed = true;
        (uint256 tokens, uint256 refund) =
            status == Status.Cancelled ? (0, uint256(b.budget)) : (b.qty, uint256(b.budget) - b.paid);
        if (tokens > 0) saleToken.safeTransfer(b.owner, tokens);
        if (refund > 0) quoteToken.safeTransfer(b.owner, refund);
        emit Claimed(index, b.owner, tokens, refund);
    }

    function issuerWithdraw() external nonReentrant {
        if (msg.sender != issuer) revert NotIssuer();
        if (status != Status.Settled && status != Status.Cancelled) revert WrongStatus();
        uint256 s = issuerSale;
        uint256 q = issuerQuote;
        issuerSale = 0;
        issuerQuote = 0;
        if (s > 0) saleToken.safeTransfer(issuer, s);
        if (q > 0) quoteToken.safeTransfer(issuer, q);
        emit IssuerWithdrawn(s, q);
    }

    // ------------------------------------------------------------------ views

    function params() external view returns (Params memory) {
        return _p;
    }

    function poolKey() external view returns (PoolKey memory) {
        return _key;
    }

    function bidCount() external view returns (uint256) {
        return _bids.length;
    }

    function getBids() external view returns (Bid[] memory) {
        return _bids;
    }

    /// @notice Outcome if the sale settled now with the current bids. For the UI.
    function previewSettle() external view returns (ClinchEngine.Result memory) {
        return ClinchEngine.run(_engineBids(), _supply(), _params());
    }

    function _engineBids() internal view returns (ClinchEngine.Bid[] memory eb) {
        uint256 n = _bids.length;
        eb = new ClinchEngine.Bid[](n);
        for (uint256 i; i < n; ++i) {
            eb[i] = ClinchEngine.Bid({limit: _bids[i].limit, budget: _bids[i].budget});
        }
    }

    function _supply() internal view returns (ClinchEngine.Supply memory s) {
        s.kind = 0;
        s.S0 = _p.supply;
        s.p0 = _p.reservePrice;
    }

    function _params() internal view returns (ClinchEngine.Params memory) {
        return ClinchEngine.Params({eps: _p.eps, pMax: _p.maxPrice, maxSteps: MAX_STEPS});
    }

    /// @dev price is quote per sale token (WAD). v4 price is token1 per token0.
    function _sqrtPriceX96(uint256 price) internal view returns (uint160) {
        uint256 ratioX192 = saleIsToken0 ? FullMath.mulDiv(price, 1 << 192, WAD) : FullMath.mulDiv(WAD, 1 << 192, price);
        uint256 s = FixedPointMathLib.sqrt(ratioX192);
        if (s <= TickMath.MIN_SQRT_PRICE) s = TickMath.MIN_SQRT_PRICE + 1;
        if (s >= TickMath.MAX_SQRT_PRICE) s = TickMath.MAX_SQRT_PRICE - 1;
        return uint160(s);
    }
}
