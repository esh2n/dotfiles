# Procedure (full detail)

This expands `SKILL.md`'s 8 steps with the exact CLI output to expect,
the `.writeup.toml` template, and how the `<meta name="checks">` value
is composed. All commands below assume `$KIT` was resolved per
`SKILL.md`'s shell snippet and `$STORE` was chosen per "Which store".

## Step 0 — which store

Two independent stores are the normal setup: `work` for pages written
for the day job and `private` for personal study / personal projects.
Each is its own git repository with its own `.writeup.toml`,
`manifest.json`, `index.html` and `_kit/`, so a work page never shows up
in the personal index (or its publish pre-stage) and vice versa. The
registry — `~/.local/share/writeup/stores.toml`, or `$WRITEUP_STORES` —
holds only the default and, per store, a name, a path and a one-line
description. It never maps directories to stores:

```toml
default = "private"

[[store]]
name = "work"
path = "work"          # relative to the registry's dir, absolute, or ~/...
description = "仕事"

[[store]]
name = "private"
path = "private"
description = "個人"
```

### `serve.mjs --list-stores` — observed behavior

```
$ node $KIT/bin/serve.mjs --list-stores
* work	/Users/me/.local/share/writeup/work	仕事
  private	/Users/me/.local/share/writeup/private	個人	default
```

One line per store: `<mark> <name>\t<path>\t<description>\t<flags>`
(trailing empty columns trimmed). `*` marks the store the current
directory resolves to — here a repository marker chose `work`; without
one the `default` line carries the `*`. Without a registry the output is
a single `* legacy	<path>	(no registry: ...)` line — the un-split old
store, which keeps working unchanged. When that path has no `.writeup.toml`
either, nothing has been set up on this machine at all and the line ends
with `— no store yet: run ...`:

```
$ node $KIT/bin/serve.mjs --list-stores
* legacy	/Users/me/.local/share/writeup	(no registry: ...) — no store yet: run `node <writeup skill>/scripts/init-store.mjs --name <name> --description <text> [--default]`
```

That is the newcomer's state. Do **not** start writing against it: go to
"Creating and registering stores" below, make `work` and `private`, and
only then continue with Step 1. Writing first leaves the page in a
directory that is not a git repository and has no `.writeup.toml`, which
breaks the commit in Step 7 and gives lint no config to read.

The kit's resolution order (`bin/lib/store.mjs` `resolveStoreDir`), the
same for every CLI that takes `--store`:

1. `--store <dir>`
2. `--store-name <name>` (serve, publish) — unknown name is an error
3. `$WRITEUP_STORE`
4. an existing `.writeup.toml` at or above the current directory — a
   page's own store (for `publish`, above the page itself)
5. the repository marker: `<repo root>/.writeup` of the nearest git
   repository containing the current directory (see below); a marker
   naming a store this registry lacks is an error, never a silent
   fall-through
6. the registry `default`
7. the legacy single store `~/.local/share/writeup`

### Deciding, declaring, and the repository marker

The skill's own rule sits on top of 4-7: the agent decides the store
from the request wording (仕事/会社/業務 vs 個人/勉強), the repository it
is working in, and the recent conversation, and declares the choice in
one line before saving (「work に保存します」). Only when genuinely
unsure does it ask, once. The `*` line is a hint, not the decision.

After the first save inside a repository, offer to write the marker so
later saves there skip the question:

```
$ node $SELF/scripts/init-store.mjs --marker work
init-store: wrote /path/to/repo/.writeup (store = "work") — commit it: it names a store by name, so it works on any machine with that store registered
```

`<repo root>/.writeup` holds one line, `store = "work"`. It names a
store *name*, never a path, so committing it makes the choice portable:
any machine whose registry has a `work` store resolves the same way,
whatever directory the repository was cloned into. Running `--marker`
again is a no-op; naming a different store rewrites the file and says
what it replaced; an unregistered name or a directory outside any git
repository is refused. Only the nearest repository's marker counts — a
nested repository does not inherit its parent's.

### Creating and registering stores

```
node $SELF/scripts/init-store.mjs --name work --description 仕事
node $SELF/scripts/init-store.mjs --name private --description 個人 --default
```

