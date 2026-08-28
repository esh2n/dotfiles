# Procedure (full detail)

This expands `SKILL.md`'s 8 steps with the exact CLI output to expect,
the `.writeup.toml` template, and how the `<meta name="checks">` value
is composed. All commands below assume `$KIT` and `$STORE` were already
resolved per `SKILL.md`'s shell snippet.

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

### `render-diagram.mjs` — observed behavior

```
$ node $KIT/bin/render-diagram.mjs --help
usage: render-diagram.mjs <ir.yaml|ir.json> [--column 720] [--out out.svg] [--json] [--figure]
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
accepts `--store <dir>` the same way `self-check`/`publish` do (falls
back to `$WRITEUP_STORE`, then `~/.local/share/writeup`).
