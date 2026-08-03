---
name: css-modern
description: Use when writing or reviewing CSS and a legacy idiom appears — 100vh on mobile, viewport media queries for component layout, !important or specificity escalation, hex/rgba with Sass darken, JS class toggling to style a parent, div-based modals, scroll listeners, margin-left/right, duplicated grid tracks. Covers nesting, container queries, :has(), logical properties, dvh/svh, subgrid, @layer, OKLCH, popover, view transitions, text-wrap, :user-valid.
metadata:
  verified: 2026-08
---

# Modern CSS

## Overview

Models reach for pre-2022 CSS by default: viewport media queries, `!important`,
`100vh`, JS for anything relational. Nearly all of it now has a native
replacement that is Baseline. This skill is a replacement-judgment table — the
third column matters as much as the second.

Rule: reach for the native feature unless the third column applies. Do not add
a JS dependency for something the cascade now does.

## Replacement Table

| Legacy default models emit | Current form | When the legacy form is still right |
|---|---|---|
| Flat BEM chains (`.card__title--active`) or Sass `&__` concatenation for structure | Native nesting with `&` | Selector would nest >3 deep (flatten instead); `&__` **string concatenation** has no native equivalent — write the full class |
| `@media (min-width: 768px)` to lay out a component | `@container (min-width: 30rem)` on a `container-type: inline-size` parent | Genuinely viewport-scoped concerns: page gutters, `prefers-*`, print, viewport-relative typography |
| JS toggling `.has-error` / `.is-empty` on a parent | `:has()` | State that is not expressible in the DOM (async, derived, cross-tree). `:has()` in very hot selectors can cost recalc — measure |
| `margin-left` / `padding-right` / `text-align: left` | `margin-inline-start`, `padding-inline-end`, `text-align: start` | Physical direction is the actual intent (a drop shadow, an icon that must stay on the screen's left regardless of script) |
| `height: 100vh` for full-screen sections | `100dvh` (or `100svh` for guaranteed-visible, `100lvh` for max) | Fixed-height desktop-only chrome where dynamic resize would cause layout jank; `svh` when content must never be occluded |
| Nested grid re-declaring parent track sizes by hand | `grid-template-columns: subgrid` | Child genuinely owns its own track sizing, or the alignment is one-off enough that `display: contents` is simpler |
| `!important`, `#id .a .b .c` escalation, `:where()` sprinkled to win specificity | `@layer reset, base, components, utilities;` — order decides, not specificity | Overriding a third-party stylesheet you cannot layer; single-file page with no cascade conflicts (layers are overhead) |
| `#3b82f6`, `rgba(0,0,0,.5)`, Sass `darken()`/`lighten()` | `oklch()` for palettes, `color-mix(in oklab, …)` for tints/shades and alpha | Design tokens are handed over as fixed hex by a design system; exact brand-color match required (OKLCH conversion can shift it) |
| `<div class="modal">` + focus-trap JS + backdrop div | `<dialog>` + `showModal()` for modals; `popover` attribute for menus, tooltips, non-modal overlays | Complex nested/stacked flows where you need custom dismiss ordering, or a design that requires the backdrop to stay interactive |
| No page transition, or a FLIP/animation library for route changes | `document.startViewTransition()` (same-document); `@view-transition` for MPA | `prefers-reduced-motion` — always gate it; MPA form still needs a fallback (see Baseline notes) |
| `window.addEventListener('scroll', …)` + `requestAnimationFrame` for progress bars/reveals | `animation-timeline: scroll()` / `view()` | Firefox support gap (see below) — treat as progressive enhancement; scroll position feeding non-visual logic (analytics, virtualization) still needs JS |
| Manual `<br>` in headings, JS balancers, `max-width` guessing to avoid orphans | `text-wrap: balance` for headings, `text-wrap: pretty` for body copy | `balance` is capped at ~6 lines by implementations — do not use it on paragraphs; long text where the extra layout pass matters |
| `:invalid` styling that fires red on first paint | `:user-valid` / `:user-invalid` (only after interaction) | Server-rendered form replayed with known-bad values, where you *want* errors visible before the user touches anything |

## Baseline Status Where Support Is Still Limited

Everything above is Baseline widely available **except**:

- **Popover** — Baseline newly available (Jan 2025); widely available projected
  2027. Safe today for evergreen targets; `<dialog>` is the older, safer pick.
- **Same-document view transitions** — Baseline newly available since Firefox
  144 (Oct 2025). **Cross-document** (`@view-transition`) is still Chromium +
  Safari only; Firefox falls back to a normal navigation, which is acceptable.
- **Scroll-driven animations** — not Baseline. Chromium and Safari 18+ only;
  Firefox ships it in Nightly and it is an Interop 2026 priority. Ship it as
  enhancement over a readable static layout, never as the only path.
- **`text-wrap: pretty`** — Chromium 117+, Safari 26+, Firefox 134+; degrades
  silently to normal wrapping. `text-wrap: balance` has broader support.

## One Worked Example

The single most common legacy cluster — a "card responds to sidebar width"
component — collapses to this:

```css
@layer components {
  .card-grid { container-type: inline-size; }

  .card {
    padding-inline: 1rem;                       /* not padding-left/right */
    background: color-mix(in oklab, var(--surface) 92%, black);
    min-block-size: 0;

    & h3 { text-wrap: balance; }                /* native nesting */
    &:has(img) { grid-template-columns: 6rem 1fr; }   /* no JS class toggle */
  }

  @container (min-width: 30rem) {               /* not @media */
    .card { grid-template-columns: 1fr 2fr; }
  }
}
```

## Common Mistakes

- **Container queries without `container-type`** — the query silently never
  matches. The container must be an ancestor, never the queried element itself.
- **`container-type: size`** when `inline-size` was meant — `size` requires a
  definite block size and collapses height-auto content.
- **`@layer` declared after the rules it should order** — the `@layer a, b, c;`
  statement must come first, before any layered rule.
- **`oklch()` lightness treated as HSL lightness** — `oklch(50% …)` is
  perceptual mid-gray, not HSL's 50%. Recheck contrast after conversion.
- **`dvh` on a container that must not resize** — dynamic viewport units change
  as browser chrome hides, which reflows. Use `svh` where stability matters.
- **`<dialog>` opened with `.show()` when a modal was intended** — only
  `showModal()` gives the top layer, backdrop, and focus trapping.
- **View transitions without `prefers-reduced-motion` gating** — vestibular
  accessibility regression.
- **`:has()` written as `:has(> .child)` when a descendant was meant** — the
  combinator is relative to the subject, and `>` scopes it to direct children.

## Related

- `frontend-craft` — visual direction and implementation constraints
- `human-interface-guidelines` — cognitive/a11y evaluation
- `ui-ux-pro-max` — palette, font pairing, style search
