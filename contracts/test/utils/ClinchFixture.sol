// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {ClinchHook} from "../../src/ClinchHook.sol";
import {ClinchLaunchFactory} from "../../src/ClinchLaunchFactory.sol";

abstract contract ClinchFixture is Deployers {
    uint160 constant HOOK_FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG;

    ClinchHook hook;
    ClinchLaunchFactory factory;
    MockERC20 token0;
    MockERC20 token1;

    function _deployClinch() internal {
        deployFreshManagerAndRouters();
        deployMintAndApprove2Currencies();
        token0 = MockERC20(Currency.unwrap(currency0));
        token1 = MockERC20(Currency.unwrap(currency1));
        factory = new ClinchLaunchFactory(manager);
        address hookAddr = address(uint160(0x4444 << 144) | HOOK_FLAGS);
        deployCodeTo("ClinchHook.sol:ClinchHook", abi.encode(manager, address(factory)), hookAddr);
        hook = ClinchHook(hookAddr);
        factory.setHook(hook);
    }

    function _cfg() internal pure returns (ClinchHook.PoolConfig memory c) {
        c.windowBlocks = 5;
        c.rescueBlocks = 50;
        c.maxOrders = 32;
        c.maxDepthBps = 500; // 5%
        c.eps = 1e15;
        c.minOrder0 = 1e15;
        c.minOrder1 = 1e15;
    }

    function _key(int24 spacing) internal view returns (PoolKey memory) {
        return PoolKey(currency0, currency1, 0, spacing, IHooks(address(hook)));
    }

    /// sqrtPriceX96 for a WAD price (token1 per token0)
    function _sqrtP(uint256 priceWad) internal pure returns (uint160) {
        return uint160(FixedPointMathLib.sqrt(priceWad * (1 << 96) / 1e18 * (1 << 96)));
    }

    function _fullRange(PoolKey memory k) internal pure returns (int24 lo, int24 hi) {
        lo = (TickMath.MIN_TICK / k.tickSpacing) * k.tickSpacing;
        hi = (TickMath.MAX_TICK / k.tickSpacing) * k.tickSpacing;
    }

    function _addFullRange(PoolKey memory k, uint256 liquidity) internal {
        (int24 lo, int24 hi) = _fullRange(k);
        modifyLiquidityRouter.modifyLiquidity(
            k, ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: int256(liquidity), salt: 0}), ""
        );
    }

    function _fund(address who, uint256 a0, uint256 a1) internal {
        token0.mint(who, a0);
        token1.mint(who, a1);
        vm.startPrank(who);
        token0.approve(address(hook), type(uint256).max);
        token1.approve(address(hook), type(uint256).max);
        vm.stopPrank();
    }
}