`--name` creates `<registry dir>/<name>` (or `--store <dir>`), runs the
usual store bootstrap (git init, `.writeup.toml`, `_kit/`, build), and
adds a `[[store]]` entry — never a second one for the same name;
`--description` sets (or updates) that entry's one-line `description`,
`--default` rewrites the registry's `default`. Run with no flags it is
the legacy single-store bootstrap and does not touch the registry.
`build`, `rerender-figures` and `self-check` do not take `--store-name`;
point them at the resolved dir with `--store "$STORE"` instead.

### Serving

`node $KIT/bin/serve.mjs` with no store flag is the one viewer for every
registered store, on a single port (derived from the registry path, so
it is stable across runs; a taken port falls back to a free one):

```
$ node $KIT/bin/serve.mjs --no-open
serve: built 12 pages (legacy: 3) in /Users/me/.local/share/writeup/work
serve: built 8 pages (legacy: 0) in /Users/me/.local/share/writeup/private
serve: http://127.0.0.1:41234/work/ (store work: /Users/me/.local/share/writeup/work)
serve: http://127.0.0.1:41234/private/ (store private: /Users/me/.local/share/writeup/private, default)
```

- `/` redirects to the default store's index (`/private/`).
- `/<name>/…` serves that store's files; `/<name>` redirects to `/<name>/`.
- `/id/<id>` redirects to the page in whichever store has it (registry
  order on a tie); `/<name>/id/<id>` looks in one store only.
- A path under `/<name>/` that does not exist gets that store's 404 page
  (near pages, index search); a path under no store prefix is looked up
  across every store, each candidate labelled with its store.

The index page of each store carries a switcher above its eyebrow: the
current store (`aria-current="page"`) and links to the others, written
as `../<name>/index.html` so the same file works under `serve` and on
`file://`. Nothing is kept in `localStorage`; the URL carries the store.

`--store <dir>` / `--store-name <name>` serve one store at the root (the
old single-store layout, `/id/<id>` included); without a registry the
legacy store is served that way automatically.

## Step 1 — deciding the kind

| Request sounds like | kind |
|---|---|
| "この判断を記録に残して", "何を決めたか残しといて" | 決定記録 (decision record) |
| "設計書にして", "アーキテクチャをまとめて" | 設計 (design) |
| "調べたことをまとめて", "何が分かったか整理して" | 調査まとめ (research summary) |
| "参考にした資料をまとめて", "資料を並べて比較して" | 参考資料まとめ (reference roundup) |
| "PBI にして", "チケット用の資料にして" | PBI 資料 (PBI doc) |
| "図解して", "絵で説明して"（相手が非エンジニア） | 絵解き (picture explainer) |
| "作業メモ残して", "今日やったこと書いといて" | 作業メモ (work note) |
| "議事録にして", "MTGの決定と宿題まとめて" | 議事録 (meeting minutes) |

A workflow report (research / design-review / acceptance / deliberate)
almost always maps to 調査まとめ, 設計, 決定記録, or 議事録 depending on
what the workflow actually produced — read its Markdown first, then pick
the kind whose required sections it already roughly matches, rather than
forcing every workflow report into 決定記録 by default.

## Step 3 — writing the page and rendering figures

### The stylesheet link

`kit/template.html` ships `<link rel="stylesheet" href="./writeup.css">`.
That is correct only for `template.html` and `samples.html`, which sit
inside `kit/` next to the CSS. A page saved into the store links the kit
from its own depth instead — one level down (`<store>/<folder>/page.html`)
means `../_kit/writeup.css`:

```html
<link rel="stylesheet" href="../_kit/writeup.css">
```

Write it that way when you copy the template. `build` also repairs it, so
neither the placeholder nor a moved page stays broken — observed:

| link as saved | after `build`, page at depth 1 | at depth 2 |
|---|---|---|
| `./writeup.css` (placeholder) | `../_kit/writeup.css` | `../../_kit/writeup.css` |
| `../_kit/writeup.css` | unchanged | `../../_kit/writeup.css` |

So a page that renders as unstyled HTML the moment you save it is almost
always just a page that has not been built yet: run Step 7's
`build.mjs --store "$STORE"` and reload before looking for anything worse.

### Choosing the figure type — before any IR is written

