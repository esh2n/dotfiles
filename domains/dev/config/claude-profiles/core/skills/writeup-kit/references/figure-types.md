# Figure types

A figure is an IR block (`<script type="text/x-writeup-diagram">`) rendered
to an inline SVG and machine-verified before it may carry
`data-checks="pass"`. The IR's `type:` field picks the renderer. Two kinds
exist:

- the **builtin diagram** (`type:` absent or `diagram`) — nodes, groups,
  orthogonal edges laid out by elk; schema in `bin/lib/ir.mjs`, renderer in
  `bin/lib/diagram.mjs`, the 22 verify rows in `bin/lib/verify-diagram.mjs`;
- **plugins** — every other `type:` is one file, `bin/lib/figures/<type>.mjs`,
  discovered from the filesystem by `bin/lib/figures/index.mjs`.

The plugin split exists so that many figure types can be written *in
parallel* without two people ever editing the same file: a new type is a new
file plus its own fixtures and test file, and the registry, `validateIR()`,
`render-diagram.mjs`, `rerender-figures.mjs` and `self-check.mjs` pick it up
without a change. `sequence` is the reference implementation.

## 1. The plugin contract

A plugin exports **exactly** these eight names — no more (helper exports are
rejected at load; keep helpers unexported or in a sibling renderer module),
no fewer:

```js
export const type = 'sequence'              // the IR `type:` value; lowercase [a-z0-9-], unique
export const limits = { ... }               // advisory budgets → warnings, never a rejection
export function normalize(rawIr, ctx) {}     // schema validation → normalized IR; idempotent
export function budgetWarnings(ir) {}        // → [{ key, value, limit, detail, hint }] stable order
export async function layout(ir, opts) {}    // → { width, height, geo, legend? } deterministic
export function draw(geo, ir, opts) {}       // → inner SVG string (no <svg> root, no <title>/<desc>)
export function verify(geo, ir, opts) {}     // → [{ id, name, severity, ok, detail, hint }] type-specific rows
export const doc = { purpose, whenToUse, irExample /* YAML */, rows /* verify row names */ }
```

`bin/lib/figures/_template.mjs.txt` is an annotated copy of this contract
(a runnable `timeline` sketch); copy it to `<type>.mjs` to start.

### `type`

The string authors write as `type:` in the IR and the key the registry uses.
The file name is free (`sequence.mjs` by convention). Two files exporting
the same `type` make the registry throw at import, so the whole kit fails
loudly rather than one of them silently winning. `diagram` is reserved for
the builtin.

### `limits`

A plain object of `max<Thing>` numbers. They are *guidance*: an over-budget
IR still validates and renders; `budgetWarnings()` turns overruns into
warnings that reach `data-warn`. `render-diagram.mjs --list-types` prints
them as-is.

### `normalize(rawIr, ctx)`

Full schema validation of the raw (yaml-lite/JSON) object, returning the
normalized IR the rest of the pipeline reads. Rules:

- throw `IrError` (from `_shared.mjs`) with `${ctx}`-prefixed paths —
  `ir.participants[2].label is required and must be a non-empty string`;
  `validateIR()` turns it into `{ ok:false, reason:'schema', message }`;
- use the shared helpers (`normalizeHeader` for `id`/`title`/`caption`,
  `requireStr`, `optStr`, `validateTone`, `validateBool`, `isObj`, `KINDS`,
  `TONES`) so every type rejects the same mistakes with the same wording;
- return an object whose `type` equals the plugin's `type` (checked);
- be **idempotent**: `normalize(normalize(raw))` deep-equals
  `normalize(raw)`. Every figure embeds its IR, and `rerender-figures.mjs`
  re-validates that embedded text — a normalized shape that its own
  normalize() rejects would strand the page. The sequence plugin accepts
  its `rowType`-tagged rows back for exactly this reason.

### `budgetWarnings(ir)`

