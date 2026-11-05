// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Research prototype of the discretized adaptive clinching engine
/// (Zhang, Li, Shi, Zhang, Xia, Han, arXiv 2610.36629, Sections 3-5).
/// Mirrors research/clinch/wad.py line by line. Not audited. For gas measurement only.
library ClinchEngine {
    uint256 internal constant WAD = 1e18;

    struct Bid {
        uint256 limit; // value v_i, Y per X (WAD)
        uint256 budget; // q_i in Y (WAD)
    }

    struct Supply {
        uint8 kind; // 0 fixed supply, 1 constant-product chord target
        uint256 S0;
        uint256 x0;
        uint256 y0;
        uint256 p0; // spot (kind 1) or reserve price (kind 0)
        uint256 M; // minority fill folded into the cost curve (kind 1)
    }

    struct Out {
        uint256[] qty;
        uint256[] paid;
        uint256 pFinal;
        uint256 steps;
        uint256 X;
        uint256 Y;
    }

    error LadderExhausted();

    // ------------------------------------------------------------ math
    /// @dev floor(a*b/d) with 512-bit intermediate (Remco Bloemen's algorithm).
    function mulDiv(uint256 a, uint256 b, uint256 d) internal pure returns (uint256 result) {
        unchecked {
            uint256 prod0;
            uint256 prod1;
            assembly {
                let mm := mulmod(a, b, not(0))
                prod0 := mul(a, b)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) return prod0 / d;
            require(d > prod1, "mulDiv overflow");
            uint256 remainder;
            assembly {
                remainder := mulmod(a, b, d)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }
            uint256 twos = d & (~d + 1);
            assembly {
                d := div(d, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;
            uint256 inv = (3 * d) ^ 2;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            inv *= 2 - d * inv;
            result = prod0 * inv;
        }
    }

    function mulDivUp(uint256 a, uint256 b, uint256 d) internal pure returns (uint256 r) {
        r = mulDiv(a, b, d);
        unchecked {
            if (mulmod(a, b, d) > 0) r += 1;
        }
    }

    function sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        unchecked {
            z = 1 << ((_log2(x) + 1) / 2 + 1);
            for (uint256 i; i < 8; ++i) {
                z = (z + x / z) >> 1;
            }
            uint256 zz = x / z;
            if (zz < z) z = zz;
            while (z * z > x) --z;
        }
    }

    function _log2(uint256 x) private pure returns (uint256 r) {
        unchecked {
            while (x > 1) {
                x >>= 1;
                ++r;
            }
        }
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    // ------------------------------------------------------------ target
    /// @notice T~_M(p, X, Y) = max{z : C~_M(z) <= Y + p (z - X)}, rounded down (paper eqs. 11, 57).
    function target(Supply memory s, uint256 p, uint256 X, uint256 Y) internal pure returns (uint256) {
        if (s.kind == 0) return s.S0;
        int256 K = int256(Y) - int256(mulDivUp(p, X, WAD)) + int256(mulDiv(p - s.p0, s.M, WAD));
        int256 b = int256(s.y0) + K - int256(mulDiv(p, s.x0, WAD));
        uint256 absK = K >= 0 ? uint256(K) : uint256(-K);
        uint256 fourPkx = K >= 0 ? mulDiv(4 * p * absK, s.x0, WAD) : mulDivUp(4 * p * absK, s.x0, WAD);
        uint256 bb = uint256(b >= 0 ? b : -b);
        bb = bb * bb;
        uint256 disc;
        if (K >= 0) disc = bb + fourPkx;
        else disc = bb > fourPkx ? bb - fourPkx : 0;
        uint256 sqF = sqrt(disc);
        uint256 z;
        if (b >= 0) {
            uint256 sqC = sqF * sqF == disc ? sqF : sqF + 1;
            uint256 den = uint256(b) + sqC;
            z = (den == 0 || K <= 0) ? 0 : mulDiv(2 * uint256(K), s.x0, den);
        } else {
            z = mulDiv(sqF + uint256(-b), WAD, 2 * p);
        }
        z = z > 0 ? z - 1 : 0;
        uint256 T = s.M + z;
        return T > X ? T : X;
    }

    // ------------------------------------------------------------ settle
    function settle(Bid[] memory bids, Supply memory s, uint256 eps, uint256 maxSteps)
        internal
        pure
        returns (Out memory o)
    {
        uint256 n = bids.length;
        o.qty = new uint256[](n);
        o.paid = new uint256[](n);
        uint256[] memory rem = new uint256[](n);
        uint256 p = s.p0;
        uint256 B;
        for (uint256 i; i < n; ++i) {
            if (bids[i].limit >= p) {
                rem[i] = bids[i].budget;
                B += rem[i];
            }
        }

        for (uint256 k; k < maxSteps; ++k) {
            o.steps = k + 1;
            uint256 T = target(s, p, o.X, o.Y);
            uint256 S = T > o.X ? T - o.X : 0;

            uint256 dAct;
            uint256 BE;
            for (uint256 i; i < n; ++i) {
                uint256 r = rem[i];
                if (r == 0) continue;
                if (bids[i].limit > p) dAct += mulDiv(r, WAD, p);
                else BE += r;
            }

            if (dAct <= S) {
                // stopping allocation, eqs. (20)-(22)
                uint256 exitQty = BE > 0 ? _min(mulDiv(BE, WAD, p), S - dAct) : 0;
                for (uint256 i; i < n; ++i) {
                    uint256 r = rem[i];
                    if (r == 0) continue;
                    uint256 q = bids[i].limit > p ? mulDiv(r, WAD, p) : mulDiv(exitQty, r, BE);
                    _buy(o, rem, i, q, p);
                }
                o.pFinal = p;
                return o;
            }

            // cancel exiting budgets, eq. (23)
            for (uint256 i; i < n; ++i) {
                if (rem[i] > 0 && bids[i].limit <= p) {
                    B -= rem[i];
                    rem[i] = 0;
                }
            }

            // restoration purchases to the water level, eq. (24)
            uint256 pS = mulDiv(p, S, WAD);
            uint256 h = B > pS ? B - pS : 0;
            for (uint256 i; i < n; ++i) {
                if (rem[i] > h) {
                    uint256 q = mulDiv(rem[i] - h, WAD, p);
                    if (q > 0) B -= _buy(o, rem, i, q, p);
                }
            }
            if (B == 0) {
                o.pFinal = p;
                return o;
            }
            if (s.kind == 0 && s.S0 <= o.X) {
                o.pFinal = p;
                return o;
            }

            // next ladder price: geometric step capped at the next bidder limit
            uint256 pn = mulDiv(p, WAD + eps, WAD);
            if (pn == p) pn = p + 1;
            bool anyActive;
            for (uint256 i; i < n; ++i) {
                if (rem[i] > 0) {
                    anyActive = true;
                    if (bids[i].limit < pn) pn = bids[i].limit;
                }
            }
            if (!anyActive) {
                o.pFinal = p;
                return o;
            }
            p = pn;
        }
        revert LadderExhausted();
    }

    function _buy(Out memory o, uint256[] memory rem, uint256 i, uint256 q, uint256 p) private pure returns (uint256 pay) {
        pay = mulDivUp(q, p, WAD);
        if (pay > rem[i]) {
            pay = rem[i];
            q = mulDiv(pay, WAD, p);
        }
        o.qty[i] += q;
        o.paid[i] += pay;
        rem[i] -= pay;
        o.X += q;
        o.Y += pay;
    }
}
