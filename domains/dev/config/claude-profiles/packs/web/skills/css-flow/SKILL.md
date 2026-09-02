---
name: css-flow
description: Use when writing or reviewing CSS and boxes in normal flow don't space the way it looks like they should — margins that don't add up, spacing that changes when a layout becomes flex/grid, "fixing" a gap with padding without knowing why, or choosing between margin, gap, and the stack pattern for inter-item spacing. Covers margin collapse (when it happens, the resulting value, and where it's structurally blocked), the flex/grid refactor trap, and current spacing patterns (gap, the stack pattern, single-direction margins).
metadata:
  verified: 2026-09
---

# CSS Flow

## Overview

Normal-flow spacing looks additive — write `margin-bottom: 1em` on one box
and `margin-top: 1em` on the next, and the code reads like it says "put 2em
between these." It doesn't. In normal flow, adjacent block-direction margins
don't stack — they negotiate, and the negotiated value is often smaller than
either margin alone. This skill covers that negotiation (margin collapse:
when it happens, what value it resolves to, and where it's structurally
blocked), the refactor trap it sets for layout edits, and the spacing
patterns that avoid depending on it at all. Future sections will extend this
skill to flexbox, grid, and positioning — the mechanisms a container opts
into once it steps out of normal flow.

## Margin Collapse

Margin collapse only touches **block-direction margins** (`margin-top`/
`margin-bottom` in horizontal writing mode) between boxes in the same block
formatting context. Inline-direction margins (`margin-left`/`margin-right`)
never collapse, under any circumstance.

Three shapes trigger it:

- **Adjacent siblings** — one box's `margin-bottom` meets the next box's
  `margin-top`, when nothing between them prevents it (see below).
- **Parent and first/last child ("collapse through")** — a parent's
  `margin-top` collapses with its first child's `margin-top` (and
  equivalently for `margin-bottom`/last child) when nothing separates them:
  no border, no padding, no inline content, no established height, no new
  formatting context on the parent. The parent's margin box then behaves as
  if the child's margin were its own.
- **An empty block's own margins** — a block with no content, no height, and
  no border/padding has nothing keeping its own `margin-top` and
  `margin-bottom` apart, so they collapse with each other.

## The Resulting Value

Collapsing is not "pick one" — the two margins combine per sign:

- **Two positives**: the larger wins outright — `max(a, b)`. `margin-bottom:
  16px` meeting `margin-top: 19.92px` collapses to `19.92px`, not `35.92px`.
- **A positive and a negative**: they sum — `margin-bottom: 20px` meeting
  `margin-top: -10px` collapses to `10px`.
- **Two negatives**: the more negative wins — the collapsed value is the one
  further from zero.

Why the spec works this way: each margin declares the minimum space its box
needs around it, like a personal-space bubble. When two boxes each ask for
space, satisfying the larger request satisfies both — adding them would
double-count space neither box actually asked the other to respect. This is
also why collapse can *feel* like a bug the first time: `1em` meeting `1em`
and rendering as `1em`, not `2em`, is the mechanism working as specified, not
a rendering glitch.

## Where Collapse Does NOT Happen

The review-relevant list — collapse is blocked by any of:

- **Padding or border between the margins** — even `1px` of border or `1px`
  of padding on the parent stops parent-child collapse-through; the margins
  no longer touch each other.
- **A new block formatting context (BFC) on the parent** — `display:
  flow-root`, `overflow` set to anything but `visible`, `contain: layout`
  (or `paint`/`content`/`strict`), `position: absolute`/`fixed`, `float`,
  `display: inline-block`, or `display: table-cell`. A new BFC contains its
  children's margins entirely — nothing collapses out of it.
- **Floats and absolutely/fixed-positioned boxes** — floated and
  out-of-flow boxes don't participate in collapse at all, in either
  direction.
- **Flex and grid children** — the one that matters most for reviews:
  **margins on children of a flex or grid container never collapse**, with
  each other or with the container. `gap` on the parent is the flex/grid
  replacement for the spacing collapse used to provide in normal flow.

## The Refactor Trap

