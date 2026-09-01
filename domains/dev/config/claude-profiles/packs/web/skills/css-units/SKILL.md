---
name: css-units
description: Use when writing or reviewing CSS and a unit-choice question comes up — px vs rem vs em, why a nested component's font keeps shrinking, `line-height` overlapping on a bigger-font child, a fixed root `font-size`, `100vh` jumping or overflowing on mobile, or a fluid `clamp()`/`calc()` value that ignores the user's zoom/font-size setting. Covers em/rem resolution, the em-compounding trap, unitless line-height, the small/large/dynamic viewport unit family, container query units, and WCAG 1.4.4 zoom-safe fluid typography.
metadata:
  verified: 2026-09
---

# CSS Units

## Overview

`px` thinks in one screen: it is an absolute length, so `16px` is `16px`
regardless of context. Relative units make one number scale many things —
change it once and a whole component, or the whole page, resizes with it.

`px` ignores two things a relative unit picks up automatically. The first is
page zoom — browser zoom scales `px` right along with everything else, so
"px doesn't zoom" is not the actual failure mode. The second is the
browser's default-font-size setting, the accessibility control users raise
from 16px to 20px or higher: relative units (`em`, `rem`, `%` on
`font-size`, `ch`, `lh`) move with that setting; `px` does not. Fixing
`html`/`:root`'s `font-size` in `px` kills that setting for the entire page —
every `rem` on the page is now anchored to the author's fixed number instead
of the user's chosen one. That is the anti-pattern this skill keeps coming
back to.

## em Resolution

`em` resolves differently depending on which property carries it:

- On any property **except** `font-size`, `1em` = the element's own
  **computed** font-size.
