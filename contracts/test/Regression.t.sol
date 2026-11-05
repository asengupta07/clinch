// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {ClinchHook} from "../src/ClinchHook.sol";
import {ClinchEngine} from "../src/libraries/ClinchEngine.sol";
import {ClinchFixture} from "./utils/ClinchFixture.sol";

contract RegressionHook is ClinchFixture {
    using StateLibrary for *;
    using PoolIdLibrary for PoolKey;

    PoolKey k;
    uint256 constant L = 1_414_213_562_373_095_048_801_688;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        _deployClinch();
        k = _key(60);
        hook.initializePool(k, _sqrtP(2e18), _cfg());
        _addFullRange(k, L);
        _fund(alice, 1e30, 1e30);
        _fund(bob, 1e30, 1e30);
    }

    function _settleNext() internal returns (uint64) {
        ClinchHook.PoolState memory ps = hook.poolState(k);
        ClinchHook.Batch memory b = hook.getBatch(k, ps.nextToSettle);
        if (block.number < b.endBlock) vm.roll(b.endBlock);
        return hook.settle(k);
    }


    // Depth cap bypass by temporary liquidity: the oversized batch is auto-cancelled at settle, never bricked.
    function test_R_DepthBypassByTempLiquidityCancels() public {
        _addFullRange(k, L * 100);
        vm.prank(alice);
        hook.placeOrder(k, false, type(uint128).max, 5_000_000e18); // 250% of real r1
        (int24 lo, int24 hi) = _fullRange(k);
        modifyLiquidityRouter.modifyLiquidity(
            k, ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: -int256(L * 100), salt: 0}), ""
        );
        vm.roll(hook.getBatch(k, 1).endBlock);
        uint256 g = gasleft();
        hook.settle(k);
        assertLt(g - gasleft(), 200_000, "cancel path must be cheap");
        assertEq(uint8(hook.getBatch(k, 1).status), uint8(ClinchHook.Status.Cancelled));
        uint256 before = token1.balanceOf(alice);
        hook.claim(k, 1, 0);
        assertEq(token1.balanceOf(alice) - before, 5_000_000e18);
    }




    // Fuzz conservation incl. tiny / near-spot orders, over two batches, checking that claims never revert
    // and nothing material remains in the hook.
    function testFuzz_Conservation2(uint256 seed) public {
        address[2] memory us = [alice, bob];
        for (uint256 batch; batch < 2; ++batch) {
            uint256 n = 1 + seed % 12;
            for (uint256 i; i < n; ++i) {
                uint256 r = uint256(keccak256(abi.encode(seed, batch, i)));
                bool sell = (r & 1) == 1;
                uint256 mode = (r >> 8) % 4;
                uint128 bud = mode == 0 ? uint128(1e15 + (r >> 16) % 1e16) : uint128(1e18 + (r >> 16) % 9_000e18);
                (uint256 r0, uint256 r1) = hook.reserves(k);
                uint256 spot = r1 * 1e18 / r0;
                uint256 lim = sell ? spot * (990 + (r >> 100) % 20) / 1000 : spot * (995 + (r >> 100) % 20) / 1000;
                if ((r >> 120) % 5 == 0) lim = sell ? 0 : type(uint128).max;
                vm.prank(us[i % 2]);
                try hook.placeOrder(k, sell, lim, bud) {} catch {}
            }
            if (hook.poolState(k).currentBatch <= batch) continue;
            uint64 id = _settleNext();
            ClinchHook.Order[] memory os = hook.getOrders(k, id);
            for (uint256 i; i < os.length; ++i) hook.claim(k, id, i);
            assertLe(token0.balanceOf(address(hook)), 1e6, "t0 left");
            assertLe(token1.balanceOf(address(hook)), 1e6, "t1 left");
        }
    }
}

import {ClinchLaunchTest} from "./ClinchLaunch.t.sol";
import {ClinchLaunch} from "../src/ClinchLaunch.sol";
import {ClinchLaunchFactory} from "../src/ClinchLaunchFactory.sol";

