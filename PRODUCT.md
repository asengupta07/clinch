# Product

## Register

product

## Users

Two groups, both crypto-literate:

- **Bidders and traders.** People joining a token launch or swapping on a Clinch pool. They arrive from the landing page or a shared launch link, usually with a wallet connected and a specific question: what will I get, at what price, and when can I claim. They are often skeptical of launchpads that reward bots and wallet farms.
- **Judges, issuers and protocol people.** Evaluating whether the mechanism is real. They click through the live launch, settle it themselves, inspect the ladder replay, and check that numbers on screen match the chain.

Context: desktop first (bidding, comparing fills), but launch links get opened on phones and must work there.

## Product Purpose

Clinch runs token launches and Uniswap v4 batch markets as sybil-proof adaptive clinching auctions. The app lets people escrow a bid or order, see live what the auction would do with it, settle permissionlessly, replay how the price climbed, and claim. Success means a first-time user can place an honest bid, understand why bidding the truth is optimal, and verify their own result without reading the paper.

## Brand Personality

Precise, calm, trustworthy. A financial instrument, not a casino. The app lives in the same world as the landing page (dark ink, mint, warm amber for the rising price, Newsreader for big moments, Geist for UI, Geist Mono for numbers) but quieter: decoration gives way to data, and the live visuals (price ladder, fills, curves) are the hero of each page.

## Anti-references

- Generic DeFi dashboards and launchpads: neon gradients, glowing cards, rainbow token pills, countdown hype, casino energy.
- Bland admin templates: gray cards in a uniform grid, default shadcn look, tables with every row boxed.

## Design Principles

1. **Show the mechanism working.** Every screen leads with a live, honest visual of what the auction does (ladder, fills, preview) rather than a wall of stats.
2. **Numbers you can check.** Every figure on screen traces to the chain or the engine; label estimates as estimates and show when the preview matches the chain.
3. **Truth is the easy path.** The bid and order flows make the honest action obvious and explain non-uniform prices at the moment they matter, never in a lecture.
4. **Permissionless means visible.** Settle, claim and rescue are first-class actions anyone can take, not buried admin buttons.
5. **Calm under money.** No motion or color competes with an amount the user is about to sign.

## Accessibility & Inclusion

WCAG 2.2 AA: 4.5:1 body text contrast (3:1 large text), full keyboard flow with visible focus, color never the only signal for state (pair with icon or text), reduced-motion fallbacks for every animation, tap targets at least 44px on touch.