A figure has a `type:`, and the type is a decision, not a default. Ask
what the reader must see faster than prose — a structure, a flow or time,
a state, a quantity or comparison, a containment or scope, a hierarchy, a
cause — and map the answer with the table in `$KIT/references/writing.md`
§4 (`kinds.md` names the 2–4 types that usually fit the page's kind). Then
confirm against the renderer, which is the authority on what exists:

```
node $KIT/bin/render-diagram.mjs --list-types      # every type: purpose, when to use, budgets, verify rows
node $KIT/bin/render-diagram.mjs --doc <type>      # that type's IR example (YAML) — start the IR from it
node $KIT/bin/render-diagram.mjs --doc state > ir.yaml && node $KIT/bin/render-diagram.mjs ir.yaml --figure
```

`--doc` prints the IR *shape* for the type (its top-level keys differ per
type: `states:`/`transitions:` for `state`, `participants:`/`messages:` for
`sequence`, `categories:`/`series:` for `bar`, …), so read it before writing
rather than guessing keys from the `diagram` schema. Every type renders
with the same `--figure` / `--json` command and the same exit codes below.
A before/after pair is the same type twice; `freeform` only when
`--list-types` shows nothing covers the picture.

### `render-diagram.mjs` — observed behavior

```
$ node $KIT/bin/render-diagram.mjs --help
usage: render-diagram.mjs <ir.yaml|ir.json> [--column 720] [--out out.svg] [--json] [--figure]
       render-diagram.mjs --list-types | --doc <type>
```

Exit codes: `0` ok, `1` cannot read the input file, `2` the IR failed to
parse/validate, `3` it rendered but failed a contract §4-2 check.

A minimal valid IR and its `--json` result, for calibration — note that
`direction` had to be pinned to `down` here; the renderer's own
orientation-choice check (#16) failed when it picked `right` for this
two-node case:

```yaml
id: d1
title: 現在地
caption: SPA が API を直接呼んでいる
direction: down
nodes:
  - id: spa
    label: SPA
    emphasis: true
  - id: api
    label: API
edges:
  - from: spa
    to: api
    label: 呼ぶ
    kind: sync
```

```
$ node $KIT/bin/render-diagram.mjs sample.ir.yaml --json
{"ok":true,"svg":"<svg role=\"img\" aria-labelledby=\"wu-d-d1-title wu-d-d1-desc\" viewBox=\"0 0 148 300\" ...>...</svg>","figureHtml":"<figure class=\"wu-figure\" data-checks=\"pass\">...</figure>","width":148,"height":300,"scaled":false,"scroll":false,"checks":[...20 rows, all ok:true...],"warnings":[]}
$ echo $?
0
```

`figureHtml` is the same verified `<figure>` block `--figure` prints below
— present whenever `ok` is `true`, `null` otherwise — so a caller can take
either the raw `svg` or the ready-to-paste figure from one `--json` call.

A budget overrun (10 nodes, over the limit of 9) fails at exit 2 before
any geometry check runs, with a concrete `split:` suggestion:

```
$ node $KIT/bin/render-diagram.mjs over.ir.yaml --json
budget error: nodes: 10 > 9 — split: move the edges around node "N1" (degree 2) into a separate diagram
$ echo $?
2
```

`--figure` prints the whole `<figure class="wu-figure">` block ready to
paste into the page as-is — svg, `<figcaption>` from the IR's `caption`,
and the original IR in `<script type="text/x-writeup-diagram">`, already
stamped `data-checks="pass"` (only ever stamped when all 20 checks
passed):

```
$ node $KIT/bin/render-diagram.mjs sample.ir.yaml --figure
<figure class="wu-figure" data-checks="pass">
<svg role="img" ...>...</svg>
<figcaption>SPA が API を直接呼んでいる</figcaption>
<script type="text/x-writeup-diagram">
id: d1
title: 現在地
caption: SPA が API を直接呼んでいる
direction: down
nodes:
  - id: spa
    label: SPA
    emphasis: true
  - id: api
    label: API
edges:
  - from: spa
    to: api
    label: 呼ぶ
    kind: sync
</script>
</figure>
$ echo $?
0
```

Redirect it straight into a file (`--figure > fig.html`) or pass `--out`;
either way, paste the result verbatim — never hand-wrap a raw `<svg>`
yourself.

### Exit 3 — fixing a failed check, kit present

`ok:false`'s `checks` array names every failing row with a concrete
`hint` (contract §4-2). Edit the IR and re-render, up to 3 attempts,
picking the move the hint actually names:

- `hint` mentions `from_side`/`to_side`/`via` (crossing, collinear
  overlap, border-hug, node-clearance) → add that field to the offending
  edge.
- `hint` mentions the rhythm floor (a segment under 8px/16px) → widen
  node spacing, or drop the `via` bend causing the short jog.
- `hint` mentions orientation → pin `direction` to the value it names.
- `hint` mentions the label → shorten it, or move it with `label_at`.
- `hint` mentions the budget (node/edge count) → split into a second
  diagram along the suggested cut.
- Two or more groups should read as parallel columns/rows (an org group
  next to the system group it owns, each member mirrored 1:1) rather than
  elk's default nested boxes → this is usually automatic (see below), but
  add `layer: <int>` (0-based) to a group to pin its column/row order
  explicitly, or `layer: none` to any group to opt the whole diagram back
  out to elk's default layout.

Two or more groups where every node belongs to one and the inter-group
edges form a DAG (no A→B *and* B→A between the same two groups) auto-
detect this "grouped-layer" mode with no hint needed: each group's
column/row order is the length of the longest inter-group-edge path to
it, so a group nothing points to (e.g. "org") sits before a group only
reachable from it (e.g. "sys"), however many hops apart. An intra-group
edge (e.g. team A → team B, both inside "org") never affects that
ordering — it draws as a short straight connector between the two boxes
instead of pushing one of them into a second column.

Still `ok:false` after 3 attempts (kit present): do **not** fall back to
a `.wu-table` — that fallback exists only for kit-less mode (no
`render-diagram.mjs` to call at all). Instead keep the original IR
visible and flag it honestly:

```html
<figure class="wu-figure">
<div class="wu-callout" data-tone="warn">
<p>この図は自動レイアウトの検証(#6 rhythm)を通過できず、手動での調整が必要です。</p>
</div>
<figcaption>キャプション</figcaption>
<script type="text/x-writeup-diagram">
id: d1
...
</script>
</figure>
```

Name the specific failing check (id + name, e.g. "#6 rhythm") in the
callout so the reader — and the next attempt — knows exactly what to
fix, and tell the user in the same turn rather than only noting it in
the page. This figure does not get `data-checks="pass"`; count it as a
miss in step 5's `diagram=N/N` tally (see below).

## Step 4 — lint

### `lint.mjs` — observed behavior

```
$ node $KIT/bin/lint.mjs --help
使い方: node bin/lint.mjs <file.md|.html|.txt> [options]

options:
  --json                機械可読な JSON で出力する
  --baseline <prev.json> 前回の --json 出力と比較し resolved/new/persisting を判定する
  --config <path>       .writeup.toml の場所を指定する（未指定時は入力ファイルのディレクトリから
                        $HOME まで祖先を探索し、見つからなければ $WRITEUP_STORE/.writeup.toml を見る）
  --surface-only        表層6検出器 + 文長/括弧カウンタのみ実行する（作業メモ用）
  --experimental        まだ定量校正されていない検出器の finding も出力する
  --genre <name>        essay/tech/business のいずれか

終了コード: 0 = 実行成功（finding件数に関わらず）, 1 = 入力エラー, 2 = 設定エラー
```

`--config` is only for pointing at a `.writeup.toml` outside that search
path (a fixture, a second store); the normal case needs nothing extra —
`lint.mjs` walks up from the page's own directory to `$HOME` looking for
`.writeup.toml`, then falls back to `$WRITEUP_STORE/.writeup.toml`, so it
finds the store's config on its own. That same file's `[private]` and
`[cloudflare]` sections (owned by `publish.mjs`) are ignored, not
rejected — only `[lint]` and `[[allow]]` are validated, and an `[[allow]]`
entry needs all three of `category`, `text`, and `reason` or the config
is treated as malformed (exit 2).

Exit 0 means "ran successfully" regardless of finding count — lint is a
report, not a gate that fails the build. A sample `--surface-only --json`
run on a short passage:

```json
{
  "file": "note.txt",
  "stats": { "totalFindings": 3, "byCategory": {"translationese": 2, "forbidden_phrase": 1}, "surfaceOnly": true },
  "findings": [
    {
      "category": "translationese",
      "severity": "info",
      "excerpt": "テストの文章である。することができる、と言えるだろう。",
      "span": {"line": 1, "start": 13, "end": 21},
      "message": "翻訳調パターン: /することができ(る|ます|た)/ に一致",
      "suggestion": "直訳調の言い回しを日本語として自然な語順・表現に書き換える"
    },
    {
      "category": "forbidden_phrase",
      "severity": "warn",
      "excerpt": "。することができる、と言えるだろう。",
      "span": {"line": 1, "start": 22, "end": 29},
      "message": "禁止語/LLM常套句ヒット: 「と言えるだろう」",
      "suggestion": "定型句を削除するか、具体的な内容に置き換える"
    }
  ]
}
```

For each finding: rewrite the passage (fix) or leave it and note the
reason in the commit message (keep), e.g.
`decision: 再試行方針 (lint: keep forbidden_phrase L12 — 固有の技術用語のため)`.

## Step 5 — self-check and the `checks` meta

### `self-check.mjs` — observed behavior

```
$ node $KIT/bin/self-check.mjs
usage: node bin/self-check.mjs <page.html> [--json] [--write-meta]
$ echo $?
2
```

Exit codes: `0` pass, `1` fail (see `errors`/`warnings` in `--json`
output), `2` usage error (missing/unreadable file). A passing page:

```
$ node $KIT/bin/self-check.mjs page.html --json
{
  "ok": true,
  "errors": [],
  "warnings": [],
  "items": []
}
$ echo $?
0
```

`--write-meta` patches only the `self-check=` key inside
`<meta name="checks">`, by parsing the existing `key=value;...` pairs and
replacing (or appending) that one key — it never touches `lint=` or
`diagram=`. The template starts with
`content="lint=pending;self-check=pending"`. Compose the final value
yourself, in this order, before running `--write-meta`:

1. Replace `lint=pending` with `lint=pass` once you've resolved every
   lint finding (fix or keep), or `lint=skipped` in kit-less fallback
   mode (§ SKILL.md "Zero-dependency rule").
2. Set `diagram=M/N` where `N` is the number of `.wu-figure` elements on
   the page and `M` is how many of them carry `data-checks="pass"`. This
   is `N/N` whenever every figure is a passing `ok:true` render (the
   normal case); it drops below `N/N` only for a figure kept after the
   exit-3 fallback (its warn callout is the honest record of why). Use
   `diagram=0/0` for a page with no figures, `diagram=fallback` in
   kit-less mode.
3. Run `node $KIT/bin/self-check.mjs page.html --write-meta`, which then
   only has to fill in `self-check=pass` (or `fail`) next to the values
   you already set.

Result, e.g.: `checks="lint=pass;self-check=pass;diagram=2/2"`.

The `<meta name="checks">` tag is the single source of that value — every
tool reads and writes it there, and nothing else. The `.wu-footer` carries
`<dt>checks</dt><dd>lint=pending; self-check=pending</dd>`, which is the
same string typed out for a human reading the page. It is chrome text, so
you may edit it (unlike the footer's structure), and **no tool syncs it**:
`--write-meta` patches the meta only, and `build` leaves the footer alone.
Retype it by hand in the same edit that finalises the meta — otherwise a
page whose gates all passed still displays `pending` to its reader.

### After a kit/renderer upgrade — `rerender-figures.mjs`

A kit upgrade can change what contract §4-2 accepts (a fixed check, a
loosened budget), which means some figures kept as an exit-3 table
fallback may now render clean, and — less often — some previously-passing
figures may now fail under the tightened contract. Re-run every stored
figure that carries a recoverable IR instead of hand-checking each page:

```
node $KIT/bin/rerender-figures.mjs --store <dir>
```

It finds every `.wu-figure` with an embedded
`<script type="text/x-writeup-diagram">` that isn't already marked
`data-checks="pass"`, re-renders it, and — only on success — replaces that
one `<figure>...</figure>` block in place and updates the page's
`diagram=M/N` meta; a figure that still fails is left untouched and shows
up in the printed summary with its failing check names. Add `--all` after
a change that could regress a passing figure (re-tries every figure, not
just fallbacks), `--only <glob>` to scope to part of the store,
`--dry-run` to preview without writing, and `--report out.json` for the
full per-page/per-figure detail behind the summary line.

## Step 7 — `.writeup.toml` template

Written once by `scripts/init-store.mjs` (see that script for the exact
idempotent write). Shape:

```toml
[private]
words = []

[lint]

[cloudflare]
project = ""
access_required = true
access_verified = false
```

`[private].words` is a list of case-insensitive substrings `publish.mjs`
refuses to publish if they appear anywhere in the page's title, meta
values, or body text — see `references/publish.md`. `[cloudflare]` gates
`--to cloudflare` the same way. `[lint]`/`[[allow]]` are `lint.mjs`'s own
sections (§6) — it finds this same file automatically (Step 4 above) and
ignores `[private]`/`[cloudflare]` rather than erroring on them.

## Steps 6-8

Covered at the right level of detail already in `SKILL.md` — nothing
further to add here beyond: `build.mjs`'s observed output is
`build: N pages (legacy: M) in <store>` followed by
`build: wrote manifest.json, index.html, _kit/writeup.css`, and it
accepts `--store <dir>` the same way `publish` does (otherwise the
Step 0 resolution order: `$WRITEUP_STORE`, ancestor `.writeup.toml`,
repository marker, registry default, legacy `~/.local/share/writeup`).
Always pass `--store "$STORE"` so build and commit hit the store chosen
in Step 0.

Step 7's commit assumes `$STORE` is a git repository. `init-store.mjs`
makes each store one (`git init`) as part of the bootstrap, and each named
store gets its own repo — never the enclosing one — so `work` and
`private` keep separate histories. If the commit instead fails with git's
`not a git repository` error, the directory was never bootstrapped: `build` (and `serve`) will create
`~/.local/share/writeup` and write `manifest.json`, `index.html` and
`_kit/` into it on a fresh machine, but that leaves no `.git` and no
`.writeup.toml`. Run `node $SELF/scripts/init-store.mjs --name <name>
--description <text>` against that directory — it is idempotent and
leaves the existing pages alone — then retry the commit.


## Decision records: writing 決まったこと

For kind 決定記録 the decisions are headings and prose, not cards
(`$KIT/references/kinds.md` has the skeleton, `writing.md` §7 the
sentence shape). Write them in this order:

1. `.wu-lede`, then `.wu-summary` with no signal phrase (`結論から言うと`
   and its kin are lint `forbidden_phrase` hits).
2. The 一覧表 before the first `h2`: `.wu-table`, columns 番号 / 決定 /
   タグ / 状態, one row per decision, each 決定 cell
   `<a href="#d<n>">`. self-check `decision-index` looks for it.
3. `<h2>決まったこと</h2>`; theme `h2`s under it only when the list is
   long enough to group.
4. Per decision, `<h3 id="d<n>">` whose text is the decision, then the
   first paragraph as one unlabeled Y-shaped sentence (局面 / 選んだ /
   捨てた / 得る / 受け入れる, natural Japanese, two sentences if one
   would pass 80 chars), then prose that says why it wins and names the
   rejected option inside the prose, then a `.wu-meta` line with the basis
   (path / URL / agreement date). self-check `decision-shape` warns on any
   decision h3 that lacks the paragraph or the `.wu-meta` before the next
   heading. Do not write `<p><strong>決定:</strong>` lines — three of the
   same label is `label-repeat`.
5. Close the decisions with `<h3>決定の関係図</h3>` and one `diagram`
   drawn as a DAG (制約する / 可能にする / 競合する); self-check `relation-figure`
   asks for it at 5 or more decisions.
6. 却下した案 as prose or a list — a `.wu-compare` only with 3+ options
   and 3+ criteria — then 未決・前提, 出典, 次のステップ.

`.wu-decision` cards stay for a design doc with one or two decisions;
three on a 決定記録 is `decision-cards`.

## Decision records: figures

A figure goes right before a decision's prose only when a figure type
fits the decision — never one per decision, never as decoration. Pick the
type by what the reader must see (`writing.md` §4):

- the decision changes a structure → the same type twice (`diagram` or
  `zones`), before and after, so the reader compares the difference and
  nothing else;
- it changes a flow → `sequence` (who calls whom), `swimlane` (hand-offs),
  `process` (the same facets per stage);
- it changes a state → `state`, twice when a transition is added or removed;
- it compares options → `matrix` / `quadrant` / `radar`, or a table when
  the criteria are qualitative or a 3-column table already says it.

Decisions about wording, numbers, or scope get no figure; two decisions
that change the same structure or flow share one. Take the IR shape from
`render-diagram.mjs --doc <type>`, keep it within the type's budgets
(`--list-types`), render with `render-diagram.mjs --figure`, paste the
`<figure>` verbatim between the summary sentence and the prose, and do not
restate in the prose what the figure shows (`writing.md` §3).
