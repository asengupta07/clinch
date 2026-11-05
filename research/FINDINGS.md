# Clinch core: pre-build research findings

Nov 6, 2026. Everything here is reproducible from this folder (commands at the end). The engine follows Sections 3 to 5 of arXiv 2610.36629 (local copy `../docs/2610.36629.pdf`).

## What was built

| File | What it is |
| --- | --- |
| `clinch/engine.py` | Float reference engine: one-sided clinching on a price ladder, fixed-supply and constant-product chord targets, minority fill folded into the cost curve, two-sided wrapper, paper utilities (eqs. 5, 6) |
| `clinch/wad.py` | Integer WAD engine that mirrors the Solidity line by line, with an overflow check on every intermediate |
| `sol/src/ClinchEngine.sol` | Solidity prototype of the same engine, used for gas numbers |
| `experiments/exp_*.py` | Invariants, adversarial sybil search, convergence, baselines, WAD differential, Solidity differential |
| `results/` | JSON outputs and two figures |

## Headline results

1. **The mechanism holds up empirically.** Across 200 random instances × 400 adversarial evaluations per mode, no split, misreport, cross-direction injection, or free-lunch bot gained more than ε × budget. The worst gains shrink faster than ε: 2.8e-3 at ε = 1%, 1.5e-5 at ε = 0.1%.
2. **Integer engine is safe.** 2,000 WAD runs spanning 18 orders of magnitude of reserves and 12 of price gave zero pool underpayment, zero budget or IR violations, and zero overflow. The largest intermediate was 235 bits, leaving 20 bits of headroom.
3. **Solidity matches Python bit-exactly** on the differential instance: same X, Y, final price, and step count.
4. **Gas is about 1.8k per bid per ladder step.** The hook is fine at ε = 0.1% for batches up to about 1% of the pool. The contested launch needs ε = 1% or an off-chain path.

## Findings that change the plan

### F1. "Same result" is wrong: splitting gets strictly less

The pitch says "a whale split 50 ways gets exactly what one honest bid gets" and "One wallet or a thousand, same result." The engine shows splitting usually *hurts* the splitter. In the whale experiment, utility fell from 680 at one wallet to 270 at 100 wallets. Equal-value splits change allocation by up to 99% while utility never rises (`split_gain` ≤ 1e-4 at ε = 0.1%). This matches the theorem, which says truthful *weakly dominates*. It does not say outcomes are equal.

**Change:** pitch becomes "splitting never helps, and usually hurts." Hero line is "Clinch line falls," not "flat." Drop `test_Prop4b_EqualValueSplit` as written ("fills sum exactly to merged fill"). Test utility instead.

### F2. Uncapped uniform-price auctions (CCA-like) are not sybil-gameable by splitting

Splitting a whale into N identical wallets changes nothing in a uniform-price auction without caps: the line is flat at 276. Splitting only pays when there are **per-wallet caps**. Under a fixed-price capped sale, utility goes from 40 to 602; under a uniform-price capped sale, from 49 to 361. The handoff's video line "Plain pool and CCA lines rise" is false for an uncapped CCA.

What uniform price *does* get wrong is truthfulness. The whale gains **+44%** (276 → 396) by shading its budget to 67.5% and its limit to 80% (demand reduction). Under Clinch the best report found is the truthful one (680).

**Change:** compare against *capped* sales for the sybil story (that is what real launches use against whales), and against uncapped uniform price for the truthfulness story. Clinch is the only mechanism here that is both truthful and needs no cap. See `results/fig_whale_split.png`.

### F3. Clinch does not reduce whale share; it can raise it

In the same instance the truthful whale gets 87% of supply under Clinch versus 71% under uniform price. Say this before a judge does. The guarantee is about incentives, not distribution.

### F4. The first-draft target was wrong, and costly

The first draft used `X − Y/p` on reserves updated after each clinch. It withholds up to **20%** of the pool supply the paper's target would sell (median 2.4%). Its ε-IC constant is also about 5ε, against well under ε for the paper's target. The paper's target is now in all three engines.

### F5. The verify-only gas fallback is unsound as planned

The handoff planned to let an off-chain solver submit fills and have the contract check only "invariants plus the terminal certificate (Lemma 4.12)." Lemma 4.12 certifies *efficiency* (weak Pareto optimality). Many outcomes satisfy it, including uniform-price ones that are not IC. A solver could submit a certificate-valid outcome that is not the clinching outcome, and sybil-proofness would be gone.

**Change:** the gas fallbacks are (a) a coarser ε on chain, (b) an optimistic solver with a challenge window, where challengers re-run the engine, or (c) splitting the ladder across several transactions with stored state. Do not ship certificate-only verification.

### F6. Discretization overcharges by about ε; rebate it

With the plain ladder, buyers pay at the top of each step. The pool ends above its curve by about 0.9ε of volume (0.9% at ε = 1%, 0.08% at ε = 0.1%). That is a real cost to users.

**Fix tested:** settle the residual as an exact-input swap of all collected Y. The pool then releases slightly more X than the engine allocated, and the extra X is rebated to buyers pro-rata to quantity. The pool lands exactly on the curve and the overcharge goes back to users. The worst deviation gain *fell* from 2.8e-3 to 5.3e-4 at ε = 1%, with zero cases above ε. It departs from the paper's exact settlement, so state it as our design choice backed by the fuzz result. The two-sided rebate is not yet tested.

### F7. A launch needs a price ceiling, and steps scale with the price range

