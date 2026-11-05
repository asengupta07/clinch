// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {ClinchHook} from "../src/ClinchHook.sol";
import {ClinchLaunch} from "../src/ClinchLaunch.sol";
import {ClinchLaunchFactory} from "../src/ClinchLaunchFactory.sol";
import {ClinchFixture} from "./utils/ClinchFixture.sol";

contract ClinchLaunchTest is ClinchFixture {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for *;

    MockERC20 sale;
    MockERC20 quote;
    address issuer = makeAddr("issuer");
    address[6] users;

    function setUp() public {
        _deployClinch();
        users = [makeAddr("u0"), makeAddr("u1"), makeAddr("u2"), makeAddr("u3"), makeAddr("u4"), makeAddr("whale")];
    }

    // ------------------------------------------------------------------ helpers

    function _setTokens(bool saleIsToken0) internal {
        (sale, quote) = saleIsToken0 ? (token0, token1) : (token1, token0);
    }

    function _params() internal view returns (ClinchLaunch.Params memory p) {
        p.saleToken = address(sale);
        p.quoteToken = address(quote);
        p.supply = 1_000_000e18;
        p.lpTokens = 200_000e18;
        p.lpQuoteBps = 5000;
        p.reservePrice = 0.1e18;
        p.maxPrice = 1e18;
        p.eps = 1e16;
        p.endTime = uint64(block.timestamp + 1 days);
        p.rescueDelay = 1 days;
        p.maxBids = 40;
        p.minBid = 1e18;
        p.poolCfg = _cfg();
    }

    function _create(ClinchLaunch.Params memory p) internal returns (ClinchLaunch l) {
        sale.mint(issuer, p.supply + p.lpTokens);
        vm.startPrank(issuer);
        sale.approve(address(factory), type(uint256).max);
        l = factory.createLaunch(p);
        vm.stopPrank();
    }

    function _bid(ClinchLaunch l, address who, uint256 limit, uint128 budget) internal returns (uint256) {
        quote.mint(who, budget);
        vm.startPrank(who);
        quote.approve(address(l), budget);
        uint256 i = l.bid(limit, budget);
        vm.stopPrank();
        return i;
    }

    function _contested(ClinchLaunch l) internal {
        _bid(l, users[0], 0.5e18, 120_000e18);
        _bid(l, users[1], 0.3e18, 60_000e18);
        _bid(l, users[2], 0.8e18, 90_000e18);
        _bid(l, users[3], 0.25e18, 40_000e18);
        _bid(l, users[4], 0.15e18, 30_000e18);
    }

    // ------------------------------------------------------------------ happy path, both token orders

    function test_FullLifecycle_SaleIsToken0() public {
        _lifecycle(true);
    }

    function test_FullLifecycle_SaleIsToken1() public {
        _lifecycle(false);
    }

    function _lifecycle(bool saleIs0) internal {
        _setTokens(saleIs0);
        ClinchLaunch l = _create(_params());
        assertEq(uint8(l.status()), uint8(ClinchLaunch.Status.Live));
        _contested(l);

        vm.expectRevert(ClinchLaunch.SaleOpen.selector);
        l.settle();
        vm.warp(block.timestamp + 1 days);
        vm.prank(users[5]); // anyone can settle
        l.settle();

        ClinchLaunch.Params memory p = l.params();
        assertLe(l.sold(), p.supply);
        assertGe(l.clearingPrice(), p.reservePrice);
        assertLe(l.clearingPrice(), p.maxPrice);

        // every bidder: paid <= budget, avg price in [reserve, limit]
        ClinchLaunch.Bid[] memory bs = l.getBids();
        uint256 sumQty;
        uint256 sumPaid;
        for (uint256 i; i < bs.length; ++i) {
            assertLe(bs[i].paid, bs[i].budget);
            if (bs[i].qty > 0) {
                assertLe(uint256(bs[i].paid) * 1e18, bs[i].limit * bs[i].qty + 1e18 * 1000, "above limit");
                assertGe(uint256(bs[i].paid) * 1e18 + 1e18 * 1000, p.reservePrice * bs[i].qty, "below reserve");
            }
            sumQty += bs[i].qty;
            sumPaid += bs[i].paid;
        }
        assertEq(sumQty, l.sold());
        assertEq(sumPaid, l.proceeds());

        // pool seeded at the clearing price, liquidity locked in the launch
        assertTrue(l.poolSeeded());
        PoolKey memory key = l.poolKey();
        assertGt(manager.getLiquidity(key.toId()), 0);
        uint256 spot = hook.spotPrice(key); // token1 per token0
        uint256 clearing = l.clearingPrice(); // quote per sale
        uint256 expectSpot = saleIs0 ? clearing : 1e36 / clearing;
        assertApproxEqRel(spot, expectSpot, 1e14, "pool not at clearing price");

        // claims
        for (uint256 i; i < bs.length; ++i) {
            uint256 s0 = sale.balanceOf(bs[i].owner);
            uint256 q0 = quote.balanceOf(bs[i].owner);
            l.claim(i);
            assertEq(sale.balanceOf(bs[i].owner) - s0, bs[i].qty);
            assertEq(quote.balanceOf(bs[i].owner) - q0, bs[i].budget - bs[i].paid);
        }
        vm.expectRevert(ClinchLaunch.AlreadyClaimed.selector);
        l.claim(0);

        // issuer
        vm.expectRevert(ClinchLaunch.NotIssuer.selector);
        l.issuerWithdraw();
        vm.prank(issuer);
        l.issuerWithdraw();
        assertLe(sale.balanceOf(address(l)), 1e12, "sale dust");
        assertLe(quote.balanceOf(address(l)), 1e12, "quote dust");

        // the seeded pool now trades as a Clinch batch market
        address trader = makeAddr("trader");
        _fund(trader, 1e24, 1e24);
        vm.prank(trader);
        (uint64 b,) = hook.placeOrder(key, !saleIs0, saleIs0 ? clearing * 2 : 1, saleIs0 ? 1_000e18 : 1_000e18);
        vm.roll(hook.getBatch(key, b).endBlock);
        hook.settle(key);
        hook.claim(key, b, 0);
    }

    // ------------------------------------------------------------------ edge cases

    function test_Undersubscribed_ClearsAtReserve() public {
        _setTokens(true);
        ClinchLaunch l = _create(_params());
        _bid(l, users[0], 0.5e18, 10_000e18); // 100k tokens at reserve 0.1
        _bid(l, users[1], 0.2e18, 5_000e18);
        vm.warp(block.timestamp + 1 days);
        l.settle();
        assertEq(l.clearingPrice(), 0.1e18);
        assertEq(l.proceeds(), 15_000e18);
        assertApproxEqAbs(l.sold(), 150_000e18, 1e6);
        assertTrue(l.poolSeeded());
    }

    function test_NoBids_NoPool_IssuerRecoversAll() public {
        _setTokens(true);
        ClinchLaunch l = _create(_params());
        vm.warp(block.timestamp + 1 days);
        l.settle();
        assertFalse(l.poolSeeded());
        vm.prank(issuer);
        l.issuerWithdraw();
        assertEq(sale.balanceOf(issuer), 1_200_000e18);
    }

    function test_OversubscribedHitsCeiling() public {
        _setTokens(true);
        ClinchLaunch l = _create(_params());
        _bid(l, users[0], 50e18, 5_000_000e18);
        _bid(l, users[1], 50e18, 5_000_000e18);
        vm.warp(block.timestamp + 1 days);
        l.settle();
        assertEq(l.clearingPrice(), 1e18, "should stop at maxPrice");
        assertApproxEqRel(l.sold(), 1_000_000e18, 1e12);
    }

    function test_CancelPath() public {
        _setTokens(false);
        ClinchLaunch l = _create(_params());
        _contested(l);
        uint256 end = l.params().endTime;
        vm.warp(end + 1 days - 1);
        vm.expectRevert(ClinchLaunch.RescueNotReady.selector);
        l.cancel();
        vm.warp(end + 1 days);
        l.cancel();
        vm.expectRevert(ClinchLaunch.WrongStatus.selector);
        l.settle();
        uint256 before = quote.balanceOf(users[0]);
        l.claim(0);
        assertEq(quote.balanceOf(users[0]) - before, 120_000e18);
        vm.prank(issuer);
        l.issuerWithdraw();
        assertEq(sale.balanceOf(issuer), 1_200_000e18);
    }

    function test_BidValidation() public {
        _setTokens(true);
        ClinchLaunch l = _create(_params());
        quote.mint(users[0], 1e30);
        vm.startPrank(users[0]);
        quote.approve(address(l), type(uint256).max);
        vm.expectRevert(ClinchLaunch.LimitBelowReserve.selector);
        l.bid(0.05e18, 100e18);
        vm.expectRevert(ClinchLaunch.BidTooSmall.selector);
        l.bid(1e18, 0.5e18);
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days);
        vm.prank(users[0]);
        vm.expectRevert(ClinchLaunch.SaleClosed.selector);
        l.bid(1e18, 100e18);
    }

    function test_MaxBids() public {
        _setTokens(true);
        ClinchLaunch.Params memory p = _params();
        p.maxBids = 3;
        ClinchLaunch l = _create(p);
        for (uint256 i; i < 3; ++i) {
            _bid(l, users[0], 1e18, 10e18);
        }
        quote.mint(users[0], 10e18);
        vm.startPrank(users[0]);
        quote.approve(address(l), 10e18);
        vm.expectRevert(ClinchLaunch.TooManyBids.selector);
        l.bid(1e18, 10e18);
        vm.stopPrank();
    }

    function test_ReservedPoolCannotBeFrontRun() public {
        _setTokens(true);
        ClinchLaunch l = _create(_params());
        PoolKey memory key = l.poolKey();
        vm.expectRevert(abi.encodeWithSelector(ClinchHook.PoolReservedFor.selector, address(l)));
        hook.initializePool(key, _sqrtP(100e18), _cfg());
    }

    function test_FactorySkipsTakenKey() public {
        _setTokens(true);
        // a griefer initializes the first candidate key
        hook.initializePool(_key(60), _sqrtP(1e18), _cfg());
        ClinchLaunch l = _create(_params());
        assertEq(l.poolKey().tickSpacing, 61);
    }

    function test_FactoryParamValidation() public {
        _setTokens(true);
        ClinchLaunch.Params memory p = _params();
        p.maxPrice = p.reservePrice;
        sale.mint(issuer, 2_000_000e18);
        vm.startPrank(issuer);
        sale.approve(address(factory), type(uint256).max);
        vm.expectRevert(ClinchLaunchFactory.InvalidParams.selector);
        factory.createLaunch(p);
        vm.stopPrank();
    }

    function test_SetHookOnce() public {
        vm.expectRevert(ClinchLaunchFactory.HookAlreadySet.selector);
        factory.setHook(hook);
    }

    // ------------------------------------------------------------------ incentives at the launch level

    /// The whale-split experiment from research/FINDINGS.md (F1), on-chain: splitting never helps.
    function test_WhaleSplitNeverHelps() public {
        _setTokens(true);
        uint256 V = 0.6e18;
        uint128 Q = 300_000e18;

        uint256 snap = vm.snapshotState();
        ClinchLaunch l = _create(_params());
        _contested(l);
        uint256 wi = _bid(l, users[5], V, Q);
        vm.warp(block.timestamp + 1 days);
        l.settle();
        ClinchLaunch.Bid[] memory bs = l.getBids();
        int256 uTruth = int256(bs[wi].qty * V / 1e18) - int256(uint256(bs[wi].paid));
        vm.revertToState(snap);

        for (uint256 n = 2; n <= 10; n += 4) {
            uint256 s2 = vm.snapshotState();
            l = _create(_params());
            _contested(l);
            uint256 first = l.bidCount();
            for (uint256 j; j < n; ++j) {
                _bid(l, users[5], V, uint128(Q / n));
            }
            vm.warp(block.timestamp + 1 days);
            l.settle();
            bs = l.getBids();
            uint256 x;
            uint256 y;
            for (uint256 j = first; j < bs.length; ++j) {
                x += bs[j].qty;
                y += bs[j].paid;
            }
            int256 uSplit = int256(x * V / 1e18) - int256(y);
            assertLe(uSplit, uTruth + int256(uint256(Q) / 100), "split beat truthful by more than eps");
            vm.revertToState(s2);
        }
    }

    // ------------------------------------------------------------------ gas

    function test_Gas_Settle40Bids() public {
        _setTokens(true);
        ClinchLaunch l = _create(_params());
        for (uint256 i; i < 40; ++i) {
            _bid(l, users[i % 6], 0.1e18 + (i * 0.02e18), uint128(20_000e18 + i * 1_000e18));
        }
        vm.warp(block.timestamp + 1 days);
        uint256 g = gasleft();
        l.settle();
        uint256 used = g - gasleft();
        emit log_named_uint("launch settle gas, 40 bids, eps 1%, pMax/p0 = 10", used);
        emit log_named_uint("ladder steps", l.steps());
        assertLt(used, 30_000_000);
    }
}