Overruns as `{ key:'budget:<thing>', value, limit, detail, hint }` records
(`budgetWarning()` in `_shared.mjs` builds one) in a **stable order** — the
`data-warn` attribute is `formatBudgetWarnings()` of this list
(`budget:participants=7;budget:messages=20`) and must be byte-stable.
`hint` is the concrete fix ("split after message 16"), not a restatement.

### `layout(ir, opts)`

Async (elk-style engines are async; a fixed grid just returns), returning
`{ width, height, geo, legend? }`:

- `width`/`height` — the native canvas in px, multiples of 4. The dispatcher
  alone decides how the figure is shown: scaled to the 720px `COLUMN` while
  the scale stays ≥ `MIN_SCALE` (0.78), otherwise native size with a
  sideways scroll (`data-scroll="true"`). A plugin never scales itself.
- `geo` — the type-specific geometry `draw()` and `verify()` read
  (participants/lifelines/rows for a sequence). Every position-like number
  in it (`x y x1 y1 x2 y2 cx cy yTop yBottom centerX centerY`) must sit on
  the 4px grid — snap with `snap4()`/`snapUp4()` from `diagram.mjs`. Sizes
  are the plugin's rule (a text-fitted box may be unsnapped).
- `legend` (optional) — `{ y, items: [{ label, dash?, marker? }] }`; the
  wrapper draws it with the diagram's legend metrics. Reserve
  `LEGEND_HEIGHT` (20px) in `height` and define any `marker` id
  (`wu-d-<id>-<marker>`) in the plugin's own `<defs>`.
- **deterministic**: same IR → same geometry. No randomness, no clock, no
  environment reads. Verification, snapshot tests and `rerender-figures`
  all depend on it.

`opts` carries `{ column }`.

### `draw(geo, ir, opts)`

Returns the *inner* SVG as a string: defs, shapes, text. The shared wrapper
(`wrapFigureSvg()` in `_shared.mjs`) supplies the root —
`<svg role="img" aria-labelledby="wu-d-<id>-title wu-d-<id>-desc" width height viewBox xmlns>`,
then `<title>` and `<desc>` (caption, falling back to the title), then the
inner string, then the optional legend. What the shared rows will check in
the result: every `id` prefixed `wu-d-<ir.id>-`; `font-size` 13 or 11 only;
`stroke-width` 1 or 1.5; `rx` 4/6/8; no hex or `rgb()` colors — use
`currentColor` and `var(--wu-*)` tokens (`rect[data-tone]` fills come from
the kit CSS); every label through `esc()`. `opts` carries
`{ column, scaled, scroll, displayWidth, displayHeight }`.

### `verify(geo, ir, opts)`

The rows only this type can judge — reference integrity, geometry rules
(clearances, ordering, arrow shape), and the budget rows. Each row is
`{ id, name, severity:'fail'|'warn', ok, detail, hint }`; a failing `warn`
row also carries `key`/`value` from the matching `budgetWarnings()` record,
which is how it reaches `data-warn`. Number rows `1..n`; the dispatcher
appends the shared rows after the highest id. `fail` rows gate rendering
(`data-checks="pass"` is withheld, the CLI exits 3); `warn` rows never do.
A rule that lives only in prose ships broken figures — encode it here.
`opts` carries `{ column, svg, rendered }`.

### `doc`

