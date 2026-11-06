// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";

import {ClinchHook} from "../src/ClinchHook.sol";
import {ClinchLaunch} from "../src/ClinchLaunch.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Populates a local deployment with realistic activity from anvil accounts #1-#6:
///         launch bids (including a whale) and an open two-sided batch on WETH/USDC.
///         forge script script/SeedDemo.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
contract SeedDemo is Script {
    // Public anvil dev keys. Local chain only.
    uint256[6] PKS = [
        0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d,
        0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a,
        0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6,
        0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a,
        0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba,
        0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e
    ];

    function run() external {
        string memory js = vm.readFile("./deployments/local.json");
        ClinchLaunch launch = ClinchLaunch(vm.parseJsonAddress(js, ".launch"));
        ClinchHook hook = ClinchHook(vm.parseJsonAddress(js, ".hook"));
        MockERC20 usdc = MockERC20(vm.parseJsonAddress(js, ".usdc"));
        MockERC20 weth = MockERC20(vm.parseJsonAddress(js, ".weth"));
        PoolKey memory key = PoolKey(
            Currency.wrap(vm.parseJsonAddress(js, ".swapCurrency0")),
            Currency.wrap(vm.parseJsonAddress(js, ".swapCurrency1")),
            0,
            int24(vm.parseJsonInt(js, ".swapTickSpacing")),
            IHooks(address(hook))
        );
        bool wethIs0 = Currency.unwrap(key.currency0) == address(weth);

        // launch bids: (limit $ per CLNCH, budget $)
        uint256[6] memory lim = [uint256(0.42e18), 0.30e18, 0.65e18, 0.22e18, 0.18e18, 0.55e18];
        uint128[6] memory bud = [uint128(60_000e6), 30_000e6, 45_000e6, 20_000e6, 15_000e6, 150_000e6];
        for (uint256 i; i < 6; ++i) {
            vm.startBroadcast(PKS[i]);
            usdc.mint(vm.addr(PKS[i]), 500_000e6);
            weth.mint(vm.addr(PKS[i]), 100e18);
            usdc.approve(address(launch), type(uint256).max);
            usdc.approve(address(hook), type(uint256).max);
            weth.approve(address(hook), type(uint256).max);
            launch.bid(lim[i] * 1e6 / 1e18, bud[i]);
            vm.stopBroadcast();
        }

        // WETH/USDC batch: three buyers of WETH, two sellers. Prices in USDC per WETH.
        _order(hook, key, PKS[0], true, wethIs0, 3060, 30_000e6, 0);
        _order(hook, key, PKS[1], true, wethIs0, 3015, 18_000e6, 0);
        _order(hook, key, PKS[2], true, wethIs0, 3120, 12_000e6, 0);
        _order(hook, key, PKS[3], false, wethIs0, 2950, 0, 4e18);
        _order(hook, key, PKS[4], false, wethIs0, 2990, 0, 2.5e18);
        console.log("seeded launch bids and an open WETH/USDC batch");
    }

    /// buyWeth: spend USDC for WETH with max price `usdPerWeth`; else sell WETH with min price.
    function _order(ClinchHook hook, PoolKey memory key, uint256 pk, bool buyWeth, bool wethIs0, uint256 usdPerWeth, uint128 usdc, uint128 weth)
        internal
    {
        // raw price token1 per token0, WAD
        uint256 raw = wethIs0 ? usdPerWeth * 1e6 * 1e18 / 1e18 : uint256(1e18) * 1e18 / (usdPerWeth * 1e6);
        bool zeroForOne = buyWeth ? !wethIs0 : wethIs0; // selling token0?
        vm.startBroadcast(pk);
        hook.placeOrder(key, zeroForOne, raw, buyWeth ? usdc : weth);
        vm.stopBroadcast();
    }
}
