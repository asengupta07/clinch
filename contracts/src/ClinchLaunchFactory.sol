// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "solmate/src/utils/SafeTransferLib.sol";

import {ClinchHook} from "./ClinchHook.sol";
import {ClinchLaunch} from "./ClinchLaunch.sol";

/// @title ClinchLaunchFactory
/// @notice Creates launches, reserves each launch's pool key on the hook in the same transaction (so the
///         seeded pool cannot be initialized at a manipulated price), and pulls the issuer's tokens in.
contract ClinchLaunchFactory {
    using SafeTransferLib for ERC20;

    IPoolManager public immutable poolManager;
    address public immutable deployer;
    ClinchHook public hook;
    address[] public launches;

    /// @dev Upper bound on (ladder steps x bids) for a launch settle. Measured ~1.2k gas per unit
    ///      (research/FINDINGS.md), so 12,000 units is ~15M gas, well inside a 30M block.
    uint256 public constant MAX_WORK = 12_000;

    event HookSet(address hook);
    event LaunchCreated(address indexed launch, address indexed issuer, address saleToken, address quoteToken, PoolKey key);

    error NotDeployer();
    error HookAlreadySet();
    error HookMismatch();
    error InvalidParams();
    error NoFreePoolKey();
    error TransferAmountMismatch();

    constructor(IPoolManager _pm) {
        poolManager = _pm;
        deployer = msg.sender;
    }

    /// @notice One-time wiring. The hook stores this factory as immutable, so it is deployed after it.
    function setHook(ClinchHook _hook) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (address(hook) != address(0)) revert HookAlreadySet();
        if (_hook.launchFactory() != address(this)) revert HookMismatch();
        hook = _hook;
        emit HookSet(address(_hook));
    }

    function launchCount() external view returns (uint256) {
        return launches.length;
    }

    function allLaunches() external view returns (address[] memory) {
        return launches;
    }

    function createLaunch(ClinchLaunch.Params calldata p) external returns (ClinchLaunch launch) {
        if (address(hook) == address(0)) revert HookMismatch();
        if (p.saleToken == address(0) || p.quoteToken == address(0) || p.saleToken == p.quoteToken) revert InvalidParams();
        if (p.supply == 0 || p.reservePrice == 0 || p.maxPrice <= p.reservePrice) revert InvalidParams();
        if (p.eps < 1e14 || p.eps > 1e17) revert InvalidParams();
        if (p.lpQuoteBps > 10_000) revert InvalidParams();
        if (p.endTime <= block.timestamp || p.rescueDelay < 60) revert InvalidParams();
        if (p.maxBids == 0 || p.maxBids > 200 || p.minBid == 0) revert InvalidParams();
        // the seeded pool's price must stay within the hook's precision range in either token order
        if (p.reservePrice < 1e4 || p.maxPrice > 1e32) revert InvalidParams();
        if (!hook.isValidConfig(p.poolCfg)) revert InvalidParams();
        if (ladderWork(p.reservePrice, p.maxPrice, p.eps, p.maxBids) > MAX_WORK) revert InvalidParams();

        PoolKey memory key = _freeKey(p.saleToken, p.quoteToken);
        launch = new ClinchLaunch(poolManager, hook, p, key, msg.sender);
        hook.reservePool(key, address(launch));

        uint256 total = p.supply + p.lpTokens;
        ERC20 sale = ERC20(p.saleToken);
        uint256 before = sale.balanceOf(address(launch));
        sale.safeTransferFrom(msg.sender, address(launch), total);
        if (sale.balanceOf(address(launch)) - before != total) revert TransferAmountMismatch();
        launch.activate();

        launches.push(address(launch));
        emit LaunchCreated(address(launch), msg.sender, p.saleToken, p.quoteToken, key);
    }

    /// @notice (ladder steps from reserve to ceiling + one exit step per bid) x bids: the settle cost driver.
    function ladderWork(uint256 reservePrice, uint256 maxPrice, uint256 eps, uint256 maxBids) public pure returns (uint256) {
        uint256 steps;
        uint256 pr = reservePrice;
        while (pr < maxPrice && steps <= MAX_WORK) {
            pr = FullMath.mulDiv(pr, 1e18 + eps, 1e18);
            ++steps;
        }
        return (steps + maxBids) * maxBids;
    }

    /// @dev Picks the first tick spacing whose key is neither initialized nor reserved. A griefer would
    ///      have to pre-initialize every candidate; the issuer can also submit privately.
    function _freeKey(address a, address b) internal view returns (PoolKey memory key) {
        (address c0, address c1) = a < b ? (a, b) : (b, a);
        for (int24 sp = 60; sp < 92; ++sp) {
            key = PoolKey({
                currency0: Currency.wrap(c0),
                currency1: Currency.wrap(c1),
                fee: 0,
                tickSpacing: sp,
                hooks: IHooks(address(hook))
            });
            if (hook.isFree(key)) return key;
        }
        revert NoFreePoolKey();
    }
}
