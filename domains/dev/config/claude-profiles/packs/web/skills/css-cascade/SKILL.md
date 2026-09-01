---
name: css-cascade
description: Use when writing or reviewing CSS and a cascade-resolution question comes up — which declaration wins, why an override didn't apply, `!important` fights, `@layer` ordering, a shorthand silently resetting a longhand, an `:is()`/`:has()` selector list, edge-count shorthand values (padding/margin/inset), inheritance keywords (inherit/initial/unset/revert), or missing `:focus-visible` in a hover/active chain. Covers the full cascade sort order, the three-column specificity model, forgiving vs non-forgiving selector lists, and @supports feature queries.
metadata:
  verified: 2026-09
---

# CSS Cascade

## Overview

The cascade is not "last rule wins" or "most specific selector wins" — it is a
fixed multi-step sort, and each step only breaks ties left by the step before
it. Most cascade bugs come from reasoning about the wrong step: escalating
specificity when the real fix is a layer, or fighting source order when the
real cause is `@layer`. This skill is the mechanism the reviewer's "Cascade
Hygiene" lane assumes — read it to know *why* a finding is true, not just that
it is.

## Cascade Resolution Order

Highest-priority step first. Each step applies only when every step above it
tied:

1. **Origin & importance** — user-agent, user, and author stylesheets, each
   split into normal and `!important` declarations. Author `!important` beats
   author normal; this is the one step where `!important` operates directly.
2. **Context (Shadow DOM)** — encapsulation boundary between a shadow tree and
   its host document. For normal declarations the **outer** context wins (the
   host page's `::part()`/`:host` styling overrides the component's own
   defaults); for `!important` declarations the **inner** context wins (a
   component can pin a style so the page cannot undo it). That asymmetry is
   what lets a web component ship overridable defaults and a few protected
   invariants at the same time.
3. **Element-attached styles** — the `style=""` attribute. It outranks every
   selector-based rule at the same origin/importance, which is why inline
   styles are the traditional "nothing beats this" escape hatch — and why they
   are hard to override later without another inline style or `!important`.
4. **`@layer`** — among layered normal declarations, the *later*-declared
   layer wins regardless of specificity; unlayered author styles count as one
   implicit final layer and beat every named layer. Inside `!important`,
   layer order reverses — the *earliest* layer's `!important` wins. This
   reversal is intentional: it lets a base/reset layer's important overrides
   (rare, but used for things like accessibility resets) survive later layers.
5. **Specificity** — compared only among declarations that tied every step
   above, i.e. **within the same layer**. This is the key teaching point:
   `@layer` is the structural answer to specificity fights. A rule in a later
   layer with `*` beats a rule in an earlier layer with ten chained IDs — the
   comparison never even reaches specificity. It's also the structural answer
   to "added without removing": put resets and third-party overrides in an
   early layer, and anything in a later layer is guaranteed to win without a
   single specificity trick.
6. **`@scope` proximity** — among tied specificity, the rule whose `@scope`
   root is closer to the element wins.
7. **Source order** — the final tiebreaker: later in the stylesheet (or later
   `<link>`/`<style>`) wins.

## Specificity

Compare three columns, left to right, and stop at the first difference. Never
sum a selector's parts into one number.

| Column | Counts |
|---|---|
| ID | `#id` |
| Class-tier | `.class`, `[attr]` / `[attr=value]`, `:pseudo-class` (`:hover`, `:nth-child()`, `:not()` itself contributes 0 but see below) |
| Element-tier | element/type selectors (`div`, `a`), `::pseudo-element` |
| Zero | `*`, combinators (` `, `>`, `+`, `~`), `:where(...)` — always contributes (0,0,0) no matter what's inside it |

Column-by-column, never additive: `(0,10,0)` (ten classes) is **less**
specific than `(1,0,0)` (one ID), because the ID column is compared first and
differs.

`:is()`, `:not()`, and `:has()` take the specificity of their **most specific
argument** — `:not(.a, #b)` counts as `(1,0,0)`, not zero, even though `:not()`
itself is a pseudo-class. `:nth-child(An+B of S)` adds the specificity of `S`
on top of the pseudo-class's own class-tier count.

`:where()` is the deliberate exception: it always contributes zero, which
makes it the tool for resets and library styles. Write a reset as
`:where(ul, ol) { margin: 0; }` and any consumer overrides it with one class,
no `!important` and no specificity arms race.

## Selector Lists: Forgiving vs Not

A selector list where **any one entry** is invalid causes the browser to drop
the **entire ruleset** — not just the bad entry — on browsers that don't
recognize it. `:is()` and `:where()` are the exception: they are *forgiving*
selector lists, so an unsupported entry inside them is dropped and the rest
still matches. `:has()` is **not** forgiving (the spec changed this in 2023),
so treat it like a plain selector list, not like `:is()`.

```css
/* Old browsers drop this WHOLE rule — :user-invalid isn't recognized */
input.invalid, input:user-invalid { outline: 2px solid red; }

/* Old browsers drop only the unrecognized branch; input.invalid still matches */
input:is(.invalid, :user-invalid) { outline: 2px solid red; }

/* Explicit feature-gate when you need the rule to be conditional, not just resilient */
@supports selector(:user-invalid) {
  input:user-invalid { outline: 2px solid red; }
}
```

## Feature Queries

`@supports (prop: value)` tests a declaration; `@supports selector(...)` tests
a selector; combine with `not`/`and`/`or`. Use `@supports` to switch a
**group** of related declarations atomically. For a single declaration,
`@supports` is usually overkill — just write the old declaration, then the
new one immediately after; an unsupported new value is ignored and the old
one stands (cascade order does the work, no feature query needed).