`purpose` (one line), `whenToUse` (when this type beats its neighbours, and
the budgets in words), `irExample` (a YAML string that validates and renders
clean — the registry test renders every type's example through the CLI),
`rows` (the names `verify()` returns). Printed by `--list-types` / `--doc`.

## 2. What the dispatcher does

`bin/lib/figures/index.mjs`:

1. `readdirSync` its folder, import every `*.mjs` except `index.mjs` and
   `_`-prefixed files, check the contract (`assertPluginContract`), key by
   `type`, throw on duplicates. `getFigureType(name)`, `listFigureTypes()`
   (builtins first, plugins alphabetically), `hasFigureType`, `isPluginType`.
   `loadFigureTypes(dir)` is the same discovery pointed at any folder (tests
   use scratch folders).
2. `registerBuiltin({ type:'diagram', limits, doc })` — called by `ir.mjs`
   so `getFigureType('diagram')` returns a read-only descriptor for listing
   and docs. It has no `layout/draw/verify`; the diagram keeps its own path.
3. `renderFigure(plugin, ir, { column })` — `layout()` → `fitToColumn()` →
   `draw()` → `wrapFigureSvg()`; returns the `renderDiagram()` shape
   (`svg width height scaled scroll layout`) so `wrapFigureHtml()` and the
   verifiers treat every kind as a drop-in.
4. `verifyFigure(plugin, ir, rendered, { column })` — the plugin's rows,
   then the shared rows, summarized as `{ ok, checks, failures, warnings }`.

Routing points that already know about the registry, so a plugin never
touches them:

| Shared file | What it does with a plugin type |
|---|---|
| `bin/lib/ir.mjs` `validateIR()` | `type:` absent/`diagram` → builtin schema; anything else → `getFigureType(type).normalize(raw, 'ir')`, warnings from its `budgetWarnings()`; unknown → `ir.type must be diagram\|sequence\|… (got: …)` |
| `bin/lib/verify-diagram.mjs` `renderCheckedBest()` / `renderFigureHtmlChecked()` | plugin types go through `renderFigure` + `verifyFigure` (one candidate — no orientation or layer-mode search) and get the same output contract: `data-checks="pass"` when no `fail` row fails, `data-warn="…"` from the budget rows, plus `data-type="<type>"`; `checksOk`, `failures`, `warnings`, `warn`, `layoutMode = type`, the IR script embedded |
| `bin/render-diagram.mjs` | `--figure`/`--json`/exit codes unchanged; `--list-types`, `--doc <type>` |
| `bin/rerender-figures.mjs`, `bin/self-check.mjs`, `bin/lib/migrate/*` | call `validateIR()` + `renderFigureHtmlChecked()`; nothing type-specific |

Import-graph rule (the one thing that can break the registry): `index.mjs`
loads plugins with a top-level `await import()`, and `ir.mjs` imports
`index.mjs`. A plugin — or anything it imports — must therefore **never**
import `ir.mjs`, `verify-diagram.mjs` or `figures/index.mjs`; the load would
deadlock. Import `./_shared.mjs` (schema helpers, wrapper, shared checks)
and renderer modules (`../diagram.mjs` constants, your own `../<type>.mjs`)
only.

## 3. Shared verify rows

Appended by `verifyFigure()` after the plugin's rows, in this order, all
severity `fail`, ids continuing from the plugin's highest. The same
functions (`bin/lib/figures/_shared.mjs`) back the equivalent rows of
`verify-diagram.mjs` and `verify-sequence.mjs`, so the three never drift.

| Row | Reads | Passes when |
|---|---|---|
| `single-finite-svg` | svg text | exactly one `<svg>` root; no `NaN`/`Infinity`/`undefined` in the markup |
| `a11y` | svg text | `role="img"` on the root, `<title>` first child, non-empty `<desc>`, every `id` prefixed `wu-d-<ir.id>-` |
| `font-size` | svg text | every `font-size` is 13 or 11 |
| `stroke-radius` | svg text | every `stroke-width` ∈ {1, 1.5}, every `rx` ∈ {4, 6, 8} |
| `dark-3-state` | svg text | no hex color or `rgb()` — only `currentColor` / `var(--wu-*)`, so light/dark/system themes stay in sync |
| `grid-4px` | `geo` | every position-like number (`x y x1 y1 x2 y2 cx cy yTop yBottom centerX centerY`, recursively) is a multiple of 4 |
| `projected-scale` | `width`, `scroll` | `column / width ≥ MIN_SCALE` (0.78), or the scroll fallback is in effect |

What a plugin must still verify itself: references resolving, its own
geometry rules (clearances, ordering, no diagonals), sizes on the grid where
that matters, and its budgets as `warn` rows.

## 4. Fixtures and tests

- `test/fixtures/<type>-*.yaml` — IR fixtures for the type (`sequence-simple.yaml`,
  `sequence-over-messages.yaml`, …). Include at least one clean fixture and
  one per budget overrun.
- `test/fixtures/snapshots/<type>-*.html` — optional byte-exact snapshots of
  `renderFigureHtmlChecked().html` for regression pinning (the sequence
  snapshots were taken from the pre-registry code, which is how the move
  was proven byte-identical).
- `test/figures/<type>.test.mjs` — one test file per type: schema (valid,
  invalid, idempotent), budgets (each key, stable order), layout facts,
  every `verify()` row failing on a hand-mutated render, the registry path
  (`renderFigureHtmlChecked` → `data-checks="pass" data-type="<type>"`,
  `data-warn`), and the CLI (`--figure`, `--json`).
- `test/figures/registry.test.mjs` — discovery, contract, duplicates,
  routing, `--list-types`/`--doc`; it also renders every registered type's
  `doc.irExample` and expects a passing figure, so a new type is exercised
  end to end the moment its file exists.
- Run with bare `node --test` from the kit root (zero dependencies).

## 5. The rule: a plugin never edits shared files

Adding a type touches only:

```
bin/lib/figures/<type>.mjs          the plugin (may import a sibling bin/lib/<type>.mjs renderer)
test/fixtures/<type>-*.yaml         fixtures
test/figures/<type>.test.mjs        tests
references/figure-types.md          flip the type's status row (§7) — the one shared edit, one line
```

Everything else is shared and owned elsewhere: `ir.mjs`, `diagram.mjs`,
`verify-diagram.mjs`, `figures/index.mjs`, `figures/_shared.mjs`,
`render-diagram.mjs`, `rerender-figures.mjs`, `self-check.mjs`, `kit/*`,
`references/components.md`, `references/kinds.md`, `references/writing.md`.
If a type seems to need a change there (a new tone, a new shared row, a
kit CSS rule), that is a separate change with its own owner — file it, do
not fold it into the plugin.

Ship checklist for a type: file exports exactly the eight names · `normalize`
idempotent · `budgetWarnings` stable order · `layout` deterministic and
on-grid · `draw` has no `<svg>` root and passes every shared row · every
`verify` row has a failing test · `doc.irExample` renders clean via
`--doc <type> | render-diagram.mjs --figure` · status row updated.

## 6. CLI

```
node bin/render-diagram.mjs --list-types      # name, builtin|plugin, purpose, when, budgets, rows
node bin/render-diagram.mjs --doc sequence    # the type's irExample (YAML) on stdout
node bin/render-diagram.mjs --doc sequence > ir.yaml && node bin/render-diagram.mjs ir.yaml --figure
```

## 7. Type table

The 39 patterns of the diagram-design survey
(`~/.local/share/writeup/learn/_design/2026-08-29-research-diagram-patterns.md`,
§1–§2) with the planned plugin name and structural class. Structural
classes: **G** graph/flow · **S** sequence/time · **H** hierarchy/tree ·
**M** matrix/comparison · **L** layers/containment · **ST** state machine ·
**Q** quantity/chart · **D** before-after/diff. Status is `builtin`,
`implemented`, `covered by diagram`, or `planned`. Keep this column current when a plugin lands.

| # | Pattern | Plugin `type` | Class | Status |
|---|---|---|---|---|
| – | Node/edge diagram (kit default) | `diagram` | G | builtin (`ir.mjs` + `diagram.mjs`, not a plugin) |
| 1 | Architecture | `architecture` | G | covered by `diagram` (node/edge renderer: groups + tones + `wu-focal`) |
| 2 | IT current-state | `it-state` | G+L | planned |
| 3 | Flowchart | `flowchart` | G | covered by `diagram` (node/edge renderer: decision nodes as labelled branches) |
| 4 | Sequence | `sequence` | S | implemented (`bin/lib/figures/sequence.mjs`) |
| 5 | State machine | `state` | ST | implemented (`bin/lib/figures/state.mjs`) |
| 6 | ER / data model | `er` | G(H) | implemented as `schema` with `variant: er` |
| 7 | Timeline | `timeline` | S | implemented (`bin/lib/figures/timeline.mjs`) |
| 8 | Swimlane | `swimlane` | G+L | implemented (`bin/lib/figures/swimlane.mjs`) |
| 9 | Quadrant | `quadrant` | M | implemented (`bin/lib/figures/quadrant.mjs`) |
| 10 | Radar / Spider | `radar` | M/Q | implemented (`bin/lib/figures/radar.mjs`) |
| 11 | Polar chart | `polar` | Q | implemented (`bin/lib/figures/polar.mjs`) |
| 12 | Loop / flywheel | `loop` | G(cyclic) | implemented (`bin/lib/figures/loop.mjs`) |
| 13 | Nested | `nested` | L | implemented (`bin/lib/figures/nested.mjs`) |
| 14 | Tree | `tree` | H | implemented (`bin/lib/figures/tree.mjs`) |
| 15 | Org chart | `org-chart` | H | implemented as `tree` with `variant: org` |
| 16 | Layer stack | `layers` | L | implemented (`bin/lib/figures/layers.mjs`) |
| 17 | Venn | `venn` | M | implemented (`bin/lib/figures/venn.mjs`) |
| 18 | Pyramid / funnel | `pyramid` | H/Q | implemented (`bin/lib/figures/pyramid.mjs`) |
| 19 | Bar chart (incl. dumbbell) | `bar` | Q / D | implemented (`bin/lib/figures/bar.mjs`) |
| 20 | Treemap | `treemap` | Q | implemented (`bin/lib/figures/treemap.mjs`) |
| 21 | Line chart (incl. slopegraph, ridgeline) | `line` | Q / D | implemented (`bin/lib/figures/line.mjs`) |
| 22 | Gantt | `gantt` | S | implemented (`bin/lib/figures/gantt.mjs`) |
| 23 | Scatter / bubble | `scatter` | Q | implemented (`bin/lib/figures/scatter.mjs`) |
| 24 | High-Level | `high-level` | G+L | planned |
| 25 | Process | `process` | G+L(grid) | implemented (`bin/lib/figures/process.mjs`) |
| 26 | Medallion | `medallion` | L | implemented (`bin/lib/figures/medallion.mjs`) |
| 27 | Data flow | `data-flow` | G+L(grid) | covered by `diagram` (node/edge renderer: `layer:` group hints, stage order left → right) |
| 28 | DP integration | `dp-integration` | G+L | planned |
| 29 | DP security matrix | `matrix` (generic rows × columns; the DP security matrix is a preset) | M | implemented (`bin/lib/figures/matrix.mjs`) |
| 30 | Sankey | `sankey` | Q(flow) | implemented (`bin/lib/figures/sankey.mjs`) |
| 31 | Fishbone | `fishbone` | H(cause) | implemented (`bin/lib/figures/fishbone.mjs`) |
| 32 | Wardley map | `wardley` | M(2-axis ordinal) | implemented as `freeform` with `preset: wardley` (authored coordinates, verified) |
| 33 | Kanban | `kanban` | M(state census) | implemented as `board` with `variant: kanban` |
| 34 | User journey | `journey` | S+M | implemented (`bin/lib/figures/journey.mjs`) |
| 35 | Deployment | `deployment` | L+G | planned |
| 36 | Dependency graph | `dependency` | G(DAG) | covered by `diagram` (node/edge renderer: DAG; accent the one edge that breaks a cycle) |
| 37 | UML class | `uml-class` | G(H) | implemented as `schema` with `variant: class` |
| 38 | Story map | `story-map` | M(grid) | implemented as `board` with `variant: story-map` |
| 39 | Database schema | `db-schema` | G(H) | implemented as `schema` with `variant: db` |
