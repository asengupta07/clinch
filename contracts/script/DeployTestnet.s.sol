// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";

import {ClinchHook} from "../src/ClinchHook.sol";
import {ClinchLaunchFactory} from "../src/ClinchLaunchFactory.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Deploys Clinch against an EXISTING Uniswap v4 PoolManager (e.g. Sepolia).
///   POOL_MANAGER=0x... PRIVATE_KEY=0x... forge script script/DeployTestnet.s.sol \
///     --rpc-url $SEPOLIA_RPC --broadcast --verify
/// Take the PoolManager address from Uniswap's official deployments page for the target chain.
contract DeployTestnet is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        require(address(manager).code.length > 0, "POOL_MANAGER has no code on this chain");
        uint256 pk = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(pk);
        ClinchLaunchFactory factory = new ClinchLaunchFactory(manager);
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG;
        (address hookAddr, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, type(ClinchHook).creationCode, abi.encode(manager, address(factory)));
        ClinchHook hook = new ClinchHook{salt: salt}(manager, address(factory));
        require(address(hook) == hookAddr, "hook address mismatch");
        factory.setHook(hook);
        MockERC20 usdc = new MockERC20("Demo USD Coin", "USDC", 6, 50_000e6);
        MockERC20 weth = new MockERC20("Demo Wrapped Ether", "WETH", 18, 20e18);
        vm.stopBroadcast();

        string memory o = "deploy";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "poolManager", address(manager));
        vm.serializeAddress(o, "hook", address(hook));
        vm.serializeAddress(o, "usdc", address(usdc));
        vm.serializeAddress(o, "weth", address(weth));
        string memory json = vm.serializeAddress(o, "factory", address(factory));
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));
        console.log("hook", address(hook));
        console.log("factory", address(factory));
    }
}
