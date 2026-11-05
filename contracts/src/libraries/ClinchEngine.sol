// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FullMath} from "v4-core/libraries/FullMath.sol";
import {FixedPointMathLib} from "solmate/src/utils/FixedPointMathLib.sol";

/// @title ClinchEngine
/// @notice Discretized adaptive clinching (Dobzinski-Lavi-Nisan) with the sybil-proof AMM target of
///         Zhang, Li, Shi, Zhang, Xia, Han, "Sybil-Proofness of Generalized Adaptive Clinching and
///         Implications for Blockchain Mechanism Design" (arXiv 2610.36629), Sections 3-5.
/// @dev    Pure library. All prices are WAD (1e18) fixed point, "units of the paid asset per unit of the
///         bought asset". Amounts are raw token units. Mirrors research/clinch/wad.py, which was
///         differential-tested against a float reference (research/FINDINGS.md).
///
///         Rounding: quantities round DOWN, payments round UP, and every rounding inside `target`
///         pushes the target DOWN, so the pool is never underpaid and supply is never over-allocated.
library ClinchEngine {
    uint256 internal constant WAD = 1e18;

    /// @param limit  Highest price (paid per bought, WAD) the bidder accepts. Its "value" in the paper.
    /// @param budget Escrowed amount of the paid asset.
    struct Bid {
        uint256 limit;
        uint256 budget;
    }

    /// @notice Supply rule.
    /// kind 0: fixed supply `S0` (token launch). kind 1: constant-product pool with reserves (x0 of the
    /// bought asset, y0 of the paid asset) plus a minority fill `M` of the bought asset at spot `p0`
    /// folded into the cost curve (paper eq. 57).
    struct Supply {
        uint8 kind;
        uint256 S0;
        uint256 x0;
        uint256 y0;
        uint256 p0;
        uint256 M;
    }

    struct Params {
        uint256 eps; // ladder step, WAD (1e15 = 0.1%)
        uint256 pMax; // price ceiling, WAD (0 = none). Limits above it are clamped.
        uint256 maxSteps; // hard bound on ladder steps
    }

    struct Result {
        uint256[] qty; // bought asset received per bid
        uint256[] paid; // paid asset spent per bid
        uint256 X; // total bought
        uint256 Y; // total paid
        uint256 pFinal;
        uint256 steps;
    }

    error LadderExhausted();
    error InvalidParams();

    // ------------------------------------------------------------------ target

    /// @notice T~_M(p, X, Y) = max{ z : C~_M(z) <= Y + p (z - X) }, rounded down (paper eqs. 11 and 57).
    /// @dev For a constant-product pool this is M plus the larger root of
    ///      p z^2 + (y0 + K - p x0) z - K x0 = 0,  K = Y - pX + (p - p0) M.
    ///      z increases in K and decreases in b, so K rounds down, b rounds up, the K-term of the
    ///      discriminant rounds toward -inf, and the root uses the cancellation-free branch.
    function target(Supply memory s, uint256 p, uint256 X, uint256 Y) internal pure returns (uint256) {
        if (s.kind == 0) return s.S0;
        int256 K = int256(Y) - int256(FullMath.mulDivRoundingUp(p, X, WAD)) + int256(FullMath.mulDiv(p - s.p0, s.M, WAD));
        int256 b = int256(s.y0) + K - int256(FullMath.mulDiv(p, s.x0, WAD));
        uint256 absK = K >= 0 ? uint256(K) : uint256(-K);
        uint256 pk = p * absK;
        uint256 fourPkx = K >= 0 ? FullMath.mulDiv(4 * pk, s.x0, WAD) : FullMath.mulDivRoundingUp(4 * pk, s.x0, WAD);
        uint256 absB = uint256(b >= 0 ? b : -b);
        uint256 bb = absB * absB;
        uint256 disc;
        if (K >= 0) disc = bb + fourPkx;
        else disc = bb > fourPkx ? bb - fourPkx : 0; // tangency or rounding: no new supply
        uint256 sqF = FixedPointMathLib.sqrt(disc);
        uint256 z;
        if (b >= 0) {
            if (K > 0) {
                uint256 sqC = sqF * sqF == disc ? sqF : sqF + 1;
                z = FullMath.mulDiv(2 * uint256(K), s.x0, absB + sqC);
            }
        } else {
            z = FullMath.mulDiv(sqF + absB, WAD, 2 * p);
        }
        if (z > 0) z -= 1;
        uint256 T = s.M + z;
        return T > X ? T : X;
    }

    // ------------------------------------------------------------------ one-sided run

    /// @notice One-sided clinching on a geometric price ladder starting at `s.p0`.
    /// @dev    Ladder: p' = min(p (1 + eps), next remaining limit above p), so every valuation exit lands
    ///         exactly on the ladder (needed for the proportional exit rule, paper eq. 22).
    ///         At each price: stopping test (eq. 20) -> stopping allocation (eqs. 21-22); otherwise cancel
    ///         exiting budgets (eq. 23) and make restoration purchases down to the water level
    ///         h = B - pS (eq. 24). Purchases at one price leave h unchanged, so bid order is irrelevant.
    function run(Bid[] memory bids, Supply memory s, Params memory prm) internal pure returns (Result memory o) {
        if (prm.eps == 0 || s.p0 == 0) revert InvalidParams();
        uint256 n = bids.length;
        o.qty = new uint256[](n);
        o.paid = new uint256[](n);
        uint256[] memory rem = new uint256[](n);
        uint256[] memory lim = new uint256[](n);
        uint256 p = s.p0;
        uint256 B;
        for (uint256 i; i < n; ++i) {
            uint256 l = bids[i].limit;
            if (prm.pMax != 0 && l > prm.pMax) l = prm.pMax;
            lim[i] = l;
            if (l >= p && bids[i].budget > 0) {
                rem[i] = bids[i].budget;
                B += rem[i];
            }
        }
        if (B == 0) {
            o.pFinal = p;
            return o;
        }

        for (uint256 k; k < prm.maxSteps; ++k) {
            o.steps = k + 1;
            uint256 T = target(s, p, o.X, o.Y);
            uint256 S = T > o.X ? T - o.X : 0;

            uint256 dAct;
            uint256 BE;
            for (uint256 i; i < n; ++i) {
                uint256 r = rem[i];
                if (r == 0) continue;
                if (lim[i] > p) dAct += FullMath.mulDiv(r, WAD, p);
                else BE += r;
            }

            if (dAct <= S) {
                uint256 exitQty;
                if (BE > 0) {
                    exitQty = FullMath.mulDiv(BE, WAD, p);
                    uint256 L = S - dAct;
                    if (L < exitQty) exitQty = L;
                }
                for (uint256 i; i < n; ++i) {
                    uint256 r = rem[i];
                    if (r == 0) continue;
                    uint256 q = lim[i] > p ? FullMath.mulDiv(r, WAD, p) : FullMath.mulDiv(exitQty, r, BE);
                    _buy(o, rem, i, q, p);
                }
                o.pFinal = p;
                return o;
            }

            for (uint256 i; i < n; ++i) {
                if (rem[i] > 0 && lim[i] <= p) {
                    B -= rem[i];
                    rem[i] = 0;
                }
            }

            uint256 pS = FullMath.mulDiv(p, S, WAD);
            uint256 h = B > pS ? B - pS : 0;
            for (uint256 i; i < n; ++i) {
                if (rem[i] > h) {
                    uint256 q = FullMath.mulDiv(rem[i] - h, WAD, p);
                    if (q > 0) B -= _buy(o, rem, i, q, p);
                }
            }

            if (B == 0 || (s.kind == 0 && s.S0 <= o.X)) {
                o.pFinal = p;
                return o;
            }

            uint256 pn = FullMath.mulDiv(p, WAD + prm.eps, WAD);
            if (pn == p) pn = p + 1;
            bool anyActive;
            for (uint256 i; i < n; ++i) {
                if (rem[i] > 0) {
                    anyActive = true;
                    if (lim[i] < pn) pn = lim[i];
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

    function _buy(Result memory o, uint256[] memory rem, uint256 i, uint256 q, uint256 p) private pure returns (uint256 pay) {
        pay = FullMath.mulDivRoundingUp(q, p, WAD);
        if (pay > rem[i]) {
            pay = rem[i];
            q = FullMath.mulDiv(pay, WAD, p);
        }
        o.qty[i] += q;
        o.paid[i] += pay;
        rem[i] -= pay;
        o.X += q;
        o.Y += pay;
    }

    // ------------------------------------------------------------------ two-sided (paper Section 5)

    /// @notice Orders on a constant-product pool with reserves (r0 of token0, r1 of token1).
    ///         `zeroForOne` orders sell token0 (budget in token0) for token1; `limit` is always the
    ///         price in token1 per token0 (WAD): a seller's minimum, a buyer's maximum.
    struct Order {
        bool zeroForOne;
        uint256 limit;
        uint256 budget;
    }

    struct TwoSided {
        bool buyersDominant; // true: token1-sellers (buyers of token0) are the dominant side
        uint256[] received; // per order: amount of the OTHER token received (before rebate scaling)
        uint256[] spent; // per order: amount of its own token spent
        uint256 dominantBought; // total bought by the dominant side according to the engine (Xf)
        uint256 minoritySupply; // M: bought-asset units physically supplied by the minority side
        uint256 poolIn; // paid-asset amount to swap into the pool (exact input)
        uint256 pFinal; // dominant-side clock price (in the dominant side's own units)
        uint256 steps;
    }

    /// @notice Paper Section 5: fill the minority side at spot, fold its supply into the dominant side's
    ///         cost curve, run one-sided clinching on the dominant side.
    /// @dev    Eligibility is decided in each side's own clock units so that the dominance comparison and
    ///         the engine agree exactly. Minority payouts round down; any rounding deficit is absorbed by
    ///         the minority (at most a few wei), so the contract never pays out more than it holds.
    function twoSided(Order[] memory orders, uint256 r0, uint256 r1, Params memory prm)
        internal
        pure
        returns (TwoSided memory t)
    {
        uint256 n = orders.length;
        t.received = new uint256[](n);
        t.spent = new uint256[](n);
        if (r0 == 0 || r1 == 0) return t;

        uint256 p0 = FullMath.mulDiv(r1, WAD, r0); // token1 per token0
        uint256 q0 = FullMath.mulDiv(r0, WAD, r1); // token0 per token1 (reverse clock)
        if (p0 == 0 || q0 == 0) return t; // price outside WAD precision: nothing trades, all refunded

        // Demand at spot in token0 units: buyers (sell token1) and sellers (sell token0).
        uint256 dBuy;
        uint256 dSell;
        uint256 nBuy;
        uint256 nSell;
        for (uint256 i; i < n; ++i) {
            Order memory od = orders[i];
            if (od.budget == 0) continue;
            if (!od.zeroForOne) {
                if (od.limit >= p0) {
                    dBuy += FullMath.mulDiv(od.budget, WAD, p0);
                    ++nBuy;
                }
            } else if (_reverseLimit(od.limit) >= q0) {
                dSell += od.budget;
                ++nSell;
            }
        }
        if (nBuy == 0 && nSell == 0) return t;

        t.buyersDominant = dBuy >= dSell; // tie: sellers are the minority (paper 5.1)
        bool domIsBuy = t.buyersDominant;

        // Build the dominant side's bids and fill the minority at spot.
        Bid[] memory dom = new Bid[](domIsBuy ? nBuy : nSell);
        uint256[] memory domIdx = new uint256[](dom.length);
        uint256 payouts;
        uint256 j;
        for (uint256 i; i < n; ++i) {
            Order memory od = orders[i];
            if (od.budget == 0) continue;
            bool isBuy = !od.zeroForOne;
            bool eligible = isBuy ? od.limit >= p0 : _reverseLimit(od.limit) >= q0;
            if (!eligible) continue;
            if (isBuy == domIsBuy) {
                dom[j] = Bid({limit: isBuy ? od.limit : _reverseLimit(od.limit), budget: od.budget});
                domIdx[j++] = i;
            } else {
                // minority: sells its whole budget at the spot clock. Must use the same clock price the engine
                // charges the dominant side for M (s.p0), or the pool input would not match the engine's state.
                // The hook bounds spot to [1e4, 1e32] WAD at init, so the clock's rounding is <= 1e-4 relative.
                uint256 out = isBuy ? FullMath.mulDiv(od.budget, q0, WAD) : FullMath.mulDiv(od.budget, p0, WAD);
                t.spent[i] = od.budget;
                t.received[i] = out;
                t.minoritySupply += od.budget;
                payouts += out;
            }
        }

        Supply memory s;
        s.kind = 1;
        if (domIsBuy) {
            // buyers pay token1, buy token0; minority supply is token0 from sellers
            s.x0 = r0;
            s.y0 = r1;
            s.p0 = p0;
            s.M = t.minoritySupply;
        } else {
            // sellers pay token0, buy token1; minority supply is token1 from buyers
            s.x0 = r1;
            s.y0 = r0;
            s.p0 = q0;
            s.M = t.minoritySupply;
        }
        // M is in the dominant side's bought asset, which is the minority's budget asset.

        Result memory res = run(dom, s, prm);
        for (uint256 k; k < dom.length; ++k) {
            uint256 i = domIdx[k];
            t.received[i] = res.qty[k];
            t.spent[i] = res.paid[k];
        }
        t.dominantBought = res.X;
        t.pFinal = res.pFinal;
        t.steps = res.steps;

        // Dominant side paid res.Y of its asset; minority is owed `payouts` of that same asset.
        if (res.Y >= payouts) {
            t.poolIn = res.Y - payouts;
        } else {
            // rounding dust only (paper Thm 6.3: Xf >= M): trim minority payouts, last first
            uint256 deficit = payouts - res.Y;
            for (uint256 i = n; i > 0 && deficit > 0; --i) {
                uint256 idx = i - 1;
                Order memory od = orders[idx];
                if (od.budget == 0 || (!od.zeroForOne) == domIsBuy || t.spent[idx] != od.budget) continue;
                if (t.received[idx] == 0) continue;
                uint256 cut = t.received[idx] < deficit ? t.received[idx] : deficit;
                t.received[idx] -= cut;
                deficit -= cut;
            }
        }
    }

    /// @dev A token0-seller's minimum price u (token1 per token0) as a maximum price in the reverse
    ///      clock (token0 per token1): floor(1/u), so the seller never trades below u. Floor is monotone,
    ///      so u = p0 maps to >= floor(r0/r1) = q0 and stays eligible. u = 0 means "any price".
    function _reverseLimit(uint256 u) private pure returns (uint256) {
        if (u == 0) return type(uint256).max;
        return FullMath.mulDiv(WAD, WAD, u);
    }
}