- On `font-size` itself, `1em` = the **inherited** (parent's) font-size —
  otherwise the definition would be circular, a property defining its own
  input.

Worked numbers, body at 16px:

```css
.x { font-size: 1.2em; padding: 1.2em; }
```

`font-size` resolves against the inherited 16px → `1.2 * 16 = 19.2px`.
`padding` resolves against `.x`'s *own* computed font-size, which is now
19.2px → `1.2 * 19.2 = 23.04px`.

This is exactly why `em` earns its keep for component-internal sizing: a
button's padding, border-radius, and gap written in `em` scale as one unit
off a single `font-size` change:

```css
.btn-lg { font-size: 1.125rem; }   /* padding/radius/gap in em ride along */
```

## The Shrinking Font Problem

`em` on `font-size` **compounds** through nesting, because each level's
`em` resolves against its parent's already-scaled size, not the root. `0.8em`
on a nested `<ul>`, four levels deep:

```
16px → 12.8px → 10.24px → 8.192px
```

each level is 80% of the level above it, not 80% of the root every time.

`rem` looks only at the root element's font-size, so every nesting level
gets the same absolute size no matter how deep it sits. Rule: `font-size` in
`rem`; component-internal spacing (padding, gap, border-radius, icon size)
in `em`.

## line-height

`line-height: 1.2em` (or a `px` value) is computed once, on the parent, and
inherited to children as that fixed **length**. A child with a larger
font-size than the parent then gets a line-height smaller than its own
text — overlapping lines.

Unitless `line-height: 1.5` inherits as a **ratio**, not a computed length —
each descendant recomputes `1.5 * its own font-size`. Always write
`line-height` unitless.

## Unit-by-Job Table

| Job | Unit | Why |
|---|---|---|
| `font-size` | `rem` | anchored to the root, doesn't compound through nesting |
| Component padding / border-radius / gap | `em` | scales with the component's own font-size as one unit |
| Borders, shadows, hairlines | `px` | a 1px border should stay 1px regardless of type scale |
| `line-height` | unitless | inherits as a ratio, recomputes per element |
| Measure (line length) | `ch` (`max-width: 65ch`) | the advance width of the font's `0` glyph — a stand-in for average character width, so 65ch ≈ 65 characters per line |
| Spacing in "lines" | `lh` / `rlh` (Baseline 2023) | one line's height as a length; `rlh` is root-relative |
| Container-relative size | `cqi` / `cqw` / `cqb` (Baseline 2023) | scales with the space a component is given, not its font — the modern neighbor of `em` |
| Viewport-relative | `sv*` / `dv*` / `lv*` | see Viewport Units below |

## Root font-size

To set a 14px base: `:root { font-size: 0.875em; }` — `em`/`%` on `:root`
resolves against the browser's default font-size (usually 16px), not a fixed
number, so the user's setting still moves the base. Never set it in `px`.

The "62.5% trick" (`html { font-size: 62.5%; }`, so `1rem = 10px`) is
discouraged for three reasons: the resulting base is small enough that most
components have to re-set their own font-size anyway; you're still thinking
in px, just with an extra conversion step; and — the practical killer today —
Tailwind and most UI libraries assume `1rem = 16px`, so every third-party
spacing value silently shrinks to 62.5% of its intended size.

## Media Queries

`em`/`rem` inside `@media (...)` **always** resolve against the browser's
default font-size, never against whatever `:root`'s font-size has been set
to. Changing `:root { font-size }` does not move your breakpoints — a
common surprise on a page that also uses the 62.5% trick, where breakpoints
stop lining up with the "obvious" px equivalent.

`@container` queries are different: `em` inside a container query resolves
against the **container's** font-size, not the browser default.

## Viewport Units

`100vh` is unreliable on mobile because it ignores whether browser chrome
(URL bar, tab strip) is shown or hidden — `100vh` overflows the visible area
when chrome is shown, or the page jumps when chrome hides mid-scroll.

- `lv*` (large viewport) — sized as if chrome were **hidden**. Largest value.
- `sv*` (small viewport) — sized as if chrome were **shown**. Smallest value.
- `dv*` (dynamic viewport) — tracks chrome **live**; recomputes as it
  shows/hides, which itself causes layout shift during scroll.

Defaults: `min-height: 100svh` for heroes/sections — safe and static, never
causes shift. `100dvh` only for a fixed app shell that genuinely must track
the live viewport. For old-browser support, declare both in old-then-new
order so the fallback gets overridden, not fought:

```css
.hero { height: 100vh; height: 100dvh; }
```

Horizontally, `sv`/`lv`/`dv` are effectively equal — browser chrome eats
vertical space, not horizontal. `vi`/`vb` are the logical (writing-mode
aware) inline/block forms of viewport units. `vmin`/`vmax` size against
whichever axis is smaller/larger — an orientation-independent square is
`90vmin`.

## Fluid Values

A viewport-only `font-size: 2vw` is too small on phones, too large on
desktops, and — carrying no `em`/`rem` term at all — ignores the user's
font-size setting entirely. `calc(0.5em + 1svw)` at least mixes a
user/root-relative term with a viewport term, but the ratio between them is
still fixed.

Prefer `clamp(min, preferred, max)` with `rem` in both `min` and `max`,
**and** a `rem` term inside `preferred`:

```css
font-size: clamp(0.9rem, 0.6rem + 0.5vw, 1.5rem);
```

Accessibility check for any `clamp()`: at 200% browser zoom the text must
roughly double (WCAG 1.4.4). Zoom does not grow the viewport term, so the
`rem` term must carry enough weight to make up the difference — a
`preferred` value built from `vw` alone, with no `rem`/`em` term, fails
this check.

`min()`/`max()` compose the same way for non-font values:
`width: min(60ch, 100% - 2rem)`; `min-height: max(200px, 20vh)`.

## Common Mistakes

- **Fixing `html`/`:root` `font-size` in `px`** — silently disables the
  browser's default-font-size accessibility setting for the whole page.
- **62.5% trick on a project that also uses Tailwind or a UI library** —
  every third-party spacing value shrinks to 62.5% of its intended size.
- **`em` on `font-size` in a component that nests itself** (lists, trees,
  comment threads, nested cards) — compounds per level instead of staying
  constant; use `rem`.
- **`line-height` written in `px`/`em`** — inherits as a fixed length; a
  larger-font child gets overlapping lines.
- **Assuming `:root`'s font-size moves `@media` breakpoints** — media-query
  `em`/`rem` always resolves against the browser default, not `:root`.
- **`100vh` for a mobile hero/section** — overflows or jumps as browser
  chrome shows/hides; use `100svh`.
- **Fluid `font-size` with a `vw`-only preferred term** — fails WCAG 1.4.4
  because the viewport term does not grow under 200% zoom.
- **`px` used for component padding/gap that should scale with a
  `font-size` change** — the component stops scaling as one unit and needs
  a manual edit at every size variant.

## Related

- `css-cascade` — cascade resolution order and specificity mechanism
- `css-modern` — modern syntax replacements for legacy CSS idioms
- `defensive-css` — content/environment robustness intent table
- `web-platform-reviewer` — the agent that enforces unit hygiene on diffs