## Shorthands Reset What You Didn't Write

A shorthand sets **every** longhand it covers, including the ones you didn't
mention — those get reset to their initial value, not left alone.

- `font:` resets `font-style`, `font-variant`, `font-weight`, `font-stretch`,
  and `line-height`, in addition to setting `font-family`/`font-size`.
  `font: 32px/1.5 sans-serif` also sets `line-height: 1.5`.
- Same trap class for `background`, `border`, `margin`/`padding`, `grid`,
  `animation`, `transition`, `inset`.

```css
.title { font-weight: 700; }

/* later, same element */
h1.title { font: 2rem/1.2 sans-serif; } /* bold is gone — font: reset font-weight to normal */
```

A shorthand written **after** a longhand in the *same* declaration block
silently discards the longhand — `stylelint`'s
`declaration-block-no-shorthand-property-overrides` catches exactly this
case. Across separate rulesets (like the example above), no linter catches
it automatically — that's a review finding, not a lint failure.

## Edge-Count Shorthands

Box-edge properties (`margin`, `padding`, `border-width`, `inset`) read
clockwise from the top:

- 4 values: top, right, bottom, left (TRBL)
- 3 values: top, right/left (right's value copies to left), bottom
- 2 values: vertical, horizontal
- 1 value: all four

Coordinate-style properties (`background-position`, `transform-origin`,
`object-position`) are **not** TRBL — they're a point on a plane: x then y.
Mixing up "walk the four sides clockwise" with "a point on a plane" is the
usual source of a background or transform landing in the wrong spot.

Logical equivalents sidestep the ambiguity entirely: `padding-block` sets
block-start/block-end (one value = both, two = start then end),
`padding-inline` sets inline-start/inline-end — no clockwise-vs-coordinate
guessing, and they stay correct under `writing-mode`/`direction` changes.

## Inheritance Keywords

- **`inherit`** — take the parent's computed value, even for properties that
  don't naturally inherit.
- **`initial`** — reset to the property's specification-defined initial
  value, ignoring both inheritance and whatever the cascade would have set.
- **`unset`** — acts like `inherit` on naturally-inheriting properties (color,
  font-*) and like `initial` on non-inheriting ones (margin, border) — the
  "I don't know/care which kind this is" keyword.
- **`revert`** — roll back to what the user-agent (or user) stylesheet would
  have applied, undoing every author-origin declaration.
- **`revert-layer`** — roll back only to the value from an earlier cascade
  layer, undoing just the current layer's contribution.
- **`all: <keyword>`** applies that keyword to every property on the element
  in one declaration — a deliberate "touch everything" operation, useful for
  isolating a component root before applying its own styles from scratch.

## Link/Interaction State Order

`:link`, `:visited`, `:focus-visible`, `:hover`, `:active` all have the same
specificity when written as plain pseudo-classes on the same selector, so
**source order decides**. The traditional order is LVFHA, and two constraints
in it are non-negotiable:

- `:link`/`:visited` first — they are base states; any interaction state
  written before them would be overridden by the base.
- `:active` last — while the element is pressed it is also hovered (and
  often focused), so it must come after both to win.

Between `:focus-visible` and `:hover` the choice is deliberate, not
traditional: if the two rules touch the **same properties** (say both set
`background`), a later `:hover` hides keyboard focus whenever the pointer
happens to rest on the element — put `:focus-visible` *after* `:hover` in that
case. If focus is expressed only through `outline` (the recommended form,
since hover rules rarely touch it), the relative order does not matter and
LVFHA is fine.

Missing `:focus-visible` in a chain that styles `:hover`/`:active` is an
accessibility defect, not a style nit — keyboard users lose all visual
indication of where focus is.

## Common Mistakes

- **Fighting specificity instead of reaching for `@layer`** — chaining
  classes or adding an ID purely to out-rank another rule, when the real
  problem is that both rules should live in explicitly ordered layers.
- **Forgetting `!important` reverses layer order** — an `!important` in an
  early layer beats a later layer's `!important`, the opposite of normal
  layer precedence, so moving a rule into `!important` inside the wrong layer
  makes it lose, not win.
- **Treating `:has()` like `:is()`** — assuming an unsupported argument
  inside `:has()` degrades gracefully; it invalidates the whole selector list
  like a plain comma-separated list.
- **`:where()` skipped in reset/library code** — a reset written with plain
  selectors carries real specificity, so every consumer has to escalate
  (extra classes, `!important`) just to override a default.
- **Shorthand after longhand across separate rulesets** — no linter flags
  this by default; the shorthand silently wins because it comes later in
  source order and resets the property the longhand had set.
- **`background-position`/`transform-origin` written as if they were TRBL** —
  swapping x/y instead of top/right/bottom/left produces a plausible-looking
  but wrong two-value shorthand.
- **`unset` used where `initial` or `inherit` was actually meant** — `unset`
  hides which branch (inherited vs reset) will actually run for a given
  property, especially on custom properties, which always inherit.
- **`:hover`/`:active` styled with no `:focus-visible` rule at all** —
  keyboard-only users get no visual state change anywhere in the interaction.

## Related

- `css-modern` — modern syntax replacements for legacy CSS idioms
- `defensive-css` — content/environment robustness intent table
- `web-platform-reviewer` — the agent that enforces cascade hygiene on diffs
</content>
