# Clinch design system (app)

Read PRODUCT.md first. This file is the visual contract for the app routes (`/launches`, `/launches/:address`, `/markets`, `/markets/:poolId`, `/how-it-works`). The landing page (`/`) has its own, louder treatment in `app/src/landing/`.

## Feel

Same world as the landing page, calmer. A precise financial instrument in dark ink. Decoration gives way to data; on each page the live mechanism visual is the hero (price ladder, fill bars, buy/sell depth, price-range position), not a grid of stat boxes.

## Theme and colour

Tokens live in `app/src/index.css` (`:root` = dark default, `[data-theme="light"]` = light peer). Never hard-code hex in pages; use the Tailwind token classes.

| Role | Token / class | Use |
| --- | --- | --- |
| Page | `bg-bg` | Body. Ambient glow + grain is applied by `Layout` (`.app-ambient`). |
| Surfaces | `bg-surface`, `bg-surface-2`, `bg-surface-3` | Panels, raised rows, inputs/hover. |
| Hairlines | `border-line`, `border-line-strong`, `ring-line` | Separation. Prefer space and hairlines over boxes. |
| Text | `text-ink`, `text-ink-2`, `text-ink-3` | Primary, secondary, tertiary (all AA on bg). |
| Accent (mint) | `bg-accent text-accent-ink`, `text-accent`, `bg-accent-soft`, `ring-accent-line` | Primary actions, current selection, "yours", success, live state. Never decoration. |
| Price (amber) | `text-price`, `bg-price`, `bg-price-soft` | The clock price, clearing prices, "being clinched now", waiting states. |
| Bad | `text-bad`, `bg-bad-soft` | Errors, cancelled. |
| Charts | `--chart-1..4` | Multi-series only. |

Strategy: Restrained. Mint and amber together stay under ~10% of any screen.

## Typography

- UI: Geist (`font-sans`). Numbers, prices, amounts, addresses: Geist Mono via the `.num` class (tabular).
- Page titles only: Newsreader via `<PageHeader>` (`.title-serif`, 40/52px, italic `<em>` for one emphasised word at most). No serif anywhere else: not in cards, labels, buttons or data.
- Scale (fixed rem, ratio ~1.2): 12 (meta), 13/13.5 (labels, table), 14/15 (body, buttons), 17/18 (stat values), 22/26 (panel hero numbers), 32-44 (one hero figure per page, mono).
- Labels sentence case. No uppercase tracked eyebrows.

## Shape

Controls are pills (`rounded-full`: buttons, segmented, chips, status). Inputs `rounded-xl`. Surfaces `rounded-[18px]` (`Card`) or `rounded-2xl` for nested rows. Never nest a card inside a card; inside a card use `bg-surface-2` rows or hairlines.

## Components (app/src/components/ui.tsx)

Use these; extend locally only when a page needs something genuinely new.

- `PageHeader({ title, meta, actions, back })` for every page top.
- `StatusPill({ tone: live|waiting|done|stopped|idle })`: state is always icon + text.
- `RangeBar({ min, max, value, minLabel, maxLabel, valueLabel, log })`: a price's position between reserve and ceiling (or spot band).
- `Progress({ value, label, tone })`: thin, labelled.
- `TokenMark({ symbol })`: deterministic monogram for tokens.
- `Card`, `CardHeader`, `Stat`, `Badge`, `Notice`, `Empty`, `Field`, `NumberInput`, `Segmented`, `Table/th/td`, `Button`, `buttonStyles`, `Term` + `TERMS`, `Address`, `CopyButton`, `Skeleton`.

Every interactive element has default, hover, focus-visible, active, disabled, loading. Loading uses `Skeleton` shaped like the final content. Empty states teach the next action.

## Layout

- Container: `mx-auto max-w-[1240px] px-4 sm:px-6`.
- Detail pages: two columns on `lg` (`grid lg:grid-cols-[minmax(0,1fr)_380px] gap-6`), the action panel (bid / order form) `lg:sticky lg:top-24` on the right; single column below `lg` with the action panel directly after the hero visual.
- Vertical rhythm varies: 24px within a panel, 40-56px between sections. Not every section is a card.
- Lists: rows with hover, not boxed rows. Tables only for genuinely tabular data.

## Motion

Motion conveys state only: 150-250ms, `ease-[var(--ease-out-quint)]`, transform/opacity. Allowed: value changes easing (bars, markers), list items entering, tab indicator, panel open. Not allowed: page-load choreography, looping decoration (the `live-pulse` dot on genuinely live state is the one loop). Everything respects `prefers-reduced-motion` (`useReducedMotion` from `motion/react`).

## Copy

Plain, specific, calm. No em dashes. Explain non-uniform prices where fills are shown, once, with `Term`. Estimates are labelled as estimates; chain-verified values say so.

## Accessibility

WCAG 2.2 AA. Keyboard reachable everything, visible focus (global `:focus-visible`), 44px touch targets on mobile, colour never the only signal, reduced motion honoured.
