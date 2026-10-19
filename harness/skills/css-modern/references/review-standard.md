# CSS review standard

The one CSS standard for both the model writing CSS and `code-reviewer`
reviewing a CSS diff (`.css`, `.scss`, `<style>` blocks, CSS-in-JS objects,
Tailwind class lists). It lists what to check and where the rule comes from;
mechanism and code live in the skills it links: `css-cascade` (cascade sort
order, specificity, selector lists, shorthands, link-state order),
`css-flow` (margin collapse, gap, the stack pattern), `css-units` (em/rem,
line-height, viewport units, zoom-safe fluid type), `css-modern` (legacy
idiom to native replacement table) and `defensive-css` (content and
environment risk, stress fixtures). Markup semantics and accessibility live
in `semantic-html/references/review-standard.md`; JSX component logic in
`react-patterns`.

Before applying any rule, read the project's `browserslist` (`package.json`
key or `.browserslistrc`), the CSS toolchain (PostCSS, Lightning CSS, Sass,
Tailwind and its version), its stylelint config, whether the file is a global
sheet, a CSS module or CSS-in-JS, and what the project's `AGENTS.md` /
`CLAUDE.md` says about methodology, token location and spacing ownership. A
recommendation outside the supported browser matrix is not a fix.

Sources are cited by the short name in the first column of section 1.
Defensive CSS is linked only; its content is not reproduced here.

## 1. Sources

