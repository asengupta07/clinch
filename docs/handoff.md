# Clinch — ETHGlobal Mumbai build handoff

Nov 6, 2026 · @Arnab · revised Nov 6 after reading the full paper (arXiv 2610.36629v1, copy in `docs/2610.36629.pdf`)

> **Revision note.** The first draft reconstructed the AMM target and the two-sided routing from section headings. Both are now replaced with the paper's definitions (Sections 3 and 5). The main corrections: the chord target is computed from the cumulative auction state against the *initial* reserves, not from reserves updated after each clinch; the clock starts at the spot price; valuation exits sit exactly on the price ladder and are served by a proportional rule; the minority fill is folded into the cost curve, not the target; and the AMM mechanism is *weakly* Pareto optimal for eligible bids, not Pareto optimal. Lemma 6.2 also gives a termination price bound that replaces the step-count guess.

## Pitch

> **Research update (Nov 6, evening).** The engine was simulated before building: float reference, integer WAD mirror, and a Solidity prototype that matches it bit-exactly. Full results are in `research/FINDINGS.md`. Edits below marked *(research)* come from that work. The biggest ones: splitting gets *less*, not the same (F1); uncapped CCA is not helped by splitting, but it is not truthful (F2); certificate-only verification would break sybil-proofness (F5); the ~ε overcharge from discretization is rebated (F6); the launch needs a price ceiling (F7).

Tagline: **Clinch your token.** Alternates: *Clinch: launches that sybils can't game* / *A thousand wallets never beat one.* *(research: "same result" was wrong, since splitting usually gets strictly less)*

One line: Clinch is the first implementation of the sybil-proof adaptive clinching mechanism (Zhang, Li, Shi, Zhang, Xia, Han; arXiv 2610.36629 / ePrint 2026/2674, Oct 2026) as a token-launch auction and a Uniswap v4 batch hook, where splitting into fake wallets provably never helps.

The 30-second version for a judge: every onchain sale or batch swap today is a budget-constrained auction, and budget-constrained auctions are where sybil attacks live, because a whale can split one budget across many wallets to look like many small bidders. Uniswap's CCA fixed the timing games; it did not fix identity. Proof-of-human fixes identity by adding a KYC-like layer. Eighteen years ago Dobzinski, Lavi and Nisan gave the truthful, Pareto-optimal auction for bidders with budgets. Last week Elaine Shi's group proved it is also sybil-proof, and extended it into a two-sided AMM. We built it: a launch contract that seeds a Uniswap v4 pool, and a v4 hook that runs the two-sided AMM mechanism per batch. On a fork, a whale split 50 ways never gets more than one honest bid, and in our simulations gets less. No identity layer. Every claim has a Foundry test named after the proposition it checks.

What we are not claiming: that whales get less. They get what their budget buys. Splitting, lying about value, or ordering tricks buy nothing extra. That is the precise guarantee and we state it that way.

## Why it is needed and how it helps

The problem is that onchain allocation is a budget auction and identities are free. A token sale, an airdrop with a buy-in, a batch swap: in each one a participant has a value per unit and a budget, and the mechanism decides who gets what. The moment allocation depends on how many bidders there are, or on per-bidder caps, or on pro-rata splits, one person with many wallets beats one person with one wallet. That is why launches get sniped by 200-address clusters and why pro-rata sales fill with sybils.

The two existing fixes each give something up:

| Approach | What it fixes | What it leaves open |
| --- | --- | --- |
| Uniswap CCA (Nov 2025) | Timing games: bids spread over blocks, price only rises, uniform price per block | Uniform price is not truthful: in our simulation a whale gains 44% by shading its demand. Splitting alone does not help an uncapped CCA *(research F2)*, but any per-wallet cap added to tame whales is sybil-gameable |
| Proof of human (World ID, ZK Passport) | Per-person caps that sybils cannot defeat | Adds an identity layer; excludes people without the credential; the mechanism itself is still gameable above the cap |
| Capped, pro-rata or first-come sales | Simplicity; caps limit whales | Caps are trivially sybil-gameable: in our simulation the whale's utility goes from 40 to 602 by splitting into 50 wallets |
| Clinch (this build) | Splitting, misreporting value, and reordering provably never help, with no identity layer | Whales still get what their budget buys; needs full budget in escrow; clears in batches not per-swap |

How it helps, concretely:

- Launch teams get a sale where the outcome is a function of true budgets and true values, so the published allocation is defensible and the clearing price is honest price discovery, not a sybil race.
- Bidders get a dominant strategy: bid your real value and your real budget. There is nothing to game, so there is no edge for bots or insiders.
- LPs on the v4 hook get a batch venue where a builder-as-trader cannot profit from reordering or injecting sybil bids (the paper's Remark 2.5 and Fact 2.9: sybil-robust IC implies *no free lunch*), the same family of guarantee as Otter (same authors) but reached through gradual price ascent and clinching rather than surplus burning, and with weak Pareto optimality for eligible bids rather than welfare-within-a-class.
- Nobody has to prove they are human. Sybil resistance comes from the mechanism, which composes with any identity layer you later want to add on top.

What it costs: budgets must sit in escrow for the batch, prices are non-uniform (each bidder pays the price at which they clinched, which is correct but needs explaining in the UI), and clearing happens per batch window rather than per swap. All three are honest trade-offs and go in the README.

## Source paper and lineage

Primary: [Sybil-Proofness of Generalized Adaptive Clinching and Implications for Blockchain Mechanism Design](https://arxiv.org/abs/2610.36629), Chengkai Zhang, Yuhao Li, Elaine Shi, Mengqian Zhang, Lirong Xia, Qishen Han. arXiv 2610.36629v1, 27 Oct 2026; ePrint [2026/2674](https://eprint.iacr.org/2026/2674), received 29 Oct 2026, CC BY. Author order is randomized. Affiliations: Rutgers (Zhang, Xia, Han), Columbia/CMU (Li), CMU (Shi, Zhang).

What the paper contains, by section (read in full from the arXiv PDF; ePrint's PDF returns 403 to scripts):

| Section | Content | Status for us |
| --- | --- | --- |
| 1 | Thm 1.1 (sybil-robust, weakly Pareto optimal AMM exists); Thm 1.2 (impossibility if budgets can be overreported); Thm 1.3 sybil-proofness of fixed-supply adaptive clinching; Thm 1.4 with exogenous online supply; censorship-resilience assumption | Launch relies on 1.3; limitations cite 1.2 |
| 2 | Model: reserve curve φ, cost C(z) = φ(x0 − z) − y0; sell-Y (v, q) and sell-X (u, r) orders; exact-settlement feasibility (Def 2.2); admissible sybil strategy (Def 2.4: same-direction budgets sum ≤ true budget, opposite-direction budgets unbounded); Remark 2.5 (builder ordering); Fact 2.9 (IC ⇒ no free lunch) | Defines the exact guarantee |
| 3 | One-sided AMM clinching: clock from p0, chord target T^amm(p, X, Y), water level h, continuous evolution, events (joins, exits, lumps), stopping allocation, termination | Engine spec |
| 4 | Abstract target-based clinching (4.1); explicit dynamics (Lemma 4.4); AMM target admissible (Prop 4.6); exact settlement + IR (Thm 4.11); weak PO (Thm 4.13); one-sided sybil-robust IC (Thm 4.19) | Test names map here |
| 5 | Two-sided mechanism: minority/dominant sides at p0, minority fill folded into an extended cost curve C̃_M, one-sided run on the dominant side, reverse auction when sell-X dominates | Hook spec |
| 6 | Lemma 6.2 (termination price bound); Thm 6.3 (two-sided termination, exact settlement, IR); Thm 6.6 (two-sided sybil-robust IC); Thm 6.7 (two-sided weak PO) | Hook invariant tests |
| 7 | Thm 7.1: impossibility with budget overreporting (constant-product AMM) | Cite in limitations |

Lineage to read, in this order:

1. Dobzinski, Lavi, Nisan, *Multi-unit auctions with budget limits*, FOCS 2008 / GEB 2012. The adaptive clinching auction. Read Sections 1 to 3; the divisible-good version is what we implement.
2. Bhattacharya, Conitzer, Munagala, Xia, *Incentive compatible budget elicitation in multi-unit auctions*, SODA 2010 (cited as BCMX10). Adaptive clinching stays IC when budgets are private; Xia is a coauthor of the primary paper.
3. Shi, Zhang, Chung, Li, *Otter* (arXiv 2609.03474, Sept 2026; cited in the paper as SZCL26). Same group, the surplus-burning route to the same goal. Already built at ETHOnline 2026 (Uniswap prize); we cite it as the sibling and explain the difference.
4. Zhang, Li, Shi, Zhang, Xia, Han, *Tight Characterizations of AMM Mechanism Design under Weak Efficiency* (arXiv 2610.36635, same week). The impossibility side; cite in limitations.
5. Li, Shi, Zhang, *A Trilemma in AMM Mechanism Design*, FC 2026 (arXiv 2605.27602; cited as LSZ26). IC, weak local efficiency, uniform pricing: any two of three.
6. Goel, Mirrokni, Paes Leme, adaptive clinching with online supply (GMP13). Background for Thm 1.4.
7. Uniswap, *Continuous Clearing Auction* whitepaper, Nov 2025. The thing we compare against in the demo.
8. Yokoo, Sakurai, Matsubara, GEB 2004, and Mazorra, Della Penna, arXiv 2301.12813, for false-name-proofness background.

## The math

Three layers: the classic adaptive clinching auction (textbook), the sybil-proofness theorems, and the AMM chord target and two-sided routing, now taken directly from Sections 3 and 5 of the paper.

### A. Adaptive clinching, divisible good (Dobzinski, Lavi, Nisan 2008)

Setting: one divisible good, supply S. Bidder i has value v\_i per unit and budget b\_i. Utility is quasilinear up to the budget: q\_i × v\_i minus payment, with payment never allowed to exceed b\_i.

The mechanism is an ascending price p. State at price p: remaining supply S(p), remaining budget b\_i(p), allocation q\_i(p).

```latex
D_i(p) = \begin{cases} b_i(p)/p & p < v_i \\ 0 & p > v_i \end{cases}
```

Demand is budget divided by price while the bidder is still in; a bidder exits when p reaches v\_i. Clinching: at price p, bidder i clinches any supply the others cannot absorb.

```latex
c_i(p) = \max\bigl(0,\; S(p) - \textstyle\sum_{j \ne i} D_j(p)\bigr), \qquad S \leftarrow S - c_i, \quad b_i \leftarrow b_i - p\,c_i, \quad q_i \leftarrow q_i + c_i
```

The price rises until total demand no longer exceeds remaining supply; remaining supply is then allocated to demanders at the current price. Because demand b\_i/p falls continuously as p rises, clinching in the divisible version is continuous once it starts, which is why an implementation discretizes (see E below).

Known results (DLN 2008; BCMX 2010 for private budgets): truthful reporting of value is a dominant strategy, the outcome is Pareto optimal, and the mechanism is individually rational and budget-feasible. Each bidder pays the price at the moment of each clinch, so prices are non-uniform.

The paper's equivalent "water level" form (Section 3.2) is what we implement. With B = Σ b\_i the total remaining budget and S the residual supply, define

```latex
h := B - pS
```

Since p·D\_{−i} = B − b\_i, the clinching condition S ≥ D\_{−i} is the same as b\_i ≥ h. The invariant is b\_i ≤ h for every active bidder; the clinchers are exactly those with b\_i = h. A purchase of δ at price p lowers both B and pS by pδ, so it leaves h unchanged. That is why purchases at one price commute and the outcome is order-independent.

### B. The new result: sybil-proofness

Theorem 1.3 (fixed supply): in the adaptive clinching auction for a fixed divisible supply, truthful participation as a single identity weakly dominates every strategy that replaces the bidder with finitely many identities having arbitrary reported values and aggregate declared budget at most the bidder's true budget. Theorem 1.4 extends this to an exogenous online supply path (GMP13). Theorem 4.19 is the one-sided AMM version; Theorem 6.6 is the two-sided AMM version. All four come from one abstract target-based clinching framework (Section 4.1); fixed supply is not a special case of the AMM mechanism, both are special cases of the framework.

The precondition is the only thing that matters for us: same-direction reported budgets must be enforceable. Onchain that is free. Every bid escrows its full budget at submission, so a reported budget is a deposited budget, and the sum across any set of wallets is at most what that person actually holds. The paper also requires that escrow cannot be topped up from a sibling identity's proceeds during the batch (all transfers settle at the end), which our settle-once design gives automatically. Opposite-direction sybil bids may carry arbitrarily large budgets and the guarantee still holds (Def 2.4), so the hook does not need to cap them. The escrow is not a design choice; it is the hypothesis of the theorem.

What the theorem does not say: that a large budget gets a small allocation. A whale clinches what its budget buys at the prices it clinches at. The guarantee is that no strategy beats truthfulness, including identity strategies.

Corollary we use in the demo (Fact 2.9, no free lunch): for any reported profile, no subset of identities gains strictly in one token without losing the other in aggregate. A sandwich bot or sybil-injecting builder therefore has no risk-free profit.

What the paper assumes: a strategic builder cannot censor other traders' bids (censorship resilience at consensus). Without it, sybil-robust IC is unattainable (SZCL26).

### C. The AMM chord target (Section 3.2, eq. 11)

Notation: pool initial reserves (x0, y0), spot price p0 = −φ′(x0) (= y0/x0 for constant product). The pool's cost to release z units of X is C(z) = φ(x0 − z) − y0; for constant product

```latex
C(z) = \frac{y_0 z}{x_0 - z}, \qquad a(z) := C'_+(z) = \frac{x_0 y_0}{(x_0 - z)^2}
```

X and Y are the auction's **cumulative** allocation and payment so far, measured against the initial reserves; the state always satisfies Y ≥ C(X). The chord target is the rightmost intersection of C with the line of slope p through (X, Y):

```latex
T^{amm}(p, X, Y) := \max\{ z \in [X, x_0) : C(z) \le Y + p(z - X) \}, \qquad S := T^{amm} - X
```

Key properties (Prop 4.6):

- A fixed-price purchase of δ ≤ S moves the state to (X + δ, Y + pδ). This leaves Y − pX, and hence T, unchanged; residual supply falls from S to S − δ. (The first draft recomputed X − Y/p from updated reserves, which shrinks S by 2δ per purchase. That was wrong.)
- With the state fixed, T is nondecreasing in p.
- At termination the outcome settles exactly on the curve: Y\_final = C(X\_final) (Thm 4.11). The pool ends at (x0 − X, y0 + Y) ∈ R\_φ with no subsidy and no surplus.

Closed form for constant product. Let K := Y − pX (signed). The boundary C(z) = Y + p(z − X) becomes

```latex
p z^2 + (y_0 + K - p x_0)\, z - K x_0 = 0
```

and T is the larger root. At the initial state (X = Y = 0, K = 0) this gives T = x0 − y0/p, which is where the first draft's formula came from; it is only correct at that point.

Continuous dynamics (Lemma 4.4, eq. 38): on an event-free interval the target grows at λ = S / (a(T) − p), and the clinchers' aggregate payment rate is γ = S + pλ = S·a(T)/(a(T) − p), shared equally since every clincher stays tight at h.

Fixed supply fits the same framework with T ≡ S0 (S = S0 − X).

### D. Two-sided mechanism (Section 5)

Sell-Y orders report (v\_i, q\_i): value of one X in Y, budget in Y. Sell-X orders report (u\_i, r\_i): reservation value of one X in Y, budget in X. A sell-Y order is eligible if v\_i ≥ p0; a sell-X order is eligible if u\_i ≤ p0. Ineligible orders get nothing.

1. Measure both sides at spot, in X units: D\_Y = Σ q\_i/p0, D\_X = Σ r\_i, M = min(D\_Y, D\_X). The smaller side is the minority; on a tie, sell-X is the minority.
2. **Sell-Y dominant.** Fill every eligible sell-X order in full at p0 (S\_X,i = r\_i, R\_Y,i = p0·r\_i). Fold that supply into an extended cost curve faced by the sell-Y auction:

   ```latex
   \tilde C_M(z) = \begin{cases} p_0 z & 0 \le z \le M \\ p_0 M + C(z - M) & M \le z < M + x_0 \end{cases}
   ```

   Run the one-sided mechanism of Section 3 on the sell-Y orders with (C, T, x0) replaced by (C̃\_M, T̃\_M, M + x0); the clock still starts at p0. The initial linear piece is an initial supply lump of size M. Settle everything at once: the pool releases X\_f − M of X and receives Y\_f − p0·M of Y. Thm 6.3 proves X\_f ≥ M and Y\_f − p0·M = C(X\_f − M).
3. **Sell-X dominant.** Swap the assets: reverse spot 1/p0, reverse cost C^rev(w) = −C⁻¹(−w), minority sell-Y orders pay q\_i and receive q\_i/p0, and the dominant sell-X orders run the one-sided auction with values 1/u\_i (u\_i = 0 means "never exits"), budgets r\_i, clock from 1/p0.
4. Minority proceeds cannot finance any order in the same batch; all transfers happen at final settlement.

Closed form for the extended target (constant product, sell-Y dominant, p ≥ p0): on [0, M] the cost has slope p0 ≤ p, so T̃\_M ≥ M and T̃\_M = M + (larger root of the quadratic in C above with K := Y − pX + (p − p0)·M). With M = 0 this reduces to C. The sell-X branch is the same function with (x0, y0, p0) → (y0, x0, 1/p0).

Theorem 6.6: sybil-robust IC holds across directions, including a sell-Y trader who injects sell-X identities with arbitrary budgets to enlarge the fill or flip which side is dominant (Lemma 6.5 bounds the value of extra spot-price supply). Theorem 6.7: weak Pareto optimality for eligible bids.

### E. Discretization for the EVM

Continuous price ascent becomes a price ladder starting at the spot price (AMM) or the reserve price (launch):

```latex
p_{k+1} = \min\bigl( p_k (1+\varepsilon),\; \min\{ v_i : v_i > p_k,\ b_i > 0 \} \bigr)
```

The geometric step is capped at the next bidder value, so **every valuation exit lands exactly on the ladder**. That matters: the proportional exit rule is what makes the outcome independent of how one order is split among equal-valued identities.

At each ladder price p (Sections 3.4 to 3.5):

1. Recompute T = target(p, X, Y) and S = T − X.
2. Active = {v\_i > p, b\_i > 0}; Exit = {v\_i = p, b\_i > 0}.
3. Stopping test: if Σ\_Active b\_i/p ≤ S, give every active bidder its full demand b\_i/p at p; let L = S − Σ\_Active b\_i/p and B\_E = Σ\_Exit b\_i; give each exiting bidder (b\_i/B\_E)·min(L, B\_E/p) at p. Refund all unspent budget and end.
4. Otherwise refund every exiting budget (b\_j ← 0), set h = B − pS with the post-cancellation B, and for every active i with b\_i > h buy (b\_i − h)/p at p. These restoration purchases leave h unchanged, so their order is immaterial. They are the discrete form of the continuous clinching path, and equal the first draft's c\_i = S − D\_{−i}.
5. End if no active bidder remains or all budgets are spent; otherwise step the ladder.

Termination bound (Lemma 6.2): the clock never passes P\_B = C′(C⁻¹(B0)), where B0 is the total initial budget. For constant product, P\_B = (y0 + B0)²/(x0·y0). So the hook needs at most about

```latex
\frac{2 \ln(1 + B_0 / y_0)}{\ln(1+\varepsilon)} + n
```

steps (the + n is exit points), which is small when the batch is small relative to the pool. The launch path is bounded by ln(max v\_i / p0)/ln(1+ε) + n.

*(research)* Simulation results for this section:

- **Bound holds.** In 700 runs neither the final price nor the step count exceeded the bound by more than one ladder step (F8).
- **Discretization overcharges.** Buyers pay the top of each step, so the pool ends about 0.9ε of volume above its curve. We settle the residual as an exact-input swap of all collected Y and rebate the extra X pro-rata to quantity (F6). This lowered the worst deviation gain from 2.8e-3 to 5.3e-4 at ε = 1%.
- **Bids near spot converge badly.** A bidder whose limit sits within ε of spot sees an O(1) allocation error, because the first step jumps straight to its limit (F9). Optional fix: use ε/10 for the first ten steps.
- **Launches need a ceiling.** Fixed supply with unbounded limits never terminates, so ClinchLaunch takes a ceiling `pMax` (F7).

Proposition for our paper: the discretized mechanism's allocation and payments converge to the continuous mechanism's as ε → 0, and any bidder's gain from deviation is at most ε times its budget. State the convergence as a proposition with a proof sketch (payments are Riemann sums of the continuous clinch path; exits and lumps are hit exactly) and state the ε-IC bound as an empirical claim backed by a fuzz test, not as a theorem, unless you prove it Saturday.

### F. Comparison with Otter in one table

|  | Otter (Sept 2026, built at ETHOnline) | Clinch (Oct 2026, this build) |
| --- | --- | --- |
| Route to IC | VCG with Clarke pivot; residual surplus burnt or redistributed | Ascending price with clinching; no surplus burnt |
| Prices | Uniform-ish per side with VCG rebates | Non-uniform; price at clinch time |
| Efficiency | Welfare-maximal within natural mechanisms; Pareto only for eligible bids | Weak Pareto optimality for eligible bids (Thms 4.13, 6.7); full PO + sybil-robust IC is impossible for any AMM (SZCL26, LSZ26). Fixed-supply launch path keeps DLN's full Pareto optimality |
| Budgets | Budget caps in the model | Central: the mechanism is built for budget-constrained bidders |
| Sybil-proofness | Proven (Theorem 15) | Proven (Theorems 1.3, 4.19, 6.6), needs enforceable same-direction budgets |
| Consensus assumption | Censorship resilience required (Theorem 23) | Same: builder cannot censor bids (Section 1) |

## Architecture

&#91;embedded content: architecture · two paths, one engine\]

Both paths call the same ClinchEngine library, so one audited allocation routine backs the launch contract and the v4 hook; the launch uses a fixed supply, the hook uses the chord target against the pool's initial reserves for the batch.

Components:

| Component | Responsibility | Notes |
| --- | --- | --- |
| ClinchEngine.sol (library) | Pure allocation: given bids (value, escrowed budget) and a supply rule, run the discretized ascending-price clinching and return (allocation, payment) per bid plus the final price | No storage; fuzzed independently; the whitepaper's propositions map to its tests |
| ClinchLaunch.sol | Token sale. Issuer deposits S tokens, sets reserve price p0, ε, window. Bidders call bid(limit, budget) with budget escrowed in ETH or USDC. Anyone calls settle() after the window; proceeds seed a v4 pool at the final price (CCA-style) and allocations become claimable | Fixed-supply path, Theorem 1.3 |
| ClinchHook.sol | Uniswap v4 hook. beforeSwap rejects direct swaps; users call bid() with escrowed input; settle() at window end runs the two-sided mechanism (minority fill at spot, one-sided engine on the dominant side against the extended chord target), performs one residual swap on the PoolManager inside unlock, pays fills, refunds unused budget | Two-sided path, Theorems 6.3 and 6.6 |
| ClinchEscrow (inside each) | Holds budgets; refunds unspent budget at settle; prevents withdrawal mid-window; no intra-batch reuse of proceeds | The escrow is the theorem's hypothesis |
| Frontend | Bid form, live price ladder, per-bidder fills, whale-split comparison panel | All reads through the Anon-RPC browser harness |
| Adversary harness (Foundry + script) | Sandwich bot against a plain v4 pool vs Clinch; sybil-split bot against capped sales vs Clinch; demand-shading bot against uncapped uniform price (CCA-like) vs Clinch | Produces the demo table; Python versions already in `research/experiments/` |

Batch lifecycle (both paths): open window → bids escrowed → window closes → settle() by anyone → engine runs → fills and refunds claimable → pool state updated or pool seeded. If nobody calls settle(), nothing happens; funds stay refundable after a timeout, which is the failure path to show.

## Implementation plan

Build the engine first, fuzz it against a Python reference, then wrap it twice. Everything else waits until the engine reproduces hand-worked examples from Sections 3 and 5.

### Engine: data model and the settle loop

*(research)* A working prototype of the code below is in `research/sol/src/ClinchEngine.sol`. It matches the integer reference `research/clinch/wad.py` bit-exactly, and that reference was tested on 2,000 runs with zero pool underpayment and zero overflow. The sketch now includes its fixes:

- a numerically stable root;
- rounding directions that always push the target down (F10);
- `mulDiv` for the p·K·x0 product;
- a negative discriminant clamped to 0;
- an underflow guard on h.

```solidity
// ClinchEngine.sol (library, pure). Excerpt; see research/sol/src/ClinchEngine.sol for the full file.
struct Bid  { uint256 limit; uint256 budget; }   // limit = value v_i (Y per X), budget = q_i in Y
struct Fill { uint256 qty; uint256 paid; }       // x_i received, y_i paid

// kind 0 = fixed supply S0 (launch); kind 1 = constant-product chord target with minority fill M (hook)
struct Supply { uint8 kind; uint256 S0; uint256 x0; uint256 y0; uint256 p0; uint256 M; }

/// Paper eq. (11) / (57): T = max{ z : C~_M(z) <= Y + p (z - X) }.
/// Larger root of p z^2 + (y0 + K - p x0) z - K x0 = 0 with K = Y - pX + (p - p0) M.
/// Every rounding pushes z DOWN (z increases in K, decreases in b), so the pool is never underpaid.
function target(Supply memory s, uint256 p, uint256 X, uint256 Y) internal pure returns (uint256) {
    if (s.kind == 0) return s.S0;
    int256 K = int256(Y) - int256(mulDivUp(p, X, WAD)) + int256(mulDiv(p - s.p0, s.M, WAD)); // K down
    int256 b = int256(s.y0) + K - int256(mulDiv(p, s.x0, WAD));                             // b up
    uint256 absK = K >= 0 ? uint256(K) : uint256(-K);
    uint256 fourPkx = K >= 0 ? mulDiv(4 * p * absK, s.x0, WAD)       // 512-bit intermediate
                             : mulDivUp(4 * p * absK, s.x0, WAD);    // negative term toward -inf
    uint256 bb = uint256(b >= 0 ? b : -b); bb = bb * bb;
    uint256 disc = K >= 0 ? bb + fourPkx : (bb > fourPkx ? bb - fourPkx : 0); // clamp at tangency
    uint256 sqF = sqrt(disc);
    uint256 z;
    if (b >= 0) {   // citardauq form: no cancellation when K ~ 0 (common near spot)
        uint256 sqC = sqF * sqF == disc ? sqF : sqF + 1;   // ceil sqrt in the denominator
        uint256 den = uint256(b) + sqC;
        z = (den == 0 || K <= 0) ? 0 : mulDiv(2 * uint256(K), s.x0, den);
    } else {
        z = mulDiv(sqF + uint256(-b), WAD, 2 * p);          // floor sqrt in the numerator
    }
    z = z > 0 ? z - 1 : 0;
    uint256 T = s.M + z;
    return T > X ? T : X;
}

function settle(Bid[] memory b, Supply memory s, uint256 eps, uint256 maxSteps)
    internal pure returns (Fill[] memory f, uint256 pFinal)
{
    uint256 n = b.length;
    f = new Fill[](n);
    uint256[] memory rem = new uint256[](n);      // effective remaining budget b_i (allocated once)
    uint256 p = s.p0;                             // clock starts at spot / reserve price
    uint256 X; uint256 Y; uint256 B;
    for (uint256 i; i < n; ++i) if (b[i].limit >= p) { rem[i] = b[i].budget; B += rem[i]; } // ineligible -> 0

    for (uint256 k; k < maxSteps; ++k) {
        uint256 S = target(s, p, X, Y) - X;       // residual supply at this price

        // Active: limit > p. Exit: limit == p (exits always land on the ladder).
        uint256 dAct; uint256 BE;
        for (uint256 i; i < n; ++i) if (rem[i] > 0) {
            if (b[i].limit > p) dAct += wdiv(rem[i], p); else BE += rem[i];
        }

        if (dAct <= S) {                          // stopping allocation, eqs. (20)-(22)
            uint256 L = S - dAct;
            uint256 exitQty = min(wdiv(BE, p), L);
            for (uint256 i; i < n; ++i) if (rem[i] > 0) {
                uint256 q = b[i].limit > p ? wdiv(rem[i], p) : mulDiv(exitQty, rem[i], BE);
                _buy(f[i], rem, i, q, p);
            }
            return (f, p);                        // every unspent budget is refunded by the caller
        }

        // cancel (refund) exiting budgets, eq. (23)
        for (uint256 i; i < n; ++i) if (rem[i] > 0 && b[i].limit <= p) { B -= rem[i]; rem[i] = 0; }

        // restoration purchases down to the water level h = B - pS, eq. (24). Order-independent.
        uint256 pS = wmul(p, S);
        uint256 h = B > pS ? B - pS : 0;          // guard: stop test can fail on rounding dust alone
        for (uint256 i; i < n; ++i) if (rem[i] > h) {
            uint256 q = wdiv(rem[i] - h, p);
            uint256 paid = _buy(f[i], rem, i, q, p);
            X += q; Y += paid; B -= paid;
        }
        if (B == 0) return (f, p);                // all budgets exhausted
        if (s.kind == 0 && s.S0 <= X) return (f, p);   // fixed supply sold out: zero-trade tail (Lemma 4.5)

        // next ladder price: geometric step, capped at the next bidder value
        uint256 pn = wmul(p, WAD + eps); bool anyActive;
        for (uint256 i; i < n; ++i) if (rem[i] > 0) {
            anyActive = true;
            if (b[i].limit < pn) pn = b[i].limit;  // all remaining limits are > p here
        }
        if (!anyActive) return (f, p);
        p = pn;
    }
    revert("Clinch: ladder exhausted");
}

/// qty rounds down; payment rounds up, capped at remaining budget.
function _buy(Fill memory f, uint256[] memory rem, uint256 i, uint256 q, uint256 p) internal pure returns (uint256 pay) {
    pay = mulDivUp(q, p, WAD);
    if (pay > rem[i]) pay = rem[i];
    f.qty += q; f.paid += pay; rem[i] -= pay;
}
```

Fixed-point rules: all amounts WAD (1e18); round targets and quantities down and payments up, so the engine never over-allocates or under-collects and the state stays on or above the cost curve (Y ≥ C(X)). Assert after settle that Σ qty ≤ supply (fixed path) and that Y\_f − p0·M ≥ C(X\_f − M) with the gap bounded by rounding dust (chord path); the residual swap on the PoolManager lands exactly on the curve and the dust stays with the hook. Allocate working arrays once, outside the ladder loop (allocating inside makes memory cost grow quadratically). Bound maxSteps with Lemma 6.2: for the hook, about 2·ln(1 + B0/y0)/ln(1+ε) + n + 1 steps, each O(n); for the launch, ln(pMax/p0)/ln(1+ε) + n.

*(research)* Measured cost is about 1.8k gas per bid per step:

| Case | Gas |
| --- | --- |
| Hook, n = 50, batch 1% of pool, ε = 0.1% | 0.84M |
| Hook, batch 10% of pool, ε = 0.1% | 10M |
| Contested launch, n = 50, 3× price range, ε = 1% | 5.8M |
| Same launch, ε = 0.1% | 47M |

**Do not** fall back to "solver submits fills, contract checks the terminal certificate (Lemma 4.12)". That lemma certifies efficiency only. Many non-clinching outcomes pass it, including non-IC uniform-price ones, so certificate-only verification gives up sybil-proofness (F5). The gas fallbacks, in order:

1. A coarser ε on chain (launch ε = 1%).
2. A multi-transaction ladder that stores (p, X, Y, rem[]) between calls.
3. An optimistic solver with a challenge window, where a challenger re-runs the engine.

The hook should refuse a batch whose step bound × n exceeds its gas budget.

Order matters: every purchase at a price is computed against the same water level h, which purchases do not change, so the result does not depend on bid order. That is what makes a builder's reordering useless (Remark 2.5) and it must be a named test.

### ClinchLaunch (fixed supply)

- `constructor(token, supplyS, p0, pMax, eps, windowEnd, poolSeedParams)`; issuer transfers S tokens in. p0 is the reserve price; bids with limit < p0 are ineligible. *(research F7)* Limits above `pMax` are clamped to `pMax`, and the clock cannot pass it; the stopping allocation runs there. Without a ceiling the fixed-supply ladder never terminates.
- `bid(limit, budget)`: pull budget in quote asset to escrow; store Bid; emit.
- `settle()`: after windowEnd, anyone; run engine with kind 0; store fills; move proceeds to the v4 seeding step (initialize pool at pFinal, add proceeds + unsold tokens as a full-range position, mint position NFT to issuer).
- `claim()`: bidder receives qty tokens and (budget − paid) refund.
- `rescue()`: if not settled by windowEnd + 7 days, full refunds. This is the failure path for the video.

### ClinchHook (v4, two-sided)

- Permissions: beforeSwap, beforeAddLiquidity (optional), afterInitialize.
- `beforeSwap`: revert for direct swaps unless the sender is the hook's own settle; users instead call `hook.bid(zeroForOne, limit, budget)`, which pulls input to escrow (use ERC-6909 claims on the PoolManager where possible). Opposite-direction budgets are not capped.
- `settle()`: snapshot reserves (x0, y0) and spot p0; drop ineligible bids; compute D\_Y, D\_X, M and pick the dominant side (tie → sell-X minority); fill the minority at p0; run the engine with kind 1 and the extended target (swapping asset coordinates if sell-X dominates); inside `poolManager.unlock` perform the single residual swap; pay fills and refunds; emit the batch report. *(research F6)* Make the residual an **exact-input** swap of all collected Y\_f − p0·M. The pool releases a little more than X\_f − M, because the ladder overcharges by about ε; rebate that extra X to dominant-side buyers pro-rata to quantity. One-sided, this lowered the worst deviation gain. The two-sided rebate is not yet simulated. Minority proceeds pay out only here.
- Windows: a fixed number of blocks (demo: 5 blocks on a fork, 60 s on Sepolia).

### Test plan (Foundry)

- `test_Prop1_ConservationFixed`: Σ qty ≤ S and paid\_i ≤ budget\_i.
- `test_Prop2_ExactSettlement`: after settle, Y\_f − p0·M ≥ C(X\_f − M) and the gap is at most rounding dust (Thm 4.11 / 6.3).
- `test_Prop3_OrderIndependence`: shuffle bids, identical fills.
- `test_Prop4_SybilSplit_fuzz`: random instance; one bidder split into k identities with budgets summing to its budget and arbitrary limits; utility ≤ truthful utility + ε·budget.
- `test_Prop4b_EqualValueSplit`: split one order into k identities with the same limit; merged utility ≥ split utility − ε·budget. *(research F1: fills do NOT sum to the merged fill. Allocation can differ by up to 99%; only utility is bounded.)*
- `test_Prop11_SurplusRebate`: after the exact-input residual swap the pool is exactly on the curve, and every buyer's rebate is ≥ 0.
- `test_Prop12_LaunchCeiling`: limits above `pMax` terminate within ln(pMax/p0)/ln(1+ε) + n steps.
- `test_Prop5_Misreport_fuzz`: random limit misreports, same bound.
- `test_Prop6_IndividualRationality`: every truthful bidder pays at most its value per unit and its utility is ≥ 0; sell-Y prices ≥ p0, sell-X prices ≤ p0 (eq. 59).
- `test_Prop7_ConvergenceEps`: fills at ε and ε/2 differ by O(ε).
- `test_Prop8_TwoSidedCrossDirection_fuzz`: a sell-Y trader adds sell-X identities with arbitrary budgets; utility ≤ truthful + ε·budget (Thm 6.6).
- `test_Prop9_NoFreeLunch_fuzz`: no subset of identities ends with a gain in one token and no loss in the other (Fact 2.9); this is the sandwich-bot test.
- `test_Prop10_TerminationBound`: final price ≤ P\_B = (y0 + B0)²/(x0·y0) (Lemma 6.2).
- Differential test against `engine.py` on 1,000 random instances.
- Hand-worked examples: a one-sided chord run with an exit and a stopping allocation, and a two-sided run with a minority fill, both checked by hand in `engine.py` first.

### Build order, from now

1. Fri evening: ~~write `engine.py` reference~~ done (`research/clinch/engine.py`, `wad.py`, Solidity prototype); settle on ε: 0.1% for the hook, 1% for the launch.
2. Fri night: ClinchEngine.sol + Props 1, 3, 6 + differential test. First commit before midnight, then every 90 minutes.
3. Sat morning: ClinchLaunch + v4 seeding + Props 2, 4, 5. Adversary harness on a fork.
4. Sat afternoon: ClinchHook two-sided settle inside unlock + Props 8, 9, 10; gas measurements; decide onchain-solve vs verify-only.
5. Sat evening: frontend over Anon-RPC; whale-split comparison panel; freeze at 20:00; record raw footage.
6. Sun: paper figures from the harness, video cuts, README with line pointers, FEEDBACK.md, forms, submit 90 min early.

## Prize stack and partner checklists

Three picks. Uniswap is the primary; the second is EF; the third is World if you keep the comparison arm, Arkiv if you would rather not touch identity at all.

| Partner | Prize entered | Amounts | Why it is structural, not bolted on |
| --- | --- | --- | --- |
| Uniswap Foundation | Build with Uniswap | $4,000 / $3,000 / $2,000 / $1,000 | ClinchHook is a new v4 hook; ClinchLaunch seeds a v4 pool and is a direct alternative to CCA, which is Uniswap's own launchpad |
| Ethereum Foundation | Best Use of Anon-RPC (EF may place you in CROPS instead) | $2,500 / $1,500 / $1,000 | All reads through Anon-RPC; settle() is permissionless so the venue keeps working if our frontend and keeper vanish (the C in CROPS) |
| World | Best Use of IDKit | $1,250 (up to two teams) | The comparison arm: the same launch run with a per-human cap, so the demo shows identity-free vs identity-based sybil resistance side by side |
| Alternative third: Arkiv | Build on Arkiv (from scratch) | $3,000 / $1,000 | Pending bids as expiring entities any settler can query; "why not Postgres" has a real answer |
| Not entered: 1inch |  |  | Aqua is a maker-side strategy VM; a batch mechanism does not fit its swap-time model without distortion |

Ceiling $7,750 (with World) or $9,500 (with Arkiv); realistic $5,000.

Uniswap checklist:

- [ ] Public repo, open-source license
- [ ] `FEEDBACK.md` in the repo root: time to first working hook on a fork, what in the v4 docs was missing, one improvement with the greatest impact
- [ ] Developer feedback form submitted with the `FEEDBACK.md` link: developers.uniswap.org/hackathon-feedback
- [ ] README section "Where the Uniswap integration lives" with file paths and line numbers for the hook permissions, beforeSwap, the unlock callback, and the pool seeding
- [ ] State which parts are forked from CCA (if any) and which are new

EF checklist (Anon-RPC prize, written so a CROPS placement also qualifies):

- [ ] Frontend uses `@anon-rpc/browser-harness` for every read by default; a toggle shows the difference
- [ ] README section titled CROPS with one or two lines per letter: C (what we control, what happens if it disappears; settle() is permissionless), O (license, builds from the repo alone), P (what the RPC provider and our server learn; writes still go to a normal RPC and we say so), S (keys and user data stay on the device)
- [ ] No third-party trackers or analytics in the client
- [ ] Demo video ≤ 3 minutes showing the moment the lead property matters (switch the harness off and on; kill the keeper and settle from a cold wallet)
- [ ] Be able to explain the design, code and trade-offs on the spot

World checklist (if entered):

- [ ] IDKit integrated in a functioning flow; Proof of Human credential; proof verified on the server or onchain (mocked proofs at this event; say so)
- [ ] Explain the specific trust moment (per-human cap on a scarce launch) and why Proof of Human is the minimum sufficient credential
- [ ] Show success and one alternative path (no proof, wrong action, reused nullifier)
- [ ] Integration debrief: time to first success, friction, missing docs, one improvement

Arkiv checklist (if entered instead):

- [ ] Writes to the current testnet via `@arkiv-network/sdk`; at least one user-visible feature reads from Arkiv (the live bid book)
- [ ] README: wallet addresses that wrote entities, one query a judge can run
- [ ] `/arkiv/schema.md`, `/arkiv/friction.md`, `/arkiv/reach.md`, `/arkiv/why-arkiv.md`, `/arkiv/how-you-use-arkiv.md`
- [ ] Say how AI was used

ETHGlobal general:

- [ ] Commit history shows steady progress from Friday; no single-dump commit
- [ ] Submission text names the three partner prizes and states the censorship-resilience assumption plainly

## Whitepaper outline

Title: *Clinch: Implementing Sybil-Proof Adaptive Clinching as a Token Launch and a Uniswap v4 Batch AMM.* Eight to twelve pages, arXiv style. The paper does not re-prove the source theorems; it proves that the EVM implementation preserves them and adds one empirical and one convergence result.

1. Abstract. One paragraph: the hole, the source theorem, what we built, the three numbers from the harness.
2. Introduction. Budget auctions and free identities; CCA and proof-of-human as the two existing fixes and what each leaves open; the paper's contribution in one sentence; the Otter sibling and the difference.
3. Preliminaries. Adaptive clinching (DLN 2008) in water-level form as in section A of this handoff; the sybil theorems (1.3, 4.19, 6.6) quoted; the chord target (eq. 11) and the extended cost C̃\_M (eq. 57) as the paper defines them.
4. The implementation. The price ladder with exits pinned to bidder values; restoration purchases to the water level; the proportional exit rule; the constant-product closed form for the target; fixed-point rounding rules; the Lemma 6.2 step bound; the two wrappers.
5. Results.
   - Proposition 1 (conservation and budget feasibility). Σ qty ≤ S; paid\_i ≤ budget\_i. Maps to `test_Prop1_ConservationFixed`.
   - Proposition 2 (exact settlement up to rounding). After settle, Y\_f − p0·M ≥ C(X\_f − M), with the gap bounded by rounding dust; the residual pool swap lands on the curve. Follows from the paper's Thm 4.11 / 6.3 plus our round-down-target rule. Maps to `test_Prop2_ExactSettlement`.
   - Proposition 3 (order independence). The allocation is a function of the multiset of bids. Proof: purchases at a price all use the same water level, which purchases leave unchanged. Maps to `test_Prop3_OrderIndependence`. Corollary: builder reordering is useless.
   - Proposition 4 (convergence). As ε → 0 the discretized fills and payments converge to the continuous mechanism's; payments are Riemann sums along the clinch path, and exits and lumps are hit exactly. Maps to `test_Prop7_ConvergenceEps`.
   - Empirical claim 5 (ε-sybil-proofness). On N random instances, no split, misreport or cross-direction injection gained more than ε × budget. Maps to `test_Prop4_SybilSplit_fuzz`, `test_Prop5_Misreport_fuzz` and `test_Prop8_TwoSidedCrossDirection_fuzz`. State as empirical unless you prove the bound.
   - Proposition 6 (individual rationality). Utility ≥ 0 for every truthful bidder. Maps to `test_Prop6_IndividualRationality`.
6. Experiments. The adversary harness:
   - Whale split 1 to 100 ways under capped fixed-price, capped uniform-price, uncapped uniform-price and Clinch.
   - Demand shading under uniform price vs Clinch.
   - Sandwich-bot profit on plain v4 vs Clinch (no free lunch).
   - Adversarial sybil, misreport and cross-direction search with gain vs ε.
   - Gas for settle at n = 5, 20, 50 and ε = 1%, 0.1%, 0.01%, against the Lemma 6.2 step bound.

   Figures: whale utility vs number of wallets (`research/results/fig_whale_split.png`; Clinch falls, capped sales rise); max deviation gain vs ε (`fig_sybil_gain.png`); gas vs n. First pass already in `research/FINDINGS.md`.
7. Limitations. Censorship resilience assumed at consensus (the paper's Section 1, Otter's Theorem 23); full Pareto optimality is impossible with sybil-robust IC, so the AMM gets weak PO for eligible bids only; the guarantee needs non-overreportable budgets (Thm 1.2 / 7.1 shows it fails otherwise); non-uniform prices; escrow during the window; a paper from late Oct 2026 and what we could and could not verify independently.
8. Related work. CCA, Otter, Chan–Wu–Shi, the FC 2026 trilemma, the companion characterization paper, GMP13, Canidio–Fritsch, CoW, Angstrom, pm-AMM, Bunni.
9. Appendix. Gas tables; the hand-worked examples; rounding proofs.

Figure 1 (allocation vs wallets) is also the hero shot of the video and the first screen of the dashboard.

## Demo video, 2:50

One master cut under 3:00 satisfies every partner on the stack. Burned-in subtitles; judges watch muted. Every claim gets a receipt on screen for two seconds.

| Time | Screen | Voice |
| --- | --- | --- |
| 0:00 | A real launch chart: first block bought by one cluster of 40 addresses, Etherscan tags visible | "This is one person. Every onchain sale is a budget auction, and identities are free." |
| 0:15 | Two cards: CCA (timing fixed, identity open) and Proof of Human (identity fixed, adds a credential) | "The two fixes each give something up." |
| 0:30 | Paper title and date, then one line: *truthful bidding is dominant, even across fake identities* | "Last week Elaine Shi's group proved an 18-year-old auction is sybil-proof, and made it an AMM. We built it." |
| 0:45 | Launch UI: three wallets bid (limit, budget); escrow tx; the price ladder animates; clinches light up as price rises | "Price rises. When everyone else can't absorb the supply, you clinch it, at that price." |
| 1:15 | settle() called from a fourth wallet; fills and refunds; v4 pool seeded at pFinal; Etherscan links | "Anyone settles. Proceeds seed a Uniswap v4 pool at the discovered price." |
| 1:35 | The hero figure (`research/results/fig_whale_split.png`): whale utility vs wallets. Capped-sale lines rise (40 → 602); Clinch line falls (680 → 270); uncapped uniform price flat, with a callout that shading demand earns +44% there | "Caps invite fifty wallets. Clinch makes fifty wallets worse than one, and lying worse than truth." |
| 1:55 | The v4 hook: swaps collected into a window, minority side filled at spot, settle() runs the clinching auction, one residual swap on the PoolManager; the sandwich bot's balance before and after; on-screen receipt: *Fact 2.9, no free lunch* | "The same engine runs a batch swap venue. A bot that reorders or injects bids earns nothing, and that's a theorem." |
| 2:15 | Optional World arm: the same launch with a per-human cap; a wallet without a proof rejected; reused nullifier rejected | "If you want per-person fairness on top, add identity. The mechanism no longer needs it for honesty." |
| 2:30 | Failure path: kill the frontend and keeper; settle from a cold wallet via Anon-RPC; harness toggle shows the RPC provider seeing or not seeing the address | "It keeps working without us, and nobody learns who bid." |
| 2:42 | Feedback card: Uniswap and EF, three lines each: time to first success, what was missing, one improvement | "What we'd fix in the docs." |

Record raw footage Saturday evening while everything works; cut Sunday morning. If the two-sided hook is not solid by Saturday 20:00, cut the 1:55 segment to the one-sided hook (Section 3 mechanism, Thm 4.19) and say so in the limitations.

## Risks and what to say when pushed

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Engine diverges from the paper's mechanism (exits, lumps, extended target) | Medium | Spec now taken from Sections 3 and 5 directly; `engine.py` implements the event rules literally and the Solidity is differential-tested against it; the engine takes a supply rule as input so the target is a one-function change |
| The paper has an error (nobody outside the authors has checked it) | Low but real | Your Props 1 to 3 and 6 hold regardless of the paper; the sybil claim is backed by your own fuzz tests; if a fuzz test finds a profitable split, you have found something and you report it, which is a result |
| settle() gas too high for n = 50 onchain | Measured *(research)*: hook fine (0.84M at 1% depth); a contested launch needs ε = 1% (5.8M) | Coarser ε, a multi-transaction ladder, or an optimistic solver with challenges. Never certificate-only verification (F5) |
| Judges say "whales get even more under Clinch" | Medium | True in our simulation: 87% vs 71% under uniform price (F3). The claim is about incentives, not distribution; caps via identity compose on top |
| v4 unlock callback plumbing eats Saturday | Medium | Use the v4-template repo; do the launch path first so there is a complete product even if the hook slips |
| Judges say "Otter already did sybil-proof batches" | High | Same group, different mechanism: no surplus burning, built for budget-constrained bidders, and a launch product not just a swap hook; have the comparison table from section F ready |
| Judges say "whales still win" | High | Correct, and we say so first: the guarantee is that no strategy beats truthfulness, not that budgets are capped; identity caps compose on top, which the World arm demonstrates |
| Judges say "so it's not Pareto optimal" | Medium | Full Pareto optimality plus sybil-robust IC is provably impossible for AMMs (SZCL26, LSZ26); weak PO for eligible bids is the best possible, and the launch path keeps DLN's full Pareto optimality |
| Devnet or Anon-RPC harness instability | Low | Fork for everything; Anon-RPC toggle degrades to a normal RPC with a visible warning |

Failure paths to show on camera, each with the same production quality as the happy path: rescue() refunds after an unsettled window; a bid with budget below the minimum rejected; a swap that bypasses the hook reverted; settle from a cold wallet after the keeper dies; World arm rejections if entered.

The sentence to memorize for the EF judge: "Adaptive clinching raises the price continuously and lets you clinch whatever the others can no longer absorb at that price. Truthfulness was known since 2008. Sybil-proofness, given escrowed budgets, is Theorem 1.3 of a paper from last week, and our escrow is exactly its hypothesis."

## References

1. Zhang, Li, Shi, Zhang, Xia, Han. [Sybil-Proofness of Generalized Adaptive Clinching and Implications for Blockchain Mechanism Design](https://arxiv.org/abs/2610.36629). arXiv 2610.36629v1, 27 Oct 2026; Cryptology [ePrint 2026/2674](https://eprint.iacr.org/2026/2674), 29 Oct 2026.
2. Dobzinski, Lavi, Nisan. Multi-unit auctions with budget limits. FOCS 2008; Games and Economic Behavior 2012.
3. Bhattacharya, Conitzer, Munagala, Xia. Incentive compatible budget elicitation in multi-unit auctions. SODA 2010.
4. Shi, Zhang, Chung, Li. [Otter: A Provably MEV-Resilient AMM via Surplus Redistribution](https://arxiv.org/abs/2609.03474). arXiv 2609.03474, Sept 2026; ePrint 2026/1877. Built at ETHOnline 2026: [otter-mev.vercel.app](https://otter-mev.vercel.app/), [github.com/mansi0xc/otter](https://github.com/mansi0xc/otter).
5. Zhang, Li, Shi, Zhang, Xia, Han. [Tight Characterizations of AMM Mechanism Design under Weak Efficiency](https://arxiv.org/abs/2610.36635). arXiv 2610.36635, Oct 2026.
6. Li, Shi, Zhang. [A Trilemma in AMM Mechanism Design](https://arxiv.org/abs/2605.27602). FC 2026.
7. Chan, Wu, Shi. Mechanism design for automated market makers. AFT 2025.
8. Goel, Mirrokni, Paes Leme. Clinching auctions with online supply. (GMP13; cited for Thm 1.4.)
9. Uniswap Labs. [Continuous Clearing Auction](https://docs.uniswap.org/contracts/liquidity-launchpad/CCA), Nov 2025; [whitepaper PDF](https://docs.uniswap.org/assets/files/whitepaper_cca-fc8b989c3a5b11f6fcd199f6c6837a77.pdf); repo github.com/Uniswap/continuous-clearing-auction.
10. Canidio, Fritsch. Arbitrageurs' profits, LVR, and sandwich attacks: batch trading as an AMM design response. 2024.
11. Yokoo, Sakurai, Matsubara. The effect of false-name bids in combinatorial auctions. GEB 2004.
12. Mazorra, Della Penna. The Cost of Sybils, Credible Commitments, and False-Name Proof Mechanisms. arXiv 2301.12813.
13. Ethereum Foundation. [Anon-RPC](https://ethereum.github.io/anon-rpc/); [browser harness on npm](https://www.npmjs.com/package/@anon-rpc/browser-harness); [EF mandate (CROPS)](https://blog.ethereum.org/2026/03/13/ef-mandate).
14. Uniswap v4 docs, hooks and PoolManager unlock: developers.uniswap.org/docs; hackathon feedback form developers.uniswap.org/hackathon-feedback.
15. World ID: docs.world.org/world-id/idkit/integrate; Proof of Human credential docs.world.org/world-id/credentials/1.
16. Arkiv: docs.arkiv.network; hub.arkiv.network.

As of 6 Nov 2026. Item 1 was read in full from the arXiv PDF (local copy `docs/2610.36629.pdf`); items 4, 5, 9 and 13 were opened directly.
