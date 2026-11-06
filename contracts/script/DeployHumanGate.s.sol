// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ERC20} from "solmate/src/tokens/ERC20.sol";
import {ClinchHook} from "../src/ClinchHook.sol";
import {ClinchLaunch} from "../src/ClinchLaunch.sol";
import {ClinchLaunchFactory} from "../src/ClinchLaunchFactory.sol";
import {AttestedWorldID, HumanGate, IWorldID, MockWorldID} from "../src/HumanGate.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice The World ID comparison arm on an existing deployment: a HumanGate over the demo USDC
///         and a launch that sells for hUSDC, so only verified humans can bid, up to CAP each.
///         Adds humanGate, humanLaunch and worldId to the deployments JSON.
///
/// Env: PRIVATE_KEY, DEPLOYMENTS (default ./deployments/local.json),
///      WORLD_ID (router address), or WORLD_ATTESTER (deploy AttestedWorldID for portal-verified
///      World ID 4.0 proofs; see app/server/world.ts), or neither (MockWorldID), WORLD_APP_ID, WORLD_ACTION,
///      CAP (default 2,000 USDC), LAUNCH_SECONDS (default 14 days).
contract DeployHumanGate is Script {
    function run() external {
        string memory path = vm.envOr("DEPLOYMENTS", string("./deployments/local.json"));
        string memory json = vm.readFile(path);
        ClinchLaunchFactory factory = ClinchLaunchFactory(vm.parseJsonAddress(json, ".factory"));
        address usdc = vm.parseJsonAddress(json, ".usdc");
        address manager = vm.parseJsonAddress(json, ".poolManager");
        address hook = vm.parseJsonAddress(json, ".hook");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);

        vm.startBroadcast(pk);
        address worldId = vm.envOr("WORLD_ID", address(0));
        address attester = vm.envOr("WORLD_ATTESTER", address(0));
        if (worldId == address(0)) worldId = attester != address(0) ? address(new AttestedWorldID(attester)) : address(new MockWorldID());
        HumanGate gate = new HumanGate(
            IWorldID(worldId),
            ERC20(usdc),
            vm.envOr("WORLD_APP_ID", string("app_clinch_demo")),
            vm.envOr("WORLD_ACTION", string("clinch-human-launch")),
            vm.envOr("CAP", uint256(2_000e6))
        );
        gate.setVenue(manager, true);
        gate.setVenue(hook, true);

        MockERC20 sale = new MockERC20("Clinch Human Token", "HUMAN", 18, 1_000e18);
        ClinchLaunch.Params memory p;
        p.saleToken = address(sale);
        p.quoteToken = address(gate);
        p.supply = 500_000e18;
        p.lpTokens = 100_000e18;
        p.lpQuoteBps = 4000;
        p.reservePrice = 0.05e18 * 1e6 / 1e18;
        p.maxPrice = 1e18 * 1e6 / 1e18;
        p.eps = 1.5e16;
        p.endTime = uint64(block.timestamp + vm.envOr("LAUNCH_SECONDS", uint256(14 days)));
        p.rescueDelay = 1 days;
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
        sale.mint(me, p.supply + p.lpTokens);
        sale.approve(address(factory), p.supply + p.lpTokens);
        // the launch is created with CREATE from the factory, so its address is known in advance
        address predicted = vm.computeCreateAddress(address(factory), vm.getNonce(address(factory)));
        gate.setVenue(predicted, true);
        ClinchLaunch launch = factory.createLaunch(p);
        require(address(launch) == predicted, "launch address mismatch");
        vm.stopBroadcast();

        string memory o = "deployments";
        vm.serializeJson(o, json);
        vm.serializeAddress(o, "humanGate", address(gate));
        vm.serializeAddress(o, "humanLaunch", address(launch));
        vm.writeJson(vm.serializeAddress(o, "worldId", worldId), path);
        console.log("worldId", worldId);
        console.log("humanGate", address(gate));
        console.log("humanLaunch", address(launch));
        console.log("sale token", address(sale));
    }
}
