---
name: defensive-css
description: Use when writing or reviewing CSS and content or environment risk appears — long/short/missing text, empty lists, extreme image aspect ratios, flex/grid children without wrap, undefined custom properties, narrow viewports, missing background images. Covers gap over margin, @container over @media, overflow-wrap/text-overflow, object-fit, flex-wrap, auto-fill over auto-fit, background-repeat, var() fallbacks, min-width:0 on flex children, scrollbar-gutter.
metadata:
  verified: 2026-09
---

# Defensive CSS

## Overview

Intent: write CSS that survives content and environments it was not written
for — a name twice as long as the design mockup, a list with zero items, an
image with the wrong aspect ratio, a translation string that doubles in
length, a custom property nobody set. Most CSS is authored against one happy
case (the design file, the seed data) and breaks the moment real data or a
real browser diverges from it. This skill is a checklist of failure modes and
their current, Baseline-native mitigation.

Origin: the intent catalog below is drawn from https://defensivecss.dev/ by
Ahmad Shadeed — extracted as intent, not copied text, and expressed in the
modern CSS forms from `skill: css-modern`.

## Defensive Intents

| Intent | Modern defensive form | Mechanically checkable? |
|---|---|---|
| Space between sibling elements shouldn't collapse or double up when content wraps | Parent `gap` (flex/grid), not child `margin` | Yes — child margin used for inter-item spacing inside a flex/grid parent |
| A component's layout must adapt to its container, not just the viewport | `@container (min-width: …)` on a sized `container-type: inline-size` ancestor, not `@media` | Yes — component-scoped breakpoint written as `@media` |
| Long unbroken strings (emails, IDs, names) must not blow out a fixed-width box | `overflow-wrap: anywhere` (or `text-overflow: ellipsis` with `overflow: hidden; white-space: nowrap` when truncation is preferred) | Yes — fixed-width text container with neither property |
| Images at an unexpected aspect ratio must not distort or overflow | `object-fit: cover` (or `contain`) on a sized `<img>`/`<video>` | Yes — sized image without `object-fit` |
| Flex items must not force horizontal overflow when the container narrows | `flex-wrap: wrap` on the flex container | Yes — flex container with no `flex-wrap` declared |
| A grid of unknown item count should fill available tracks without stretching lone items | `grid-template-columns: repeat(auto-fill, minmax(...))`, not `auto-fit` | Warn only — `auto-fit` is sometimes intentional (centering a short row) |
| A missing/failed background image should not tile unpredictably | Explicit `background-repeat: no-repeat` whenever `background-image` is set | Yes — `background-image` without `background-repeat` |
| A custom property that nobody set upstream should not silently invalidate the declaration | `var(--x, <fallback>)` wherever the property isn't guaranteed set at the point of use | Partial — `stylelint-value-no-unknown-custom-properties` catches undefined names, not missing runtime values |
| A flex child with long unbreakable text must not force the row wider than its parent | `min-width: 0` on the flex child (flex items default to `min-width: auto`, which ignores overflow) | Yes — flex child with text content and no `min-width: 0`/`min-inline-size: 0` (beyond the source — commonly agreed addition, not in the original catalog) |
| A scrollable list appearing/disappearing must not shift layout when the scrollbar appears | `scrollbar-gutter: stable` on the scroll container | No — needs a rendered before/after comparison (beyond the source — commonly agreed addition, not in the original catalog) |

## Stress fixtures = the unit tests of CSS

CSS has no compiler to catch "this breaks when the list is empty." The
equivalent is a fixed set of adversarial inputs run through Storybook/Playwright,
every time the component changes:

- **Long name** — a string 2-3x longer than the design mock, unbroken (no
  spaces) and with spaces, in the same story.
- **Empty string** — the field that is sometimes `""`, not just absent.
- **Extreme image aspect ratio** — a 1:4 portrait and a 4:1 panorama through
  the same `<img>` slot.
- **0 and 50 items** — the empty-state and the overflow-state of any list/grid.
- **Narrow viewport** — 320px width, the floor most teams forget to test.

Plus a generic horizontal-overflow assertion that catches anything the fixed
fixtures above didn't anticipate:

```js
test('no horizontal overflow at narrow width', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const overflowing = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflowing).toBe(false);
});
```

Run axe alongside these fixtures — defensive layout and accessibility failures
often share the same broken markup (e.g., a truncated label that also lost its
accessible name).

## Common Mistakes

- **`overflow-wrap: anywhere` used where truncation was intended** — it
  breaks the word instead of hiding the overflow; pick truncation
  (`text-overflow: ellipsis`) when the design shows a clipped end, wrapping
  when the design shows a shorter line.
- **`object-fit: cover` without `object-position`** — the default center crop
  can cut off the subject (a face, a logo) in an off-center source image.
- **`auto-fill` chosen for a row that should center a small item count** —
  `auto-fill` leaves phantom empty tracks; `auto-fit` collapses them. The
  "prefer auto-fill" default has this one legitimate exception.
- **`min-width: 0` applied to the flex container instead of the overflowing
  child** — the fix belongs on the item that has the long content, not its
  parent.
- **`var(--x, fallback)` fallback is another undefined variable** — fallback
  chains must bottom out in a literal value.
- **Stress fixtures added once and never re-run** — a later change re-adds
  the failure mode; wire the horizontal-overflow assertion into CI, not just
  a manual Storybook check.

## Related

- `css-modern` — modern syntax replacements for legacy CSS idioms
- `web-platform-reviewer` — the agent that enforces this table on diffs
- `storybook-guidelines` (react pack) — where the stress fixtures live as stories
