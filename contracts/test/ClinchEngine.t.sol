// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ClinchEngine} from "../src/libraries/ClinchEngine.sol";

contract EngineHarness {
    function run(ClinchEngine.Bid[] memory b, ClinchEngine.Supply memory s, ClinchEngine.Params memory p)
        external
        pure
        returns (ClinchEngine.Result memory)
    {
        return ClinchEngine.run(b, s, p);
    }

    function twoSided(ClinchEngine.Order[] memory o, uint256 r0, uint256 r1, ClinchEngine.Params memory p)
        external
        pure
        returns (ClinchEngine.TwoSided memory)
    {
        return ClinchEngine.twoSided(o, r0, r1, p);
    }
}

/// @notice Property tests named after the propositions in docs/handoff.md and research/FINDINGS.md.
contract ClinchEngineTest is Test {
    uint256 constant WAD = 1e18;
    EngineHarness h;

    function setUp() public {
        h = new EngineHarness();
    }

    // ------------------------------------------------------------------ helpers

    function _pool() internal pure returns (ClinchEngine.Supply memory s) {
        s.kind = 1;
        s.x0 = 1_000_000e18;
        s.y0 = 2_000_000e18;
        s.p0 = 2e18;
    }

    function _prm(uint256 eps) internal pure returns (ClinchEngine.Params memory) {
        return ClinchEngine.Params({eps: eps, pMax: 0, maxSteps: 50_000});
    }

    /// Random bids from a seed: limits in [p0, 4 p0], budgets in [0.01%, 2%] of y0.
    function _bids(uint256 seed, uint256 n, uint256 p0, uint256 y0) internal pure returns (ClinchEngine.Bid[] memory b) {
        b = new ClinchEngine.Bid[](n);
        for (uint256 i; i < n; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            b[i].limit = p0 + (p0 * (r % 3000)) / 1000;
            b[i].budget = (y0 * (1 + (r >> 128) % 200)) / 10_000;
        }
    }

    function _csv(uint256[] memory a) internal pure returns (string memory s) {
        for (uint256 i; i < a.length; ++i) {
            s = string.concat(s, i == 0 ? "" : ",", vm.toString(a[i]));
        }
    }

    // ------------------------------------------------------------------ differential vs Python WAD engine

    function _diff(ClinchEngine.Bid[] memory b, ClinchEngine.Supply memory s, uint256 eps, uint256 pMax) internal {
        uint256 n = b.length;
        uint256[] memory lim = new uint256[](n);
        uint256[] memory bud = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            lim[i] = b[i].limit;
            bud[i] = b[i].budget;
        }
        string[] memory cmd = new string[](13);
        cmd[0] = "python3";
        cmd[1] = "-I";
        cmd[2] = "../research/clinch/cli.py";
        cmd[3] = vm.toString(uint256(s.kind));
        cmd[4] = vm.toString(s.S0);
        cmd[5] = vm.toString(s.x0);
        cmd[6] = vm.toString(s.y0);
        cmd[7] = vm.toString(s.p0);
        cmd[8] = vm.toString(s.M);
        cmd[9] = vm.toString(eps);
        cmd[10] = vm.toString(pMax);
        cmd[11] = _csv(lim);
        cmd[12] = _csv(bud);
        string memory js = string(vm.ffi(cmd));
        ClinchEngine.Result memory r = h.run(b, s, ClinchEngine.Params({eps: eps, pMax: pMax, maxSteps: 50_000}));
        assertEq(r.X, vm.parseJsonUint(js, ".X"), "X");
        assertEq(r.Y, vm.parseJsonUint(js, ".Y"), "Y");
        assertEq(r.pFinal, vm.parseJsonUint(js, ".pF"), "pF");
        assertEq(r.steps, vm.parseJsonUint(js, ".steps"), "steps");
        uint256[] memory q = vm.parseJsonUintArray(js, ".qty");
        uint256[] memory pd = vm.parseJsonUintArray(js, ".paid");
        for (uint256 i; i < n; ++i) {
            assertEq(r.qty[i], q[i], "qty");
            assertEq(r.paid[i], pd[i], "paid");
        }
    }

    function testFuzz_Differential_AMM(uint256 seed, uint8 n8, uint8 epsSel) public {
        uint256 n = bound(n8, 1, 12);
        uint256 eps = [uint256(1e16), 3e15, 1e15][epsSel % 3];
        ClinchEngine.Supply memory s = _pool();
        _diff(_bids(seed, n, s.p0, s.y0), s, eps, 0);
    }

    function testFuzz_Differential_AMMWithMinority(uint256 seed, uint8 n8, uint96 m) public {
        uint256 n = bound(n8, 1, 10);
        ClinchEngine.Supply memory s = _pool();
        s.M = bound(m, 1, 20_000e18);
        _diff(_bids(seed, n, s.p0, s.y0), s, 1e15, 0);
    }

    function testFuzz_Differential_Fixed(uint256 seed, uint8 n8, uint96 supply) public {
        uint256 n = bound(n8, 1, 12);
        ClinchEngine.Supply memory s;
        s.kind = 0;
        s.p0 = 2e18;
        s.S0 = bound(supply, 1e18, 50_000e18);
        _diff(_bids(seed, n, s.p0, 2_000_000e18), s, 1e16, 6e18);
    }

    // ------------------------------------------------------------------ Prop 1: conservation and budgets

    function testFuzz_Prop1_ConservationFixed(uint256 seed, uint8 n8, uint96 supply) public view {
        uint256 n = bound(n8, 1, 20);
        ClinchEngine.Supply memory s;
        s.kind = 0;
        s.p0 = 1e18;
        s.S0 = bound(supply, 1e15, 100_000e18);
        ClinchEngine.Bid[] memory b = _bids(seed, n, s.p0, 1_000_000e18);
        ClinchEngine.Result memory r = h.run(b, s, ClinchEngine.Params({eps: 1e16, pMax: 5e18, maxSteps: 50_000}));
        assertLe(r.X, s.S0, "over-allocated");
        uint256 sumQ;
        uint256 sumP;
        for (uint256 i; i < n; ++i) {
            assertLe(r.paid[i], b[i].budget, "over budget");
            sumQ += r.qty[i];
            sumP += r.paid[i];
        }
        assertEq(sumQ, r.X);
        assertEq(sumP, r.Y);
        assertLe(r.pFinal, 5e18, "above ceiling");
    }

    // ------------------------------------------------------------------ Prop 2: exact settlement on the chord path

    function testFuzz_Prop2_ExactSettlement(uint256 seed, uint8 n8, uint8 epsSel) public view {
        uint256 n = bound(n8, 1, 20);
        uint256 eps = [uint256(1e16), 1e15][epsSel % 2];
        ClinchEngine.Supply memory s = _pool();
        ClinchEngine.Result memory r = h.run(_bids(seed, n, s.p0, s.y0), s, _prm(eps));
        // pool releases X and receives Y: never underpaid, i.e. Y (x0 - X) >= y0 X
        assertGe(r.Y * (s.x0 - r.X), s.y0 * r.X, "pool underpaid");
        // surplus bounded by ~eps of volume (research F6)
        if (r.Y > 0) {
            uint256 cX = (s.y0 * r.X) / (s.x0 - r.X);
            assertLe((r.Y - cX) * WAD / r.Y, eps + 1e12, "surplus too large");
        }
    }

    // ------------------------------------------------------------------ Prop 3: order independence

    function testFuzz_Prop3_OrderIndependence(uint256 seed, uint8 n8) public view {
        uint256 n = bound(n8, 2, 16);
        ClinchEngine.Supply memory s = _pool();
        ClinchEngine.Bid[] memory b = _bids(seed, n, s.p0, s.y0);
        ClinchEngine.Bid[] memory rb = new ClinchEngine.Bid[](n);
        for (uint256 i; i < n; ++i) {
            rb[i] = b[n - 1 - i];
        }
        ClinchEngine.Result memory r1 = h.run(b, s, _prm(1e15));
        ClinchEngine.Result memory r2 = h.run(rb, s, _prm(1e15));
        assertEq(r1.X, r2.X);
        assertEq(r1.Y, r2.Y);
        for (uint256 i; i < n; ++i) {
            assertEq(r1.qty[i], r2.qty[n - 1 - i]);
            assertEq(r1.paid[i], r2.paid[n - 1 - i]);
        }
    }

    // ------------------------------------------------------------------ Prop 4: sybil splits never help (empirical, eps-bounded)

    function testFuzz_Prop4_SybilSplit(uint256 seed, uint8 n8, uint8 k8, uint256 vSeed) public view {
        uint256 n = bound(n8, 1, 8);
        uint256 k = bound(k8, 2, 6);
        ClinchEngine.Supply memory s = _pool();
        ClinchEngine.Bid[] memory others = _bids(seed, n, s.p0, s.y0);
        uint256 V = s.p0 + (s.p0 * (vSeed % 2000)) / 1000;
        uint256 Q = s.y0 / 100;

        // truthful: one identity (V, Q) first, then others
        ClinchEngine.Bid[] memory tb = new ClinchEngine.Bid[](n + 1);
        tb[0] = ClinchEngine.Bid(V, Q);
        for (uint256 i; i < n; ++i) {
            tb[i + 1] = others[i];
        }
        ClinchEngine.Result memory rt = h.run(tb, s, _prm(1e15));
        int256 uTruth = int256(rt.qty[0] * V / WAD) - int256(rt.paid[0]);

        // sybil: k identities, random values in [p0, 3V], budgets summing to <= Q
        ClinchEngine.Bid[] memory sb = new ClinchEngine.Bid[](n + k);
        uint256 left = Q;
        for (uint256 j; j < k; ++j) {
            uint256 r = uint256(keccak256(abi.encode(vSeed, j)));
            uint256 q = j == k - 1 ? left : (left * (1 + r % 900)) / 1000;
            left -= q;
            sb[j] = ClinchEngine.Bid(s.p0 + ((3 * V - s.p0) * ((r >> 64) % 1000)) / 1000, q);
        }
        for (uint256 i; i < n; ++i) {
            sb[k + i] = others[i];
        }
        ClinchEngine.Result memory rs = h.run(sb, s, _prm(1e15));
        uint256 xs;
        uint256 ys;
        for (uint256 j; j < k; ++j) {
            xs += rs.qty[j];
            ys += rs.paid[j];
        }
        int256 uSybil = int256(xs * V / WAD) - int256(ys);
        // research/FINDINGS.md: worst gain found 1.5e-5 * budget at eps = 0.1%; allow eps * budget
        assertLe(uSybil, uTruth + int256(Q * 1e15 / WAD), "sybil split gained more than eps * budget");
    }

    // ------------------------------------------------------------------ Prop 6: individual rationality

    function testFuzz_Prop6_IndividualRationality(uint256 seed, uint8 n8) public view {
        uint256 n = bound(n8, 1, 20);
        ClinchEngine.Supply memory s = _pool();
        ClinchEngine.Bid[] memory b = _bids(seed, n, s.p0, s.y0);
        ClinchEngine.Result memory r = h.run(b, s, _prm(1e15));
        for (uint256 i; i < n; ++i) {
            if (r.qty[i] == 0) continue;
            // average price paid <= limit (1 wei of rounding per purchase allowed) and >= spot
            assertLe(r.paid[i] * WAD, b[i].limit * r.qty[i] + r.steps * WAD, "paid above limit");
            assertGe(r.paid[i] * WAD, s.p0 * r.qty[i], "paid below spot");
        }
    }

    // ------------------------------------------------------------------ Lemma 6.2: termination bound

    function test_Prop10_TerminationBound() public view {
        ClinchEngine.Supply memory s = _pool();
        ClinchEngine.Bid[] memory b = new ClinchEngine.Bid[](3);
        b[0] = ClinchEngine.Bid(type(uint256).max, s.y0 / 20); // "any price"
        b[1] = ClinchEngine.Bid(type(uint256).max, s.y0 / 50);
        b[2] = ClinchEngine.Bid(3e18, s.y0 / 100);
        ClinchEngine.Result memory r = h.run(b, s, _prm(1e15));
        uint256 B0 = s.y0 / 20 + s.y0 / 50 + s.y0 / 100;
        // P_B = (y0 + B0)^2 / (x0 y0), allow one ladder step of overshoot
        uint256 PB = (s.y0 + B0) * (s.y0 + B0) / s.x0 * WAD / s.y0;
        assertLe(r.pFinal, PB * (WAD + 1e15) / WAD, "price above Lemma 6.2 bound");
        assertEq(r.paid[0], b[0].budget, "infinite-limit bidder spends whole budget");
    }

    // ------------------------------------------------------------------ Prop 12: launch ceiling terminates

    function test_Prop12_LaunchCeiling() public view {
        ClinchEngine.Supply memory s;
        s.kind = 0;
        s.S0 = 1000e18;
        s.p0 = 1e18;
        ClinchEngine.Bid[] memory b = new ClinchEngine.Bid[](2);
        b[0] = ClinchEngine.Bid(type(uint256).max, 5000e18);
        b[1] = ClinchEngine.Bid(type(uint256).max, 5000e18);
        ClinchEngine.Result memory r = h.run(b, s, ClinchEngine.Params({eps: 1e16, pMax: 4e18, maxSteps: 50_000}));
        assertEq(r.pFinal, 4e18);
        assertLe(r.X, s.S0);
        assertApproxEqRel(r.X, s.S0, 1e12, "all supply sold at the ceiling");
        assertLe(r.steps, 150);
    }

    // ------------------------------------------------------------------ equal-value split: utility, not allocation (F1)

    function test_Prop4b_EqualValueSplitHurts() public view {
        ClinchEngine.Supply memory s;
        s.kind = 1;
        s.x0 = 1000e18;
        s.y0 = 1000e18;
        s.p0 = 1e18;
        ClinchEngine.Bid[] memory m = new ClinchEngine.Bid[](3);
        m[0] = ClinchEngine.Bid(1.4e18, 120e18);
        m[1] = ClinchEngine.Bid(1.5e18, 100e18);
        m[2] = ClinchEngine.Bid(1.3e18, 80e18);
        ClinchEngine.Result memory rm = h.run(m, s, _prm(1e15));
        ClinchEngine.Bid[] memory sp = new ClinchEngine.Bid[](7);
        for (uint256 i; i < 5; ++i) {
            sp[i] = ClinchEngine.Bid(1.4e18, 24e18);
        }
        sp[5] = m[1];
        sp[6] = m[2];
        ClinchEngine.Result memory rs = h.run(sp, s, _prm(1e15));
        uint256 xs;
        uint256 ys;
        for (uint256 i; i < 5; ++i) {
            xs += rs.qty[i];
            ys += rs.paid[i];
        }
        int256 um = int256(rm.qty[0] * 14 / 10) - int256(rm.paid[0]);
        int256 us = int256(xs * 14 / 10) - int256(ys);
        assertLt(us, um, "splitting should strictly hurt here");
    }

    // ------------------------------------------------------------------ two-sided settlement (Thm 6.3)

    function testFuzz_TwoSided_Settlement(uint256 seed, uint8 nb, uint8 ns) public view {
        uint256 r0 = 1_000_000e18;
        uint256 r1 = 2_000_000e18;
        uint256 p0 = 2e18;
        uint256 nB = bound(nb, 0, 8);
        uint256 nS = bound(ns, 0, 8);
        ClinchEngine.Order[] memory o = new ClinchEngine.Order[](nB + nS);
        for (uint256 i; i < nB + nS; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            bool sell = i >= nB;
            o[i].zeroForOne = sell;
            if (sell) {
                o[i].limit = (p0 * (300 + r % 800)) / 1000; // sellers: min price 0.3x..1.1x spot
                o[i].budget = (r0 * (1 + (r >> 128) % 200)) / 10_000;
            } else {
                o[i].limit = (p0 * (900 + r % 2000)) / 1000; // buyers: max price 0.9x..2.9x spot
                o[i].budget = (r1 * (1 + (r >> 128) % 200)) / 10_000;
            }
        }
        ClinchEngine.TwoSided memory t = h.twoSided(o, r0, r1, _prm(1e15));

        // dominant side absorbs the minority fill (Thm 6.3: Xf >= M), up to rounding
        assertGe(t.dominantBought + 64, t.minoritySupply, "Xf < M");
        // the pool can deliver what the dominant side needs for poolIn
        uint256 needed = t.dominantBought > t.minoritySupply ? t.dominantBought - t.minoritySupply : 0;
        (uint256 xIn, uint256 yIn) = t.buyersDominant ? (r0, r1) : (r1, r0);
        assertGe(t.poolIn * (xIn - needed), yIn * needed, "pool cannot deliver");
        // budgets and prices
        // Each ladder purchase rounds quantity down and payment up by at most 1 wei each, so per-order
        // price checks allow (steps + 2) wei of rounding on each side.
        uint256 tol = t.steps + 2;
        for (uint256 i; i < o.length; ++i) {
            assertLe(t.spent[i], o[i].budget, "over budget");
            if (t.spent[i] == 0) continue;
            if (o[i].zeroForOne) {
                // sellers receive at most spot per token0 sold, and at least their min
                assertLe(t.received[i] * WAD, p0 * t.spent[i] + tol * (WAD + p0), "seller above spot");
                assertGe(t.received[i] * WAD + tol * (WAD + o[i].limit), o[i].limit * t.spent[i], "seller below min");
            } else {
                assertGe(t.spent[i] * WAD + tol * (WAD + p0), p0 * t.received[i], "buyer below spot");
                assertLe(t.spent[i] * WAD, o[i].limit * t.received[i] + tol * (WAD + o[i].limit), "buyer above max");
            }
        }
    }

    function test_TwoSided_TieFillsInternally() public view {
        ClinchEngine.Order[] memory o = new ClinchEngine.Order[](2);
        o[0] = ClinchEngine.Order({zeroForOne: false, limit: 3e18, budget: 200e18}); // buys 100 token0 at spot 2
        o[1] = ClinchEngine.Order({zeroForOne: true, limit: 1e18, budget: 100e18}); // sells 100 token0
        ClinchEngine.TwoSided memory t = h.twoSided(o, 1_000_000e18, 2_000_000e18, _prm(1e15));
        assertTrue(t.buyersDominant);
        assertEq(t.received[1], 200e18, "seller gets spot");
        assertEq(t.minoritySupply, 100e18);
        assertApproxEqAbs(t.received[0], 100e18, 2, "buyer gets the internal match");
        assertLe(t.poolIn, 2, "no pool trade beyond dust");
    }

    function test_TwoSided_IneligibleIgnored() public view {
        ClinchEngine.Order[] memory o = new ClinchEngine.Order[](2);
        o[0] = ClinchEngine.Order({zeroForOne: false, limit: 1.5e18, budget: 100e18}); // max below spot 2
        o[1] = ClinchEngine.Order({zeroForOne: true, limit: 2.5e18, budget: 100e18}); // min above spot
        ClinchEngine.TwoSided memory t = h.twoSided(o, 1_000_000e18, 2_000_000e18, _prm(1e15));
        assertEq(t.spent[0], 0);
        assertEq(t.spent[1], 0);
        assertEq(t.poolIn, 0);
    }
}
