// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {PoolManager} from "v4-core/PoolManager.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";

import {ClinchHook} from "../src/ClinchHook.sol";
import {ClinchLaunch} from "../src/ClinchLaunch.sol";
import {ClinchLaunchFactory} from "../src/ClinchLaunchFactory.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Deploys the full Clinch stack to a local anvil chain and writes deployments/local.json.
///         forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
contract DeployLocal is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint256 constant DEPLOYER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80; // anvil #0

    function run() external {
        address deployer = vm.addr(DEPLOYER_PK);
        vm.startBroadcast(DEPLOYER_PK);

        IPoolManager manager = new PoolManager(deployer);
        MockERC20 usdc = new MockERC20("Demo USD Coin", "USDC", 6, 50_000e6);
        MockERC20 weth = new MockERC20("Demo Wrapped Ether", "WETH", 18, 20e18);
        MockERC20 cln = new MockERC20("Clinch Demo Token", "CLNCH", 18, 0);

        ClinchLaunchFactory factory = new ClinchLaunchFactory(manager);
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG;
        (address hookAddr, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, type(ClinchHook).creationCode, abi.encode(manager, address(factory)));
        ClinchHook hook = new ClinchHook{salt: salt}(manager, address(factory));
        require(address(hook) == hookAddr, "hook address mismatch");
        factory.setHook(hook);

        // --- WETH/USDC batch pool at 3,000 USDC per WETH
        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(manager);
        PoolKey memory swapKey = _key(address(weth), address(usdc), hook, 60);
        bool wethIs0 = Currency.unwrap(swapKey.currency0) == address(weth);
        // price in raw units, token1 per token0, WAD: 3000 USDC (6 dp) per WETH (18 dp) = 3000e6 / 1e18
        uint256 priceRaw = wethIs0 ? 3000e6 * 1e18 / 1e18 : uint256(1e18) * 1e18 / 3000e6;
        uint160 sqrtP = uint160(FixedPointMathLib.sqrt(FixedPointMathLib.mulDivDown(priceRaw, 1 << 192, 1e18)));
        hook.initializePool(swapKey, sqrtP, _swapCfg(wethIs0));
        weth.mint(deployer, 1_000e18);
        usdc.mint(deployer, 3_000_000e6);
        weth.approve(address(lpRouter), type(uint256).max);
        usdc.approve(address(lpRouter), type(uint256).max);
        // L = sqrt(x * y) for 1,000 WETH and 3,000,000 USDC (raw units)
        uint256 L = FixedPointMathLib.sqrt(uint256(1_000e18) * 3_000_000e6) * 999 / 1000;
        int24 lo = (TickMath.MIN_TICK / 60) * 60;
        int24 hi = (TickMath.MAX_TICK / 60) * 60;
        lpRouter.modifyLiquidity(swapKey, ModifyLiquidityParams(lo, hi, int256(L), 0), "");

        // --- a live launch: 1,000,000 CLNCH for USDC, reserve $0.10, ceiling $2.00
        ClinchLaunch.Params memory p;
        p.saleToken = address(cln);
        p.quoteToken = address(usdc);
        p.supply = 1_000_000e18;
        p.lpTokens = 250_000e18;
        p.lpQuoteBps = 4000;
        p.reservePrice = _rawPrice(0.10e18, 6, 18); // USDC raw per CLNCH raw, WAD
        p.maxPrice = _rawPrice(2e18, 6, 18);
        p.eps = 1.5e16; // keeps (steps x bids) under the factory's MAX_WORK for a 20x price range
        p.endTime = uint64(block.timestamp + vm.envOr("LAUNCH_SECONDS", uint256(15 minutes)));
        p.rescueDelay = 10 minutes;
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
        cln.mint(deployer, p.supply + p.lpTokens);
        cln.approve(address(factory), type(uint256).max);
        ClinchLaunch launch = factory.createLaunch(p);

        vm.stopBroadcast();

        string memory o = "deploy";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "poolManager", address(manager));
        vm.serializeAddress(o, "hook", address(hook));
        vm.serializeAddress(o, "factory", address(factory));
        vm.serializeAddress(o, "launch", address(launch));
        vm.serializeAddress(o, "usdc", address(usdc));
        vm.serializeAddress(o, "weth", address(weth));
        vm.serializeAddress(o, "clnch", address(cln));
        vm.serializeAddress(o, "swapCurrency0", Currency.unwrap(swapKey.currency0));
        vm.serializeAddress(o, "swapCurrency1", Currency.unwrap(swapKey.currency1));
        vm.serializeInt(o, "swapTickSpacing", swapKey.tickSpacing);
        string memory json = vm.serializeUint(o, "deployBlock", block.number);
        vm.writeJson(json, "./deployments/local.json");
        console.log("hook", address(hook));
        console.log("launch", address(launch));
    }

    function _key(address a, address b, ClinchHook hook, int24 sp) internal pure returns (PoolKey memory) {
        (address c0, address c1) = a < b ? (a, b) : (b, a);
        return PoolKey(Currency.wrap(c0), Currency.wrap(c1), 0, sp, IHooks(address(hook)));
    }

    function _swapCfg(bool wethIs0) internal pure returns (ClinchHook.PoolConfig memory c) {
        c.windowBlocks = 5;
        c.rescueBlocks = 1800;
        c.maxOrders = 32;
        c.maxDepthBps = 500;
        c.eps = 1e15;
        (c.minOrder0, c.minOrder1) = wethIs0 ? (uint128(0.001e18), uint128(1e6)) : (uint128(1e6), uint128(0.001e18));
    }

    /// human price (WAD) -> raw quote units per raw sale unit (WAD)
    function _rawPrice(uint256 humanWad, uint8 quoteDec, uint8 saleDec) internal pure returns (uint256) {
        return humanWad * (10 ** quoteDec) / (10 ** saleDec);
    }
}