| Short | Source | URL | Covers | Freshness | Licence |
|---|---|---|---|---|---|
| MDN | MDN Web Docs, CSS reference pages named per item | https://developer.mozilla.org/en-US/docs/Web/CSS (page per item) | Property, selector and at-rule semantics | Fetched 2026-10-19 | CC BY-SA 2.5 (prose) |
| WF | web-features data package | https://github.com/web-platform-dx/web-features (data: https://unpkg.com/web-features/data.json) | Baseline status, low/high dates, per-browser versions | v3.43.0, fetched 2026-10-19 | Apache-2.0 |
| BL | web.dev Baseline; MDN Baseline compatibility glossary | https://web.dev/baseline, https://developer.mozilla.org/en-US/docs/Glossary/Baseline/Compatibility | Newly vs widely available definitions | Fetched 2026-10-19 | CC BY 4.0 / CC BY-SA 2.5 |
| BLBR | web.dev: Use Baseline with Browserslist | https://web.dev/articles/use-baseline-with-browserslist | Widely available = supported in the core browser set for 30+ months; Baseline year sets | Fetched 2026-10-19 | CC BY 4.0 |
| BRL | Browserslist README | https://github.com/browserslist/browserslist | `baseline widely available` / `baseline newly available` queries | Fetched 2026-10-19 | MIT |
| RP | web.dev: Rendering performance | https://web.dev/articles/rendering-performance | Pixel pipeline: style, layout, paint, composite | Fetched 2026-10-19 | CC BY 4.0 |
| LT | web.dev: Avoid large, complex layouts and layout thrashing | https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing | Forced synchronous layout, read/write batching | Fetched 2026-10-19 | CC BY 4.0 |
| PI | Paul Irish: What forces layout/reflow | https://gist.github.com/paulirish/5d52fb081b3570c81e3a | List of layout-forcing DOM reads (`offset*`, `getBoundingClientRect`, `getComputedStyle`, `innerText`, `focus()`) | Gist, fetched 2026-10-19 | No licence stated; link only |
| SC | web.dev: Reduce the scope and complexity of style calculations | https://web.dev/articles/reduce-the-scope-and-complexity-of-style-calculations | Style cost = selector matching × invalidated elements; INP link | Fetched 2026-10-19 | CC BY 4.0 |
| COMP | web.dev: Stick to compositor-only properties and manage layer count | https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count | `transform`/`opacity`, layer memory cost | Fetched 2026-10-19 | CC BY 4.0 |
| ANIM | web.dev: How to create high-performance CSS animations | https://web.dev/articles/animations-guide | Avoid animating properties that trigger layout or paint | Fetched 2026-10-19 | CC BY 4.0 |
| ATP | web.dev: @property | https://web.dev/articles/at-property | Registered custom properties interpolate; unregistered ones flip | Fetched 2026-10-19 | CC BY 4.0 |
| CV | web.dev: content-visibility | https://web.dev/articles/content-visibility | Skipping offscreen rendering; `contain-intrinsic-size` | Fetched 2026-10-19 | CC BY 4.0 |
| FONT | web.dev: Optimize web font loading; Lighthouse font-display audit; web.dev CSS size-adjust | https://web.dev/articles/optimize-webfont-loading, https://developer.chrome.com/docs/lighthouse/performance/font-display, https://web.dev/articles/css-size-adjust | `font-display`, preload, fallback metric overrides | Fetched 2026-10-19 | CC BY 4.0 |
| RB | Lighthouse: Eliminate render-blocking resources | https://developer.chrome.com/docs/lighthouse/performance/render-blocking-resources | Which `<link rel=stylesheet>` block first paint; `media`; critical CSS | Fetched 2026-10-19 | CC BY 4.0 |
| CW | Harry Roberts: CSS and Network Performance | https://csswizardry.com/2018/11/css-and-network-performance/ | `@import` serialises the critical path | 2018-11, fetched 2026-10-19 | Author copyright; link only |
| CWV | web.dev: INP, CLS | https://web.dev/articles/inp, https://web.dev/articles/cls | Interaction latency and layout shift metrics | Fetched 2026-10-19 | CC BY 4.0 |
| COV | Chrome DevTools: Coverage | https://developer.chrome.com/docs/devtools/coverage | Unused CSS bytes per page | Updated 2026-04-13 | CC BY 4.0 |
| WCAG | WCAG 2.2 Understanding docs, criterion named per item | https://www.w3.org/WAI/WCAG22/Understanding/ (page per item) | Focus visible, resize text, reflow, text spacing, motion | W3C Recommendation 2.2 | W3C document licence (link, do not copy) |
| AR | Adrian Roselli: Responsive Type and Zoom | https://adrianroselli.com/2019/12/responsive-type-and-zoom.html | `vw`-only font sizes defeat zoom | 2019-12, fetched 2026-10-19 | Author copyright; link only |
| DCSS | Defensive CSS (Ahmad Shadeed) | https://defensivecss.dev/ | Content and environment robustness catalogue | Fetched 2026-10-19 | Link only |
| EL | Every Layout: The Stack | https://every-layout.dev/layouts/stack/ | Owl-selector stack spacing | Fetched 2026-10-19 | Commercial; link only |
| TW | Tailwind CSS: Adding custom styles; Theme variables | https://tailwindcss.com/docs/adding-custom-styles, https://tailwindcss.com/docs/theme | Arbitrary values vs theme tokens | Fetched 2026-10-19 | Tailwind Labs copyright; link only |
| SL | stylelint rule reference; stylelint-config-recommended | https://stylelint.io/user-guide/rules, https://github.com/stylelint/stylelint-config-recommended | Rule names, recommended set | stylelint 17.16.0, config-recommended 18.0.0 | MIT |
| SLB | stylelint-plugin-use-baseline | https://github.com/ryo-manba/stylelint-plugin-use-baseline | Flags properties, values, at-rules, media conditions not widely available | v1.4.8 | MIT |
| SLNU | stylelint-no-unsupported-browser-features | https://github.com/RJWadley/stylelint-no-unsupported-browser-features | doiuse against browserslist | Fetched 2026-10-19 | MIT |

## 2. Mindset

- The cascade decides, not source position alone: origin and importance,
  then layer order, then specificity, then order. Win a conflict by
  structure (`@layer`, `:where()`, scoping), not by escalation (`css-cascade`).
- Every declaration has a cost in a pipeline stage: style, layout, paint or
  composite (RP). Name the stage before calling something slow.
- Content and environment vary: text length, image ratio, item count,
  viewport, user font size and zoom. CSS that only works with the mock data
  is a defect (`defensive-css`, DCSS).
- The user's settings win: font size, zoom, reduced motion, forced colours.
  Units and media queries must respect them (`css-units`, WCAG 1.4.4).
- Prefer the platform feature that is Baseline for the project's matrix
  over JS or a preprocessor trick (`css-modern`), and gate anything newer.