Fixed supply with unbounded limits never terminates: the price ran to about 10⁷ × reserve in 185k steps, and allocations only converge as p → ∞. With limits capped at c × reserve, steps are at most ln(c)/ln(1+ε) + n. A contested 50-bidder launch over a 3× price range costs 47M gas at ε = 0.1% and 5.8M at ε = 1%.

**Change:** ClinchLaunch takes a `pMax`. Limits above it are clamped, and at `pMax` the stopping allocation runs. Use ε = 1% on chain, or the multi-transaction ladder.

### F8. Lemma 6.2 bound holds, overshooting by at most one step

The final price never exceeded P_B·(1+ε), where P_B = (y0 + B0)²/(x0·y0), and the step count never exceeded 2·ln(1 + B0/y0)/ln(1+ε) + n + 1 (0 violations in 700 rows). Use this bound to size `maxSteps` and to reject batches that would not fit in a block.

### F9. Allocation error is O(1) for bidders valued within ε of spot

When a bidder's limit sits within ε of p0, the first ladder step jumps straight to that limit and sells a whole chord at one price. One instance (limit 0.3% above spot) gave 6.9 units at ε = 1% against 4.3 in the continuous limit. Feasibility and IC still hold; only the convergence constant is bad. Median allocation error is about 0.7ε.

**Option:** start the ladder with finer steps near p0, for example ε/10 for the first 10 steps.

### F10. Rounding directions in `target()` matter

The first WAD version underpaid the pool by 1 to 2 wei in 26 of 300 runs. Every rounding in the root has to push z down:

- K rounds down (`mulDivUp` on p·X).
- b rounds up.
- The negative K-term of the discriminant rounds toward −∞.
- Use ceil(√) in the `2Kx0/(b+√D)` branch and floor(√) in the `(√D − b)/2p` branch.
- Clamp a negative discriminant to 0. This happens at tangency; it was not an overflow.

After these changes there were zero underpayments in 2,000 runs. All of this is in `wad.py` and `ClinchEngine.sol`.

## Numbers

### Adversarial search (max gain / budget, 200 instances × 400 evals)

| Mode | ε = 1% | ε = 0.1% | Cases > ε |
| --- | --- | --- | --- |
| AMM, sybil split (k ≤ 8) | 2.8e-3 | 1.5e-5 | 0 |
| AMM + surplus rebate | 5.3e-4 | 3.6e-6 | 0 |
| AMM, value misreport | 2.5e-3 | 9.5e-6 | 0 |
| Fixed-supply launch, sybil split | 2.8e-5 | 8.5e-8 | 0 |
| Two-sided, cross-direction sybils (unbounded opposite budgets) | 1.7e-3 | 4.2e-6 | 0 |
| Two-sided free-lunch bot | 0 | 0 | 0 |
| Draft target (control) | 5.0e-2 | 5.0e-3 | 2 |

### Invariants (2,000 instances, ε = 0.1%)

Over-allocation, budget violation, order dependence, prices below spot, and two-sided settlement error were all at float noise (≤ 2e-13). IR violations were exactly 0. Settlement surplus was up to 1.4e-4 of volume (see F6).

### Sandwich, plain constant-product pool (10k/10k) vs Clinch

| Victim (Y) | Slippage | Plain-pool bot profit | Clinch free lunch |
| --- | --- | --- | --- |
| 100 | 0.5% | 0.51 Y | 0 |
| 500 | 1% | 5.25 Y | 0 |
| 500 | 3% | 15.7 Y | 0 |
| 1000 | 5% | 54.7 Y | 0 |

### Gas (Solidity prototype, via-IR, optimizer 200)

| Path | n | Batch / pool | ε | Steps | Gas |
| --- | --- | --- | --- | --- | --- |
| Hook | 20 | 1% | 0.1% | 10 | 0.42M |
| Hook | 50 | 1% | 0.1% | 10 | 0.84M |
| Hook | 50 | 10% | 1% | 12 | 1.0M |
| Hook | 50 | 10% | 0.1% | 110 | 10.2M |
| Hook | 50 | 10% | 0.01% | 1083 | 99.8M |
| Launch | 50 | contested, 3× range | 1% | 106 | 5.8M |
| Launch | 50 | contested, 3× range | 0.1% | 874 | 47.5M |

### Recommended defaults

- **Hook:** ε = 0.1% with the surplus rebate. Reject or split batches whose Lemma 6.2 step bound × n exceeds about 15M gas.
- **Launch:** ε = 1%, a `pMax` ceiling, and a multi-transaction ladder if the sale is large.

## Still open

- Two-sided surplus rebate is untested.
- No proof of the ε-IC bound. The data suggests the gain is O(ε²) or better for the paper's target; it stays an empirical claim.
- The fine-near-spot ladder from F9 is not implemented.
- The multi-transaction ladder and the optimistic solver from F5 are not designed.
- The Solidity prototype has no two-sided wrapper, no reverse-coordinates path, and no `pMax`.
- The adversarial search is random search plus hill climbing, not a proof. Structured attacks (such as identities placed exactly at other bidders' limits) are covered only by chance.

## Reproduce

```bash
cd research
python3 experiments/exp_invariants.py 2000
python3 experiments/exp_sybil.py 200 400 amm,rebate,misrep,cross,naive,fixed,nfl
python3 experiments/exp_convergence.py 100
python3 experiments/exp_baselines.py
python3 experiments/exp_wad.py 2000
(cd sol && forge test -vv)
python3 experiments/exp_sol_diff.py
python3 experiments/make_figures.py
```
