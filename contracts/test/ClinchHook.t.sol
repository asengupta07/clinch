// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {ModifyLiquidityParams} from "v4-core/types/PoolOperation.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";

import {ClinchHook} from "../src/ClinchHook.sol";
import {ClinchFixture} from "./utils/ClinchFixture.sol";

contract ClinchHookTest is ClinchFixture {
    using StateLibrary for *;
    using PoolIdLibrary for PoolKey;

    PoolKey k;
    uint256 constant L = 1_414_213_562_373_095_048_801_688; // ~ sqrt(2) * 1e6 * 1e18 -> r0 ~ 1e6, r1 ~ 2e6 at p = 2

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");
    address eve = makeAddr("eve");

    function setUp() public {
        _deployClinch();
        k = _key(60);
        hook.initializePool(k, _sqrtP(2e18), _cfg());
        _addFullRange(k, L);
        _fund(alice, 1e24, 1e24);
        _fund(bob, 1e24, 1e24);
        _fund(carol, 1e24, 1e24);
        _fund(dave, 1e24, 1e24);
        _fund(eve, 1e24, 1e24);
    }

    // ------------------------------------------------------------------ helpers

    function _order(address who, bool zeroForOne, uint256 limit, uint128 budget) internal returns (uint64 b, uint256 i) {
        vm.prank(who);
        return hook.placeOrder(k, zeroForOne, limit, budget);
    }

    function _closeAndSettle() internal returns (uint64 id) {
        ClinchHook.PoolState memory ps = hook.poolState(k);
        ClinchHook.Batch memory b = hook.getBatch(k, ps.nextToSettle);
        if (block.number < b.endBlock) vm.roll(b.endBlock);
        id = hook.settle(k);
    }

    function _claimAll(uint64 id) internal {
        ClinchHook.Order[] memory os = hook.getOrders(k, id);
        for (uint256 i; i < os.length; ++i) {
            hook.claim(k, id, i);
        }
    }

    function _k() internal view returns (uint256 r0, uint256 r1, uint256 sqrtP) {
        (r0, r1) = hook.reserves(k);
        (uint160 s,,,) = manager.getSlot0(k.toId());
        sqrtP = s;
    }

    /// The pool only ever moves along its curve (v4 swap math, liquidity unchanged by settlement).
    function _assertCurve(uint256 sqrtBefore, bool buyersDominant) internal view {
        assertEq(manager.getLiquidity(k.toId()), L, "liquidity changed");
        (,, uint256 sqrtAfter) = _k();
        if (buyersDominant) assertGe(sqrtAfter, sqrtBefore, "price fell on net buying");
        else assertLe(sqrtAfter, sqrtBefore, "price rose on net selling");
    }

    // ------------------------------------------------------------------ pool rules

    function test_Reserves() public view {
        (uint256 r0, uint256 r1) = hook.reserves(k);
        assertApproxEqRel(r0, 1_000_000e18, 1e12);
        assertApproxEqRel(r1, 2_000_000e18, 1e12);
        assertApproxEqRel(hook.spotPrice(k), 2e18, 1e12);
    }

    function test_DirectSwapReverts() public {
        vm.expectRevert();
        swap(k, true, -1e18, "");
        vm.expectRevert();
        swap(k, false, -1e18, "");
    }

    function test_NonFullRangeReverts() public {
        vm.expectRevert();
        modifyLiquidityRouter.modifyLiquidity(
            k, ModifyLiquidityParams({tickLower: -600, tickUpper: 600, liquidityDelta: 1e18, salt: 0}), ""
        );
    }

    function test_RemoveLiquidityAllowed() public {
        (int24 lo, int24 hi) = _fullRange(k);
        modifyLiquidityRouter.modifyLiquidity(
            k, ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: -1e18, salt: 0}), ""
        );
    }

    function test_InitializeOnlyThroughHook() public {
        PoolKey memory k2 = _key(30);
        vm.expectRevert();
        manager.initialize(k2, _sqrtP(1e18));
        hook.initializePool(k2, _sqrtP(1e18), _cfg());
    }

    function test_FeeMustBeZero() public {
        PoolKey memory k2 = PoolKey(currency0, currency1, 3000, 60, IHooks(address(hook)));
        vm.expectRevert(ClinchHook.InvalidPool.selector);
        hook.initializePool(k2, _sqrtP(1e18), _cfg());
    }

    function test_BadConfigRejected() public {
        ClinchHook.PoolConfig memory c = _cfg();
        c.maxOrders = 65;
        vm.expectRevert(ClinchHook.InvalidConfig.selector);
        hook.initializePool(_key(30), _sqrtP(1e18), c);
    }

    function test_ReservedPoolOnlyReserver() public {
        PoolKey memory k2 = _key(61);
        vm.prank(address(factory));
        hook.reservePool(k2, alice);
        vm.expectRevert(abi.encodeWithSelector(ClinchHook.PoolReservedFor.selector, alice));
        hook.initializePool(k2, _sqrtP(1e18), _cfg());
        vm.prank(alice);
        hook.initializePool(k2, _sqrtP(1e18), _cfg());
    }

    function test_ReserveOnlyFactory() public {
        vm.expectRevert(ClinchHook.NotFactory.selector);
        hook.reservePool(_key(61), alice);
    }

    // ------------------------------------------------------------------ order validation

    function test_OrderValidation() public {
        vm.prank(alice);
        vm.expectRevert(ClinchHook.OrderTooSmall.selector);
        hook.placeOrder(k, false, 3e18, 1);
        vm.prank(alice);
        vm.expectRevert(ClinchHook.InvalidLimit.selector);
        hook.placeOrder(k, false, 0, 1e18);
        // depth cap: 5% of r1 (2e6) = 1e5 token1
        vm.prank(alice);
        vm.expectRevert(ClinchHook.DepthExceeded.selector);
        hook.placeOrder(k, false, 3e18, 100_001e18);
        _order(alice, false, 3e18, 99_000e18);
        vm.prank(bob);
        vm.expectRevert(ClinchHook.DepthExceeded.selector);
        hook.placeOrder(k, false, 3e18, 2_000e18);
    }

    function test_MaxOrders() public {
        for (uint256 i; i < 32; ++i) {
            _order(alice, false, 3e18, 1e18);
        }
        vm.prank(alice);
        vm.expectRevert(ClinchHook.BatchFull.selector);
        hook.placeOrder(k, false, 3e18, 1e18);
    }

    function test_SettleBeforeCloseReverts() public {
        _order(alice, false, 3e18, 1000e18);
        vm.expectRevert(ClinchHook.BatchNotClosed.selector);
        hook.settle(k);
    }

    function test_SettleNothingReverts() public {
        vm.expectRevert(ClinchHook.NothingToSettle.selector);
        hook.settle(k);
    }

    function test_ClaimBeforeSettleReverts() public {
        (uint64 b, uint256 i) = _order(alice, false, 3e18, 1000e18);
        vm.expectRevert(ClinchHook.NotFinal.selector);
        hook.claim(k, b, i);
    }

    // ------------------------------------------------------------------ one-sided buyers

    function test_BuyersSettleAndClaim() public {
        (,, uint256 s0) = _k();
        _order(alice, false, 2.2e18, 20_000e18);
        _order(bob, false, 2.5e18, 30_000e18);
        _order(carol, false, 2.05e18, 10_000e18);
        uint256 a0 = token0.balanceOf(alice);
        uint256 a1 = token1.balanceOf(alice);
        uint64 id = _closeAndSettle();
        _claimAll(id);

        _assertCurve(s0, true);
        (uint256 r0, uint256 r1,) = _k();
        assertLt(r0, 1_000_000e18);
        assertGt(r1, 2_000_000e18);

        // each buyer: avg price within [spot, limit]
        ClinchHook.Order[] memory os = hook.getOrders(k, id);
        for (uint256 i; i < os.length; ++i) {
            assertTrue(os[i].claimed);
            if (os[i].spent == 0) continue;
            assertLe(uint256(os[i].spent) * 1e18, os[i].limit * os[i].received + 1e30, "above limit");
        }
        // alice got token0 and her refund
        uint256 got0 = token0.balanceOf(alice) - a0;
        uint256 back1 = token1.balanceOf(alice) - a1;
        assertGt(got0, 0);
        assertEq(back1, 20_000e18 - os[0].spent);
        _assertHookDust();
    }

    function test_RebateIsNonNegative() public {
        _order(alice, false, 2.4e18, 40_000e18);
        _order(bob, false, 2.4e18, 40_000e18);
        uint64 id = _closeAndSettle();
        ClinchHook.Batch memory b = hook.getBatch(k, id);
        assertGe(b.availNum, b.availDen, "rebate factor below 1");
        (, uint256 proceeds) = hook.claimable(k, id, 0);
        ClinchHook.Order[] memory os = hook.getOrders(k, id);
        assertGe(proceeds, os[0].received);
    }

    function test_NonMarketableOrdersRejected() public {
        vm.prank(alice);
        vm.expectRevert(ClinchHook.OrderNotMarketable.selector);
        hook.placeOrder(k, false, 1.5e18, 1000e18); // buyer max below spot
        vm.prank(alice);
        vm.expectRevert(ClinchHook.OrderNotMarketable.selector);
        hook.placeOrder(k, true, 2.5e18, 1000e18); // seller min above spot
    }

    /// An order that was marketable when placed but is out of the money at settlement is refunded in full.
    function test_IneligibleAtSettleFullyRefunded() public {
        (uint64 id, uint256 i) = _order(alice, false, 2.0001e18, 1000e18);
        // someone else removes most liquidity? no: move the price instead by a prior batch
        uint256 before = token1.balanceOf(alice);
        _order(bob, false, 3e18, 90_000e18); // big buyer pushes the clearing price above alice's max
        _closeAndSettle();
        hook.claim(k, id, i);
        (uint256 got1) = token1.balanceOf(alice) - before;
        assertGt(got1, 0, "alice refunded something");
        vm.expectRevert(ClinchHook.AlreadyClaimed.selector);
        hook.claim(k, id, i);
    }

    function test_LiquidityRemovalAutoCancels() public {
        (uint64 id,) = _order(alice, false, type(uint128).max, 99_000e18);
        (int24 lo, int24 hi) = _fullRange(k);
        modifyLiquidityRouter.modifyLiquidity(
            k, ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: -int256(L * 999 / 1000), salt: 0}), ""
        );
        uint256 before = token1.balanceOf(alice);
        vm.roll(hook.getBatch(k, id).endBlock);
        hook.settle(k); // must not revert: cancels instead
        assertEq(uint8(hook.getBatch(k, id).status), uint8(ClinchHook.Status.Cancelled));
        hook.claim(k, id, 0);
        assertEq(token1.balanceOf(alice) - before, 99_000e18);
        // the queue moves on
        (uint64 id2,) = _order(bob, false, type(uint128).max, 50e18);
        vm.roll(hook.getBatch(k, id2).endBlock);
        assertEq(hook.settle(k), id2);
    }

    function test_ProtocolFeeDoesNotBrick() public {
        manager.setProtocolFeeController(address(this)); // Deployers makes this test the owner
        manager.setProtocolFee(k, (100 << 12) | 100);
        _order(alice, false, 3e18, 20_000e18);
        _closeAndSettle();
    }

    function test_PriceOutOfRangeRejected() public {
        vm.expectRevert(ClinchHook.PriceOutOfRange.selector);
        hook.initializePool(_key(30), uint160(1 << 40), _cfg());
    }

    function test_ClaimByThirdPartyPaysOwner() public {
        (uint64 id, uint256 i) = _order(alice, false, 3e18, 1000e18);
        _closeAndSettle();
        uint256 before = token0.balanceOf(alice);
        vm.prank(eve);
        hook.claim(k, id, i);
        assertGt(token0.balanceOf(alice), before);
    }

    // ------------------------------------------------------------------ two-sided

    function test_SellersDominant() public {
        (,, uint256 s0) = _k();
        _order(alice, true, 1.8e18, 20_000e18); // sell token0, min 1.8
        _order(bob, true, 1.5e18, 15_000e18);
        _order(carol, false, 2.5e18, 10_000e18); // buyer: 5k token0 at spot
        uint64 id = _closeAndSettle();
        ClinchHook.Batch memory b = hook.getBatch(k, id);
        assertFalse(b.buyersDominant);
        _claimAll(id);
        _assertCurve(s0, false);
        ClinchHook.Order[] memory os = hook.getOrders(k, id);
        // minority buyer filled in full at spot: 10k token1 -> ~5k token0
        assertEq(os[2].spent, 10_000e18);
        assertApproxEqRel(os[2].received, 5_000e18, 1e12);
        // sellers receive at least their minimum
        for (uint256 i; i < 2; ++i) {
            if (os[i].spent == 0) continue;
            (, uint256 pr) = (0, uint256(os[i].received));
            assertGe(pr * 1e18 + 1e30, os[i].limit * os[i].spent, "seller below min");
        }
        _assertHookDust();
    }

    function test_TieNoPoolTrade() public {
        (uint256 r0a, uint256 r1a,) = _k();
        _order(alice, false, 3e18, 2_000e18); // buys 1000 token0 at spot 2
        _order(bob, true, 1e18, 1_000e18); // sells 1000 token0
        uint64 id = _closeAndSettle();
        _claimAll(id);
        (uint256 r0b, uint256 r1b,) = _k();
        assertApproxEqAbs(r0a, r0b, 1e6, "pool moved on a tie");
        assertApproxEqAbs(r1a, r1b, 1e6);
    }

    // ------------------------------------------------------------------ batches

    function test_BatchRollingAndSequentialSettle() public {
        (uint64 b1,) = _order(alice, false, 3e18, 1000e18);
        uint64 end1 = hook.getBatch(k, b1).endBlock;
        vm.roll(end1);
        (uint64 b2,) = _order(bob, false, 3e18, 1000e18);
        assertEq(b2, b1 + 1);
        assertEq(hook.settle(k), b1);
        vm.expectRevert(ClinchHook.BatchNotClosed.selector);
        hook.settle(k);
        vm.roll(hook.getBatch(k, b2).endBlock);
        assertEq(hook.settle(k), b2);
    }

    function test_CancelStuckRefundsEverything() public {
        (uint64 id,) = _order(alice, false, 3e18, 1000e18);
        _order(bob, true, 1e18, 400e18);
        uint64 end = hook.getBatch(k, id).endBlock;
        vm.roll(end + 49);
        vm.expectRevert(ClinchHook.RescueNotReady.selector);
        hook.cancelStuck(k);
        vm.roll(end + 50);
        uint256 a = token1.balanceOf(alice);
        uint256 bb = token0.balanceOf(bob);
        hook.cancelStuck(k);
        _claimAll(id);
        assertEq(token1.balanceOf(alice) - a, 1000e18);
        assertEq(token0.balanceOf(bob) - bb, 400e18);
        vm.expectRevert(ClinchHook.NothingToSettle.selector);
        hook.settle(k);
    }

    // ------------------------------------------------------------------ incentives on the live hook

    /// Splitting a buyer across wallets never beats one honest order (Thm 6.6), on the real pool.
    function test_SybilSplitDoesNotHelp() public {
        uint256 V = 2.3e18;
        uint128 Q = 40_000e18;
        uint256 snap = vm.snapshotState();
        _order(bob, false, 2.6e18, 30_000e18);
        _order(carol, true, 1.7e18, 8_000e18);
        _order(alice, false, V, Q);
        uint64 id = _closeAndSettle();
        (uint256 ref, uint256 got) = hook.claimable(k, id, 2);
        int256 uTruth = int256(got * V / 1e18) - int256(uint256(Q) - ref);
        vm.revertToState(snap);

        _order(bob, false, 2.6e18, 30_000e18);
        _order(carol, true, 1.7e18, 8_000e18);
        uint128[4] memory qs = [uint128(5_000e18), 15_000e18, 12_000e18, 8_000e18];
        uint256[4] memory vs = [uint256(2.25e18), 2.5e18, 2.05e18, 3e18];
        for (uint256 i; i < 4; ++i) {
            _order(alice, false, vs[i], qs[i]);
        }
        id = _closeAndSettle();
        uint256 totGot;
        uint256 totSpent;
        for (uint256 i = 2; i < 6; ++i) {
            (uint256 r, uint256 g) = hook.claimable(k, id, i);
            totGot += g;
            totSpent += qs[i - 2] - r;
        }
        int256 uSybil = int256(totGot * V / 1e18) - int256(totSpent);
        assertLe(uSybil, uTruth + int256(uint256(Q) / 1000), "split beat truthful by more than eps");
    }

    /// Sandwich / free lunch: a bot wrapping a victim with buy and sell identities ends with a net loss
    /// in at least one token (Fact 2.9).
    function test_SandwichBotNoFreeLunch() public {
        uint256 b0 = token0.balanceOf(eve);
        uint256 b1 = token1.balanceOf(eve);
        _order(eve, false, 2.2e18, 20_000e18); // front-run style buy
        _order(alice, false, 2.1e18, 20_000e18); // victim
        _order(eve, true, 1.99e18, 9_000e18); // back-run style sell
        uint64 id = _closeAndSettle();
        _claimAll(id);
        int256 d0 = int256(token0.balanceOf(eve)) - int256(b0);
        int256 d1 = int256(token1.balanceOf(eve)) - int256(b1);
        assertFalse(d0 >= 0 && d1 >= 0 && (d0 > 0 || d1 > 0), "free lunch");
    }

    // ------------------------------------------------------------------ fuzz: conservation on the real pool

    function testFuzz_HookConservation(uint256 seed, uint8 nb, uint8 ns) public {
        uint256 nB = bound(nb, 0, 10);
        uint256 nS = bound(ns, 0, 10);
        vm.assume(nB + nS > 0);
        (,, uint256 s0) = _k();
        address[5] memory users = [alice, bob, carol, dave, eve];
        uint256 sum0;
        uint256 sum1;
        for (uint256 i; i < nB + nS; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            bool sell = i >= nB;
            uint128 bud = uint128((sell ? 49_000e18 : 98_000e18) / 10 * (1 + (r >> 128) % 100) / 100);
            if (sell) {
                if (sum0 + bud > 49_000e18) continue;
                sum0 += bud;
                _order(users[i % 5], true, 2e18 * (500 + r % 499) / 1000, bud); // min below spot
            } else {
                if (sum1 + bud > 98_000e18) continue;
                sum1 += bud;
                _order(users[i % 5], false, 2e18 * (1001 + r % 1500) / 1000, bud); // max above spot
            }
        }
        if (hook.poolState(k).currentBatch == 0) return;
        uint64 id = _closeAndSettle();
        _claimAll(id);
        _assertCurve(s0, hook.getBatch(k, id).buyersDominant);
        _assertHookDust();
    }

    function _assertHookDust() internal view {
        // everything escrowed has been paid out except rounding dust
        assertLe(token0.balanceOf(address(hook)), 1e9, "token0 stuck in hook");
        assertLe(token1.balanceOf(address(hook)), 1e9, "token1 stuck in hook");
    }

    // ------------------------------------------------------------------ gas

    function test_Gas_Settle32Orders() public {
        for (uint256 i; i < 32; ++i) {
            bool sell = i % 3 == 0;
            uint128 bud = sell ? 1_500e18 : 3_000e18;
            uint256 lim = sell ? 2e18 * (800 + i * 5) / 1000 : 2e18 * (1000 + i * 15) / 1000;
            _order(i % 2 == 0 ? alice : bob, sell, lim, bud);
        }
        ClinchHook.Batch memory b = hook.getBatch(k, 1);
        vm.roll(b.endBlock);
        uint256 g = gasleft();
        hook.settle(k);
        uint256 used = g - gasleft();
        emit log_named_uint("settle gas, 32 orders, ~5% depth, eps 0.1%", used);
        assertLt(used, 15_000_000);
    }
}