contract RegressionLaunch is ClinchLaunchTest {
    // Former PoCs: configs whose settle could not fit in a block, or could never seed the pool, are rejected up front.
    function test_R_FactoryRejectsUnsettleableConfigs() public {
        _setTokens(true);
        sale.mint(issuer, 1e30);
        vm.startPrank(issuer);
        sale.approve(address(factory), type(uint256).max);
        ClinchLaunch.Params memory p = _params();
        p.maxBids = 200;
        p.eps = 1e15; // 200 bids x ~2,300 steps
        vm.expectRevert(ClinchLaunchFactory.InvalidParams.selector);
        factory.createLaunch(p);
        p = _params();
        p.eps = 1e14; // ladder alone exceeds the work bound
        vm.expectRevert(ClinchLaunchFactory.InvalidParams.selector);
        factory.createLaunch(p);
        p = _params();
        p.poolCfg.rescueBlocks = 0; // would make settle's pool initialization revert
        vm.expectRevert(ClinchLaunchFactory.InvalidParams.selector);
        factory.createLaunch(p);
        vm.stopPrank();
    }

    /// KNOWN LIMITATION (README): bid slots can be filled with minimum bids. Mitigated by minBid sizing,
    /// not prevented. This test documents the behaviour.
    function test_KnownLimitation_BidSlotGriefing() public {
        _setTokens(true);
        ClinchLaunch l = _create(_params()); // maxBids 40, minBid 1e18
        for (uint256 i; i < 40; ++i) _bid(l, users[5], 0.1e18, 1e18); // 40 quote tokens total
        quote.mint(users[0], 100_000e18);
        vm.startPrank(users[0]);
        quote.approve(address(l), type(uint256).max);
        vm.expectRevert(ClinchLaunch.TooManyBids.selector);
        l.bid(0.5e18, 100_000e18);
        vm.stopPrank();
    }
}

import {Test} from "forge-std/Test.sol";

contract RegressionEngine is Test {
    uint256 constant WAD = 1e18;

    function testFuzz_Z_MinorityShortfall(uint256 seed, uint8 nn, uint256 r0, uint256 r1, uint64 eps) public pure {
        r0 = bound(r0, 1e18, 1e27);
        r1 = bound(r1, 1e18, 1e27);
        eps = uint64(bound(eps, 1e14, 5e16));
        uint256 n = bound(nn, 1, 12);
        ClinchEngine.Order[] memory os = new ClinchEngine.Order[](n);
        uint256 p0 = r1 * WAD / r0;
        uint256 q0 = r0 * WAD / r1;
        for (uint256 i; i < n; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            bool sell = r & 1 == 1;
            uint256 cap = (sell ? r0 : r1) / 20 / n;
            uint256 bud = 1 + (r >> 8) % cap;
            uint256 lim = sell ? p0 * (900 + (r >> 80) % 101) / 1000 : p0 * (1000 + (r >> 80) % 200) / 1000;
            os[i] = ClinchEngine.Order({zeroForOne: sell, limit: lim, budget: bud});
        }
        ClinchEngine.TwoSided memory t = ClinchEngine.twoSided(os, r0, r1, ClinchEngine.Params({eps: eps, pMax: 0, maxSteps: 4000}));
        // expected (untrimmed) minority payouts vs actually assigned
        uint256 expected;
        uint256 got;
        for (uint256 i; i < n; ++i) {
            bool isBuy = !os[i].zeroForOne;
            if (isBuy == t.buyersDominant) continue;
            if (t.spent[i] == 0) continue;
            expected += isBuy ? os[i].budget * q0 / WAD : os[i].budget * p0 / WAD;
            got += t.received[i];
        }
        assertLe(expected - got, n + 2, "minority trimmed by more than dust");
        if (t.dominantBought <= t.minoritySupply) {
            assertLe(t.poolIn, n + t.steps + 2, "dominant paid into hook with no swap");
        }
    }
}