## 3. Habits carried from other approaches

| Habit | Do instead | Source |
|---|---|---|
| `px` for every size, including root `font-size` | `rem` for type and spacing that should follow the user's font size; `px` for hairlines | `css-units`, WCAG 1.4.4 (resize-text) |
| Fluid type as `font-size: 2vw` or `clamp(a, Nvw, b)` with no `rem` term | Add a `rem`/`em` component to the preferred value | AR, WCAG 1.4.4 |
| `!important` or chained selectors to win a fight | `@layer` order, `:where()` for zero-specificity defaults | MDN Specificity, MDN `@layer`, MDN `:where` |
| Viewport `@media` to lay out a component | `@container` on a sized ancestor | `css-modern`, `defensive-css` |
| JS for what CSS now does: parent class toggles, scroll listeners for progress, focus-trap divs for modals | `:has()`, scroll-driven animation where the matrix allows, `<dialog>` + `showModal()` | `css-modern`, MDN `:has`, MDN scroll-driven animations |
| Animating `top`/`left`/`width` from JS per frame | `transform`/`opacity` | ANIM, COMP |
| `translateZ(0)` / `will-change` sprinkled as a speed-up | Animate a compositable property; set `will-change` only on the element about to animate | MDN `will-change` ("last resort"), COMP (layer memory) |
| Margins on every child for sibling spacing | Parent `gap` or a stack rule | `css-flow`, EL |
| `margin-left`/`padding-right` by default | Logical properties | `css-modern` |

`translateZ(0)` appears in COMP only as a fallback for browsers without
`will-change`; `will-change` has been Baseline widely available since 2022
(WF), so the fallback has no target left.

## 4. Review items

Format: `id` — trigger visible in a diff — what to check — why — source.
A finding names the concrete failure (what breaks, for whom, when). Taste
(colour choice, class-name style with no stated convention, formatting) is
not a finding.

### 4.1 Cascade and selectors

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| css-important | New `!important` outside a utility layer or a third-party override | Replace with layer order or lower specificity; a kept one names the rule it beats | The next override must escalate again | MDN Specificity, SL `declaration-no-important` |
| css-specificity-escalation | `#id` selectors, repeated classes, deeper chains added only to out-rank another rule | Fix the order or layer instead | Specificity only grows; overrides get harder each edit | MDN Specificity, SL `selector-max-specificity`, `selector-max-id` |
| css-reset-specificity | Reset or library defaults with class/element specificity | Wrap in `:where()` or an earlier `@layer` | Consumers cannot override with one class | MDN `:where`, MDN `@layer` |
| css-layer-order | `@layer` rules with no leading `@layer a, b, c;` statement, or layers declared after use | Declare order first | Order of first appearance decides precedence | MDN `@layer`, `css-modern` |
| css-shorthand-reset | Shorthand (`font`, `background`, `inset`, `margin`) after a longhand on the same element, same block or a later rule | Use the longhand, or move the shorthand first | The shorthand resets omitted sub-properties to initial values | MDN Shorthand_properties, SL `declaration-block-no-shorthand-property-overrides`, `css-cascade` |
| css-selector-list-invalid | New selector in a comma list that some target browser does not parse (`:user-invalid`, `:has()`) | Wrap in `:is()`/`:where()` or split the rule / gate with `@supports selector()` | One invalid selector drops the whole rule | MDN Selector_list, MDN `:has` (not forgiving), MDN `@supports` |
| css-duplicate | Same selector twice in a file, or the same property twice in a block | Merge or delete the earlier one | The earlier declaration is dead and misleads the next editor | SL `no-duplicate-selectors`, `declaration-block-no-duplicate-properties` |
| css-descending-specificity | Lower-specificity selector after a higher one targeting the same element | Reorder | The later rule looks like it wins but does not | SL `no-descending-specificity` |
| css-link-state-order | `:hover`/`:active` styled with no matching `:focus-visible` | Add `:focus-visible` in the same chain (order per `css-cascade`) | Keyboard users get no state change | `css-cascade`, WCAG 2.4.7 |

