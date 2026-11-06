// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ClinchHook} from "../src/ClinchHook.sol";
import {ClinchLaunch} from "../src/ClinchLaunch.sol";
import {ClinchLaunchFactory} from "../src/ClinchLaunchFactory.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Open a fresh launch on an existing deployment: new demo sale token, sold for the
///         deployment's demo USDC. The app finds it through factory.allLaunches().
///
/// Env: PRIVATE_KEY, DEPLOYMENTS (default ./deployments/local.json),
///      LAUNCH_SECONDS (default 14 days), RESCUE_SECONDS (default 1 day, min 60), TOKEN_NAME, TOKEN_SYMBOL.
contract CreateLaunch is Script {
    function run() external {
        string memory json = vm.readFile(vm.envOr("DEPLOYMENTS", string("./deployments/local.json")));
        ClinchLaunchFactory factory = ClinchLaunchFactory(vm.parseJsonAddress(json, ".factory"));
        address usdc = vm.parseJsonAddress(json, ".usdc");
        uint256 pk = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(pk);
        MockERC20 sale = new MockERC20(
            vm.envOr("TOKEN_NAME", string("Clinch Live Token")), vm.envOr("TOKEN_SYMBOL", string("LIVE")), 18, 1_000e18
        );

        ClinchLaunch.Params memory p;
        p.saleToken = address(sale);
        p.quoteToken = usdc;
        p.supply = 500_000e18;
        p.lpTokens = 100_000e18;
        p.lpQuoteBps = 4000;
        p.reservePrice = 0.05e18 * 1e6 / 1e18; // $0.05, USDC raw per token raw (WAD)
        p.maxPrice = 1e18 * 1e6 / 1e18; // $1.00
        p.eps = 1.5e16;
        p.endTime = uint64(block.timestamp + vm.envOr("LAUNCH_SECONDS", uint256(14 days)));
        p.rescueDelay = uint32(vm.envOr("RESCUE_SECONDS", uint256(1 days))); // factory minimum is 60
        p.maxBids = 40;
        p.minBid = 10e6;
        p.poolCfg = ClinchHook.PoolConfig({
            windowBlocks: 5,
            rescueBlocks: 1800,
            maxOrders: 32,
            maxDepthBps: 500,
            eps: 1e15,
            minOrder0: 1e6,
            minOrder1: 1e6
        });
        sale.mint(vm.addr(pk), p.supply + p.lpTokens);
        sale.approve(address(factory), p.supply + p.lpTokens);
        ClinchLaunch launch = factory.createLaunch(p);
        vm.stopBroadcast();

        console.log("sale token", address(sale));
        console.log("launch", address(launch));
        console.log("ends", p.endTime);
    }
}