Spacing authored under collapse assumptions breaks the moment the parent
changes layout mode. A list item with `margin-top: 1em` and `margin-bottom:
1em` renders `1em` between items in normal flow (collapse takes the max) —
change the list's `display` to `flex` or `grid` for an unrelated reason (to
add wrapping, alignment, or a new column), and collapse stops applying. The
same two `1em` margins now render as `2em`, and if the diff also added `gap`
for the flex/grid change, the visible spacing can nearly triple.

"flex にしたら隙間が広がった" is almost always this, not a sizing bug.
AI-driven layout edits hit it constantly, because "add `display: flex` to
fix alignment" and "leave the existing margins alone" are two independently
reasonable-looking edits that combine into a regression. When reviewing a
diff, check whether `display: flex` or `display: grid` was added to a
parent whose children already carry both `margin-top` and `margin-bottom` —
that combination is the signal.

## Spacing Patterns

In order of preference for new code:

1. **Flex/grid parent + `gap`** — spacing owned entirely by the container,
   no collapse semantics involved at all. This is why "children of flex/grid
   never collapse" is a feature, not a gap in the spec: `gap` replaces
   collapse as the single source of truth for inter-item space.
2. **The stack pattern for normal flow**, when the parent isn't flex/grid:
   ```css
   .stack > :where(* + *) {
     margin-block-start: var(--stack-gap, 1rem);
   }
   ```
   The adjacent-sibling combinator (`* + *`, the "lobotomized owl" selector)
   matches every element that has a preceding sibling, so the first child
   gets no top margin and nothing needs a `:first-child` override. Wrapping
   it in `:where()` keeps the rule at zero specificity (see `skill:
   css-cascade`), so any component inside the stack can override its own
   spacing with a single class instead of fighting the pattern.
3. **Single-direction margins, project-wide** — when neither of the above
   applies, pick one direction (block-start only, or block-end only) for a
   given component family and never mix both directions on the same
   components. A single direction can't collapse against itself and doesn't
   depend on sibling order the way alternating-direction margins do.

The smell these patterns remove is the **first-child hack** — `margin-top`
on every item, undone with `:first-child { margin-top: 0; }` (or
`:last-child` for the mirror case). It works, but it's solving a problem the
stack pattern doesn't have: the hack exists only because double-direction
margins were used in the first place.

## Ties

- Components should own no outer margin — spacing is the parent/layout's
  responsibility, not the component's. This is the same spacing-ownership
  rule `agent: web-platform-reviewer`'s methodology lane enforces for
  `.yoki.json`-configured projects; the stack pattern and `gap` are the two
  ways to honor it without hardcoding spacing into the component being
  built.
- `skill: defensive-css`'s "space between sibling elements shouldn't
  collapse or double up" row is the same failure mode from the
  content-risk angle: a flex/grid parent's `gap` survives content changes
  that a margin-based layout doesn't.

## Common Mistakes

- **Expecting margins to collapse inside flex/grid** — debugging a "why
  isn't my spacing what I calculated" question by looking at collapse rules
  that don't apply to flex/grid children at all.
- **"Fixing" a collapse by adding padding without knowing which rule
  triggered it** — padding does block collapse, but adding it to silence an
  unexpected gap, without identifying which of the four blocking conditions
  was missing, produces spacing nobody can explain on the next change.
- **`overflow: hidden` added only to stop parent-child collapse** — it works
  (a new BFC blocks collapse-through) but clips any content that was
  supposed to overflow; `display: flow-root` blocks collapse with no
  clipping side effect.
- **Assuming horizontal margins collapse** — inline-direction margins never
  collapse, in any writing mode; a symmetric layout bug in `margin-left`/
  `margin-right` has a different cause.
- **Assuming a negative margin "wins" the way `max()` does for positives** —
  two negative margins collapse to the one further from zero, not the one
  closer to it.
- **The stack-pattern owl written unscoped at the document level**
  (`* + * { margin-top: 1rem; }` with no `.stack >` prefix) — it applies to
  every adjacent pair on the page, not just the intended container.

## Related

- `css-cascade` — the `:where()` zero-specificity mechanism the stack
  pattern relies on
- `css-units` — the units the resulting margin/gap values are expressed in
- `defensive-css` — `gap` over margin as a content-risk mitigation
- `web-platform-reviewer` — the agent that flags the flex/grid refactor trap
  in diffs