### 4.2 Units and typography

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| css-root-px | `font-size` in `px` on `html`/`:root`/`body` | `%`/`rem` or leave unset | Overrides the user's default font size | `css-units`, WCAG 1.4.4 |
| css-fluid-no-rem | `font-size` preferred term only in `vw`/`vh`/`cq*` | Add a `rem` term (`calc(1rem + 1vw)`) | Viewport terms do not grow with zoom; text stays small at 200% | AR, WCAG 1.4.4 |
| css-line-height-unit | `line-height` with `px`/`em`/`%` on a container whose children change font size | Unitless number | The computed length is inherited, so larger child text overlaps | MDN line-height, `css-units` |
| css-em-compound | `font-size` in `em` on a component that nests itself | `rem` | Size compounds per level | `css-units` |
| css-100vh | `100vh` for full-height mobile layouts | `dvh`/`svh`/`lvh` by intent | `vh` ignores the dynamic browser toolbar | `css-units`, `css-modern` |
| css-generic-family | `font-family` list with no generic fallback | End with a generic family | Missing font falls back to the UA default with different metrics | SL `font-family-no-missing-generic-family-keyword` |
| css-text-spacing | Fixed `height` or `overflow: hidden` on text containers | `min-height` or no fixed height | User text-spacing overrides (line-height 1.5, letter 0.12em) must not clip text | WCAG 1.4.12 (text-spacing) |

### 4.3 Flow and spacing

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| css-margin-sibling | `margin-top` on every item plus a `:first-child` reset, or both block margins carrying inter-item spacing | Parent `gap` or a stack rule (`> * + *`) | Gaps depend on collapse context and change when items move | `css-flow`, EL |
| css-flex-refactor | Diff adds `display: flex`/`grid` to a parent whose children keep block margins sized for collapse | Remove child margins, use `gap` | Margins stop collapsing in flex/grid; gaps roughly double | `css-flow`, MDN Mastering_margin_collapsing |
| css-spacing-owner | Component declares outer `margin` where the project says layouts own spacing | Move spacing to the parent (`gap`, stack) | Component spacing changes with each parent | Project `AGENTS.md`, `css-flow`, EL |

### 4.4 Defensive CSS

Apply the intent table in `defensive-css` (DCSS for background). One row
each; the skill holds the mechanism and the stress fixtures.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| css-flex-wrap | Flex container with variable item count and no `flex-wrap` | `flex-wrap: wrap` or an explicit overflow strategy | Items overflow when the container narrows | `defensive-css`, MDN flex-wrap |
| css-flex-min-width | Flex child with long text and no `min-width: 0` | Add it (or `min-inline-size: 0`) | `min-width: auto` keeps the item at its content width | `defensive-css`, MDN min-width |
| css-long-text | Fixed-width text box with neither `overflow-wrap` nor truncation | `overflow-wrap: anywhere`, or ellipsis with `overflow`/`white-space` | Long tokens (URLs, IDs) overflow | `defensive-css`, MDN overflow-wrap |
| css-object-fit | Sized `<img>`/`<video>` with no `object-fit` | `object-fit: cover`/`contain` | Unexpected ratios distort | `defensive-css`, MDN object-fit |
| css-bg-repeat | `background-image` with no `background-repeat` | Set it | Small or failed images tile | `defensive-css`, MDN background-repeat |
| css-var-fallback | `var(--x)` where `--x` is not guaranteed at that point | `var(--x, fallback)`; `no-unknown-custom-properties` for typos | An unset property makes the declaration invalid at computed-value time | MDN var, SL `no-unknown-custom-properties` |
| css-auto-fit | `repeat(auto-fit, …)` on a grid of unknown count | `auto-fill` unless stretching a short row is intended | Lone items stretch | `defensive-css` |
| css-scrollbar-gutter | Container that toggles between scrolling and not | `scrollbar-gutter: stable` (Baseline newly, 2024-12) | Layout shifts when the scrollbar appears | `defensive-css`, MDN scrollbar-gutter, WF |
| css-reflow | Fixed widths, `min-width` on page wrappers, or horizontal layouts with no small-viewport path | Must reflow at 320 CSS px width without two-dimensional scroll | Zoomed and small-screen users lose content | WCAG 1.4.10 (reflow) |