contract RegressionSmallPool is ClinchFixture {
    function testFuzz_Z_SmallReservesSettle(uint256 seed, uint256 liq, uint256 price) public {
        _deployClinch();
        liq = bound(liq, 3.2e10, 1e14); // reserves just above the 1e9 floor for price up to 1e3
        price = bound(price, 1e15, 1e21);
        PoolKey memory k = _key(60);
        ClinchHook.PoolConfig memory c = _cfg();
        c.minOrder0 = 1; c.minOrder1 = 1; c.maxDepthBps = 500; c.eps = 1e15;
        hook.initializePool(k, _sqrtP(price), c);
        _addFullRange(k, liq);
        address u = makeAddr("u");
        _fund(u, 1e30, 1e30);
        (uint256 r0, uint256 r1) = hook.reserves(k);
        uint256 n = 1 + seed % 8;
        for (uint256 i; i < n; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            bool sell = r & 1 == 1;
            uint256 cap = (sell ? r0 : r1) / 21 / n; // within the 5% depth cap
            if (cap == 0) continue;
            uint128 bud = uint128(1 + (r >> 8) % cap);
            vm.prank(u);
            hook.placeOrder(k, sell, sell ? 0 : type(uint128).max, bud);
        }
        if (hook.poolState(k).currentBatch == 0) return;
        vm.roll(hook.getBatch(k, 1).endBlock);
        hook.settle(k);
        ClinchHook.Order[] memory os = hook.getOrders(k, 1);
        for (uint256 i; i < os.length; ++i) hook.claim(k, 1, i);
    }
}

contract RegressionSmallPoolRepro is RegressionSmallPool {
    function test_Z_Repro() public {
        testFuzz_Z_SmallReservesSettle(15540266, 3.2e10, 4455113904197046625237993217086034472821942037821258);
    }
}

contract RegressionNearTie is RegressionHook {
    function testFuzz_Z_NearTie(uint256 b1, uint256 delta) public {
        b1 = bound(b1, 1e18, 90_000e18);
        delta = bound(delta, 1, 1e7);
        vm.prank(alice);
        hook.placeOrder(k, false, type(uint128).max, uint128(b1));
        // seller supplies slightly less token0 than buyer demands at spot
        (uint256 r0, uint256 r1) = hook.reserves(k);
        uint256 dBuy = b1 * 1e18 / (r1 * 1e18 / r0);
        if (dBuy <= delta) return;
        vm.prank(bob);
        hook.placeOrder(k, true, 0, uint128(dBuy - delta));
        vm.roll(hook.getBatch(k, 1).endBlock);
        hook.settle(k);
    }
}

contract RegressionUsdcPool is ClinchFixture {
    // token0: 18-dec $1 token, token1: 6-dec USDC -> raw price 1e-12 (WAD 1e6)
    function testFuzz_Z_UsdcPool(uint256 liq, uint256 b1, uint256 frac, bool sellDom) public {
        _deployClinch();
        liq = bound(liq, 1e15, 1e19); // r1 = $1k .. $10M
        PoolKey memory k = _key(60);
        ClinchHook.PoolConfig memory c = _cfg();
        c.minOrder0 = 1; c.minOrder1 = 1; c.maxDepthBps = 500;
        hook.initializePool(k, uint160(79228162514264337593543950), c); // sqrt(1e-12)*2^96
        _addFullRange(k, liq);
        address u = makeAddr("u");
        _fund(u, 1e30, 1e30);
        (uint256 r0, uint256 r1) = hook.reserves(k);
        b1 = bound(b1, 1, r1 / 21);
        frac = bound(frac, 990_000, 1_010_000);
        vm.startPrank(u);
        hook.placeOrder(k, false, type(uint128).max, uint128(b1));
        uint256 s = b1 * r0 / r1 * frac / 1_000_000;
        if (s > 0 && s < r0 / 21) hook.placeOrder(k, true, 0, uint128(s));
        vm.stopPrank();
        vm.roll(hook.getBatch(k, 1).endBlock);
        hook.settle(k);
    }
}
