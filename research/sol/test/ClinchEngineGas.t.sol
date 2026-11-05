// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {ClinchEngine} from "../src/ClinchEngine.sol";

contract Harness {
    function settle(ClinchEngine.Bid[] memory b, ClinchEngine.Supply memory s, uint256 eps)
        external
        pure
        returns (ClinchEngine.Out memory)
    {
        return ClinchEngine.settle(b, s, eps, 100_000);
    }
}

contract ClinchEngineGasTest is Test {
    Harness h = new Harness();
    uint256 constant WAD = 1e18;

    /// Deterministic instance, reproduced in research/experiments/exp_sol_diff.py.
    /// Pool x0 = 1e6, y0 = 2e6 (p0 = 2). depthBps = total batch budget as bps of y0.
    function _bids(uint256 n, uint256 depthBps) internal pure returns (ClinchEngine.Bid[] memory b) {
        b = new ClinchEngine.Bid[](n);
        uint256 y0 = 2e6 * WAD;
        uint256 p0 = 2 * WAD;
        uint256 per = y0 * depthBps / 10_000 / n;
        for (uint256 i; i < n; ++i) {
            uint256 a = (i * 7919) % 1000 + 1; // 1..1000
            uint256 c = (i * 104729) % 997 + 1; // 1..997
            b[i].limit = p0 + p0 * a / 500; // up to 3x spot
            b[i].budget = per * c / 500; // spread around `per`
        }
    }

    function _amm() internal pure returns (ClinchEngine.Supply memory s) {
        s.kind = 1;
        s.x0 = 1e6 * WAD;
        s.y0 = 2e6 * WAD;
        s.p0 = 2 * WAD;
    }

    function _run(uint256 n, uint256 depthBps, uint256 eps, bool fixedSupply) internal returns (uint256 gasUsed, ClinchEngine.Out memory o) {
        ClinchEngine.Bid[] memory b = _bids(n, depthBps);
        ClinchEngine.Supply memory s = _amm();
        if (fixedSupply) {
            s.kind = 0;
            s.S0 = 1e4 * WAD;
        }
        uint256 g = gasleft();
        o = h.settle(b, s, eps);
        gasUsed = g - gasleft();
    }

    function test_gasTable() public {
        uint256[3] memory ns = [uint256(5), 20, 50];
        uint256[3] memory epss = [uint256(1e16), 1e15, 1e14];
        uint256[3] memory depths = [uint256(10), 100, 1000]; // 0.1%, 1%, 10% of pool
        console.log("kind n depthBps eps steps gas");
        for (uint256 d; d < 3; ++d) {
            for (uint256 i; i < 3; ++i) {
                for (uint256 e; e < 3; ++e) {
                    (uint256 g, ClinchEngine.Out memory o) = _run(ns[i], depths[d], epss[e], false);
                    console.log(string.concat("amm ", vm.toString(ns[i]), " ", vm.toString(depths[d]), " ",
                        vm.toString(epss[e]), " ", vm.toString(o.steps), " ", vm.toString(g)));
                }
            }
        }
        for (uint256 i; i < 3; ++i) {
            for (uint256 e; e < 2; ++e) {
                (uint256 g, ClinchEngine.Out memory o) = _run(ns[i], 1000, epss[e], true);
                console.log(string.concat("fixed ", vm.toString(ns[i]), " 1000 ", vm.toString(epss[e]), " ",
                    vm.toString(o.steps), " ", vm.toString(g)));
            }
        }
    }

    function test_diffInstance() public {
        (, ClinchEngine.Out memory o) = _run(20, 100, 1e15, false);
        console.log("DIFF X", o.X);
        console.log("DIFF Y", o.Y);
        console.log("DIFF pF", o.pFinal);
        console.log("DIFF steps", o.steps);
        // exact settlement: pool never underpaid
        uint256 x0 = 1e6 * WAD;
        uint256 y0 = 2e6 * WAD;
        assertGe(ClinchEngine.mulDiv(o.Y, x0 - o.X, 1), ClinchEngine.mulDiv(y0, o.X, 1));
    }
}