### 4.5 Modern CSS and browser support

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| css-legacy-idiom | A row of the `css-modern` replacement table where its "still right" column does not apply | Cite the row; suggest the native form if the matrix allows (section 5) | Native features remove JS and specificity work | `css-modern` |
| css-unsupported | Property, value, selector or at-rule not supported by the browserslist targets, with no `@supports`/fallback | Add a fallback, gate with `@supports`, or drop | Silent no-op or dropped rule on a supported browser | WF, BRL, MDN `@supports`, SLB, SLNU |
| css-container-type | `@container` query with no ancestor `container-type`, or `container-type: size` where `inline-size` was meant | Fix the container | The query never matches, or block size collapses | MDN Container_queries, `css-modern` |
| css-reduced-motion | New non-trivial animation or transition (movement, parallax, view transition) with no `prefers-reduced-motion` handling | Disable or reduce under `reduce` | Vestibular disorders; motion triggered by interaction | MDN prefers-reduced-motion, WCAG 2.3.3 (AAA) |
| css-outline-none | `outline: none`/`0` on focusable elements with no visible replacement | Keep the outline or style `:focus-visible` | Keyboard focus becomes invisible | WCAG 2.4.7, WCAG F78 https://www.w3.org/WAI/WCAG22/Techniques/failures/F78 |
| css-focus-obscured | New `position: sticky`/`fixed` header or footer over scrolling content | `scroll-padding` so focused elements stay visible | Focused element hidden under author content | WCAG 2.4.11, MDN scroll-padding |

### 4.6 Rendering performance

Report a cost only with three things: the pipeline stage (style, layout,
paint, composite), the trigger and frequency (per frame, per scroll, per
hover, per toggle, once at load), and the scope in elements. A cost that
happens once on a rarely used page is not a finding. Without a trace, label
the finding "needs measurement" and name what would confirm it (DevTools
Performance panel with CPU throttling; Lighthouse; Coverage). Whether an
element is composited is an engine decision: never state it as fact from
source alone.

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| css-perf-forced-layout | Layout read (`offsetWidth`, `getBoundingClientRect()`, `getComputedStyle()`, `scrollTop`, `innerText`) after a style write in the same task, especially in a loop | Read all first, then write; or write in `requestAnimationFrame` | Each read forces a synchronous style and layout flush; n reads in a loop cost n layouts | LT, PI |
| css-perf-poll-geometry | `getBoundingClientRect()` polled in `scroll`/`resize` handlers | `IntersectionObserver` / `ResizeObserver` | Observers deliver geometry without forcing layout on each event | MDN IntersectionObserver, MDN ResizeObserver |
| css-perf-animate-layout | `transition`/`@keyframes`/JS animation on `top`, `left`, `width`, `height`, `margin`, `padding`, `font-size` | `transform`/`opacity` | Layout and paint every frame on the main thread | ANIM, COMP, RP |
| css-perf-animate-paint | Animated `box-shadow`, `filter`, `background-position`, large `border-radius` areas | Animate `opacity`/`transform` of a pseudo-element carrying the effect | Repaints the area every frame | ANIM |
| css-perf-will-change | New `will-change`, broad or permanent; `translateZ(0)` hacks | Remove, or set just before the animation and clear after | Each layer is GPU memory; overuse slows the page | MDN will-change, COMP |
| css-perf-animate-auto | Animating `height: auto` | `grid-template-rows: 0fr → 1fr`, `transform`, or `interpolate-size` only where the matrix allows (not Baseline, section 5) | Layout every frame; `interpolate-size` is Chromium-only | MDN interpolate-size, WF |
| css-perf-unregistered-var | Transition/animation on a custom property without `@property` | Register it with a `syntax` (Baseline newly, 2024-07), or animate the concrete property | Unregistered properties flip instead of interpolating | ATP, MDN @property, WF |
| css-perf-root-var | Custom property on `:root` changed per frame, per scroll or per hover | Set it on the smallest subtree that reads it | Custom properties inherit, so every descendant is invalidated | MDN Using_CSS_custom_properties, SC |
| css-perf-style-scope | Broad rule with `:has()` or a complex selector whose subject matches many elements that mutate often (`.row:has(:checked)` over thousands of rows) | Narrow the subject or the mutation; state element count and frequency | Style cost scales with invalidated elements and matching work | SC, MDN `:has` |
| css-perf-content-visibility | Long page or list rendering all offscreen sections | `content-visibility: auto` plus `contain-intrinsic-size` (Baseline newly, 2025-09) | Skips offscreen rendering; without a size estimate the scrollbar jumps (CLS) | CV, MDN content-visibility, WF |
| css-perf-contain | Frequently mutating widget (log, chat, ticker) with no containment | `contain: layout paint` or `content` | Limits how far layout and paint spread | MDN contain |
| css-perf-font-display | `@font-face` with no `font-display` | `swap` or `optional` by intent | Text stays invisible while the font loads | FONT, MDN font-display |
| css-perf-font-metrics | Webfont swap that visibly shifts text | Fallback `@font-face` with `size-adjust`/`ascent-override` (not Baseline: no Safari, section 5) | The swap is a layout shift | FONT (css-size-adjust), CWV CLS, WF |
| css-perf-font-preload | Above-the-fold font discovered only through CSS | `<link rel="preload" as="font" crossorigin>` for one or two faces | Font fetch waits for CSS parsing | FONT |
| css-perf-font-subset | New faces or weights not referenced, or full character set where a subset fits | Remove unused faces; `unicode-range`; a variable font | Fewer bytes before text renders | MDN unicode-range |
| css-perf-render-blocking | Growth of a render-blocking stylesheet; print or wide-only sheet with no `media` | Split by `media`; inline critical CSS | Every blocking stylesheet delays first paint | RB |
| css-perf-import | `@import` in a delivered stylesheet | Bundle it or use a separate `<link>` | The imported sheet is discovered only after the parent is parsed | CW, SL `no-invalid-position-at-import-rule` (placement only) |
| css-perf-unused | Large unused share of a stylesheet on a route | Name the Coverage numbers; split per route | Unused CSS is still downloaded and parsed | COV |

### 4.7 Tokens and project conventions (only when the project declares them)

| id | Trigger | Check | Why | Source |
|---|---|---|---|---|
| css-raw-value | Hard-coded colour/spacing/size where the project has a token for it; Tailwind arbitrary value (`w-[13px]`, `text-[#3b82f6]`) where a theme value exists | Use the token or theme value | Values drift from the design system on the next token change | TW, project `AGENTS.md` |
| css-scale-violation | New `@media`/`@container` breakpoints or spacing steps off the project's scale | Use the scale | One-off values multiply | TW (theme variables), project `AGENTS.md` |

## 5. Version-gated modern features

Gate on the project's browserslist, never on the latest browser. Baseline
newly available means supported by the current core browser set; widely
available means 30 months after that (BL, BLBR). To check:

1. `npx browserslist` resolves the targets (a project may already use
   `baseline widely available` or a Baseline year as its query — BRL).
2. Look up the feature in the current web-features data (WF; the
   `status.baseline` field is `high`, `low` or `false`, with dates and
   per-browser versions) or on its MDN page's Baseline banner.
3. A feature newer than the targets needs `@supports` or a fallback that
   keeps content readable. Run SLB or SLNU if the project has them.

Status from web-features v3.43.0 (fetched 2026-10-19):

| Feature | Status | Note for review |
|---|---|---|
| `:has()`, container size queries, nesting, `@layer`, `oklch()`/`oklab()`, `color-mix()`, subgrid, `<dialog>`, `dvh`/`svh`/`lvh`, logical properties, `:user-valid`/`:user-invalid`, `contain`, `:focus-visible`, `inert`, `aspect-ratio`, flex `gap`, `:is()`/`:where()`, `font-display`, `prefers-reduced-motion` | Widely available | Recommend without fallback on a Baseline-widely matrix |
| `text-wrap: balance` (2024-05), `scrollbar-gutter` (2024-12), `light-dark()` (2024-05), `@starting-style` and `transition-behavior` (2024-08), registered custom properties `@property` (2024-07), `backdrop-filter` (2024-09), popover (2025-01), `content-visibility` (2025-09), same-document view transitions (2025-10), `@scope` (2026-03), container style queries (2026-05), `field-sizing` (2026-06) | Newly available | Fine for evergreen targets; check older matrices |
| `text-wrap: pretty` | Not Baseline (Chromium 117, Safari 26; no Firefox entry) | Degrades to normal wrapping; enhancement only |
| Cross-document view transitions (`@view-transition`) | Not Baseline (Chromium 126, Safari 18.2) | Falls back to normal navigation |
| Scroll-driven animations (`animation-timeline`) | Not Baseline (Chromium 115, Safari 26) | Enhancement over a static layout only |
| `interpolate-size`, `calc-size()` | Not Baseline (Chromium 129 only) | Never the only path for a height animation |
| Font metric overrides (`ascent-override` etc.) | Not Baseline (no Safari entry) | Shift fix only where supported |
| Anchor positioning, customizable `<select>`, `dialog` `closedby` | Not Baseline | Check WF per sub-feature before use |

## 6. Rendering pipeline model

- A visual change passes through up to four stages: style (which rules
  match, computed values), layout (geometry), paint (pixels into layers),
  composite (layers onto the screen). Changing a property re-runs its own
  stage and every later one (RP).
- `transform` and `opacity` changes can skip layout and paint and be
  handled at composite; everything else costs at least paint (ANIM, COMP).
- Layout is normally deferred to the next frame. A script that reads
  geometry after writing styles forces style and layout to run immediately,
  inside that script (LT, PI).
- Style cost scales with the number of elements invalidated and the work to
  match their selectors; inherited custom properties widen invalidation to
  the whole subtree (SC, MDN custom properties).
- Each compositor layer holds GPU memory; promoting many elements trades
  memory for paint and can make things slower on low-memory devices (COMP).
- CSS blocks first paint by default; `@import` and late font discovery add
  sequential round trips before text appears (RB, CW, FONT).
- User-facing metrics: INP for interaction latency (style/layout/paint
  after input) and CLS for unexpected shifts (font swaps, images without
  size, missing `contain-intrinsic-size`) (CWV).

## 7. Linter and tool mapping

Run the project's own checks first (`lefthook.yml`, `.pre-commit-config.yaml`,
its stylelint config, CI results via `gh pr checks`) and pass their output to
the review; never report "no issues" from a tool that did not run. Running
the project's npm scripts, a dev server or Lighthouse executes code the diff
controls: name those commands instead of running them unless execution was
opted into. Do not restate what a tool already reported.

| Item | Tool / rule | In `stylelint-config-recommended` 18.0.0? |
|---|---|---|
| css-shorthand-reset | `declaration-block-no-shorthand-property-overrides` | Yes |
| css-duplicate | `no-duplicate-selectors`, `declaration-block-no-duplicate-properties` | Yes |
| css-descending-specificity | `no-descending-specificity` | Yes |
| css-generic-family | `font-family-no-missing-generic-family-keyword` | Yes |
| Unknown properties, values, pseudo-classes, at-rules | `property-no-unknown`, `declaration-property-value-no-unknown`, `selector-pseudo-class-no-unknown`, `at-rule-no-unknown` | Yes |
| css-perf-import (placement) | `no-invalid-position-at-import-rule` | Yes |
| css-important | `declaration-no-important` | No; enable explicitly |
| css-specificity-escalation | `selector-max-specificity`, `selector-max-id` | No |
| css-var-fallback (typos) | `no-unknown-custom-properties` | No |
| css-perf-animate-layout, css-raw-value | `property-disallowed-list`, `declaration-property-value-disallowed-list` configured by the project | No |
| css-unsupported | SLB (Baseline) or SLNU (browserslist via doiuse) | Plugins |
| Rendering items 4.6 | DevTools Performance (CPU throttled), Rendering tab paint flashing and layer borders, Coverage; Lighthouse | Need a running page |
| css-reflow, css-text-spacing, css-focus-obscured, contrast | axe / Lighthouse plus a person at 320 px and 200 % zoom (see `semantic-html` standard section 7) | Need a running page |

No tool decides: whether an override is a cascade fight, whether a value has
a token, whether an animation runs on a hot path, element counts and
frequencies, or whether a version gate applies. Those are the review's work.
