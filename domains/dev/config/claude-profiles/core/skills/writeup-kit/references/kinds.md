# Kinds

`kind` is chosen before writing, and it fixes which sections and components
the page must use. This is the page-type side of the kind-to-component
mapping in `components.md`. The 8 kind values are Japanese strings — they
are written literally into `<meta name="kind" content="...">` and appear as
literal h2 headings in the page. Each is glossed once in English below.

grilling's round pages and show-me's single-page output are skill-specific
shapes and are **not** in this table — grilling round HTML is assembled from
kit components (`compare` / `figure` / `terms` / `open`) but does not follow
one of these 8 kind contracts.

## Kind table

Figures are not budgeted by count. Draw one wherever a reader would grasp a
structure, a flow, or a comparison faster from a picture than from the prose;
skip it where the prose already says it. Each figure is drawn in a *type*
chosen by what the reader must see (`writing.md` §4 — the rule and the full
type table; `bin/render-diagram.mjs --list-types` prints every type with its
budgets). Budgets are per type and per figure (`diagram`: ≤9 nodes, ≤12
edges) and are guidance; verified geometry decides. The 図が効く場面 column
names the 2–4 types that usually fit each kind; it is guidance, not a cap.

| kind | Required sections | Use | Avoid | Length / where a figure helps |
|---|---|---|---|---|
| 決定記録 (decision record) | 決まったこと／却下した案／未決・前提／次のステップ | summary, table (the 一覧表), figure, meta, open, steps | chip; decision (cards) for the list of decisions; compare unless 3+ options × 3+ criteria | 2,000-4,000 chars. 図が効く場面: `diagram` twice (before/after) for a decision that changes a structure; `state` when it changes which state may become which; `sequence` when it changes who calls whom; `matrix` when it compares options by criteria (a table when qualitative). Wording, numbers, and scope need none. One 決定の関係図 (`diagram`, a DAG) closes the decisions |
| 設計 (design) | 目的と読者／用語／現状とギャップ／あるべき姿／決定点／進め方 | terms, figure, compare, code, open | chip | 3,000-8,000 chars. 図が効く場面: `zones` for the parts and which links cross a boundary (現状とギャップ / あるべき姿, same type twice); `sequence` for the call order the design fixes; `schema` when the data model is the decision; `state` for a lifecycle |
| 調査まとめ (research summary) | 問い／結論／根拠（表）／未確認／含意 | summary, table, quote, meta | decision | 2,000-6,000 chars. 図が効く場面: `bar` for measured magnitudes across categories; `line` for a trend or a two-state slopegraph; `scatter` when each item has two measures; `matrix` for which pairs hold; `timeline` for the events behind the question. The flow under investigation is a `diagram` only when a measurement point must be located on it |
| 参考資料まとめ (reference roundup) | 資料一覧（表）／各資料の要点／取るもの・置き先 | table, quote, meta, chip | steps | 3,000-8,000 chars. 図が効く場面: `tree` for how the references decompose or derive from each other; `matrix` for reference × topic coverage; `venn` when 2–3 references overlap and the overlap has a name |
| PBI 資料 (PBI doc) | 背景／決めたこと／未決／関係する文書 | summary, decision, meta, open | chip | 1,000-3,000 chars. 図が効く場面: `swimlane` for the affected flow and its hand-offs; `journey` when the user's experience per stage is the point; `board` (`story-map`) for where the release is cut. The scope boundary is a `nested` only when words keep misreading it |
| 絵解き (picture explainer) | フック／問題／仕組み3枚／現実復帰／まとめ1文 | figure (pictures) only | table, code, terms | 5-8 panels, ~50 chars of body text per panel. 図が効く場面: every panel; any type, one idea per figure — the type follows the idea (`writing.md` §4), never the previous panel |
| 作業メモ (work note) | 今日分かったこと／次にやること | steps, meta | summary, toc, compare | ≤1,000 chars. 図が効く場面: usually none; a `diagram` only if it saves the next-day self a re-read |
| 議事録 (meeting minutes) | 決定／宿題（誰が・いつまで）／論点（未決） | decision, steps, open | compare | 1,000-3,000 chars. 図が効く場面: usually none; `timeline` or `gantt` when the meeting fixed a schedule, a `diagram` only when a decision hinges on a structure that words keep misreading |

## Skeletons

### 決定記録 (decision record)

A decision record is a list of decisions the reader scans by heading, not
a column of cards. The page runs, in this order:

1. `.wu-lede`, then `.wu-summary` — conclusions first, no signal phrase
   (`writing.md` §3, §6).
2. The 一覧表: a `.wu-table` with the columns 番号 / 決定 / タグ / 状態,
   one row per decision, each 決定 cell an `<a href="#d<n>">` to its h3.
   No basis column — the table is for seeing the whole and jumping.
3. `<h2>決まったこと</h2>`, then theme `h2`s when the list is long enough
   to group (a theme h2 sits between 決まったこと and 却下した案; a short
   list has none).
4. One decision = `<h3 id="d<n>">` whose text **is** the decision, then:
   - the first paragraph: one unlabeled summary sentence in the Y shape
     (局面 / 選んだ / 捨てた / 得る / 受け入れる — natural Japanese; two
     sentences when one would pass 80 characters);
   - prose saying why it wins, naming the rejected option inside the prose;
   - a `.wu-meta` line with the basis — path, URL, or agreement date;
   - a figure **right before the prose**, only when a figure type fits
     (`writing.md` §4): a structure changes → the same type twice,
     before/after (`diagram` / `zones`); a flow changes → `sequence` /
     `swimlane` / `process`; a state changes → `state`; options are
     compared → `matrix` / `quadrant` / `radar`, a table when qualitative.
     Decisions about wording, numbers, or scope get none; two decisions
     that change the same structure share one figure.
5. At the end of the decisions, one 決定の関係図 (`.wu-figure`, a `diagram`
   drawn as a DAG): which decision 制約する / 可能にする / 競合する which.
6. 却下した案 as prose or a list. A comparison table only when there are
   3 or more options and 3 or more criteria.
7. 未決・前提 (`.wu-open`), 出典 when the page rests on external
   documents, 次のステップ (`.wu-steps`, ordered). No `.wu-chip` in this kind.

`.wu-decision` cards are for a callout, for comparable parallel items, or
for a design doc that records one or two decisions — never for the list of
decisions here. self-check enforces the shape: `decision-index`,
`decision-shape`, `decision-cards`, `relation-figure` (`page-contract.md` §4).

```html
<div class="wu-summary"><p>...</p></div>
<table class="wu-table">
  <thead><tr><th>番号</th><th>決定</th><th>タグ</th><th>状態</th></tr></thead>
  <tbody><tr><td>1</td><td><a href="#d1">fan-out は横断検索にする</a></td><td>経路</td><td>合意</td></tr></tbody>
</table>
<section class="wu-section"><h2>決まったこと</h2>
  <h3 id="d1">fan-out は横断検索にし、tenant 表を廃止する</h3>
  <p>テナントごとに検索する局面で、テナント表の維持ではなく横断検索を選び、空振りの行が消え、索引の追加を受け入れる。</p>
  <figure class="wu-figure">...before...</figure>
  <figure class="wu-figure">...after...</figure>
  <p>テナント表を残す案は...だが、...。</p>
  <p class="wu-meta">docs/adr/APP_013.md:28 / 2026-08-27 合意</p>
  <h3 id="d2">...</h3>
  ...
  <h3>決定の関係図</h3>
  <figure class="wu-figure">...</figure>
</section>
<section class="wu-section"><h2>却下した案</h2><p>...</p></section>
<section class="wu-section"><h2>未決・前提</h2>
  <div class="wu-open"><ul><li>...</li></ul></div>
</section>
<section class="wu-section"><h2>出典</h2><p class="wu-meta">...</p></section>
<section class="wu-section"><h2>次のステップ</h2>
  <ol class="wu-steps"><li>...</li></ol>
</section>
```

### 設計 (design)

Required sections: 目的と読者 (purpose and audience) / 用語 (terms) /
現状とギャップ (current state and gap) / あるべき姿 (desired state) / 決定点
(decision points) / 進め方 (how to proceed).

```html
<section class="wu-section"><h2>目的と読者</h2><p>...</p></section>
<section class="wu-section"><h2>用語</h2><dl class="wu-terms">...</dl></section>
<section class="wu-section"><h2>現状とギャップ</h2>
  <figure class="wu-figure">...</figure>
</section>
<section class="wu-section"><h2>あるべき姿</h2><p>...</p></section>
<section class="wu-section"><h2>決定点</h2><table class="wu-compare">...</table></section>
<section class="wu-section"><h2>進め方</h2>
  <div class="wu-open"><ul><li>...</li></ul></div>
</section>
```

### 調査まとめ (research summary)

Required sections: 問い (question) / 結論 (conclusion) / 根拠（表） (evidence
table) / 未確認 (unconfirmed) / 含意 (implications).

```html
<div class="wu-summary"><p>...</p></div>
<section class="wu-section"><h2>問い</h2><p>...</p></section>
<section class="wu-section"><h2>結論</h2><p>...</p></section>
<section class="wu-section"><h2>根拠</h2><table class="wu-table">...</table></section>
<section class="wu-section"><h2>未確認</h2><ul><li>...</li></ul></section>
<section class="wu-section"><h2>含意</h2><p>...</p></section>
```

### 参考資料まとめ (reference roundup)

Required sections: 資料一覧（表） (document list, as a table) / 各資料の要点
(key points per document) / 取るもの・置き先 (what to take, and where it goes).

```html
<section class="wu-section"><h2>資料一覧</h2><table class="wu-table">...</table></section>
<section class="wu-section"><h2>各資料の要点</h2>
  <blockquote class="wu-quote">...</blockquote>
</section>
<section class="wu-section"><h2>取るもの・置き先</h2>
  <ul class="wu-chip"><li>...</li></ul>
</section>
```

### PBI 資料 (PBI doc)

Required sections: 背景 (background) / 決めたこと (what was decided) / 未決
(open items) / 関係する文書 (related documents). `wu-figure` only when a
diagram is actually needed for this PBI.

```html
<div class="wu-summary"><p>...</p></div>
<section class="wu-section"><h2>背景</h2><p>...</p></section>
<section class="wu-section"><h2>決めたこと</h2><div class="wu-decision">...</div></section>
<section class="wu-section"><h2>未決</h2><div class="wu-open">...</div></section>
<section class="wu-section"><h2>関係する文書</h2><p class="wu-meta">...</p></section>
```

### 絵解き (picture explainer)

Required sections: フック (hook) / 問題 (problem) / 仕組み3枚 (mechanism, 3
panels) / 現実復帰 (return to reality) / まとめ1文 (one-sentence summary). Uses
`wu-figure` only — no tables, code, or term lists.

```html
<section class="wu-section"><h2>フック</h2><figure class="wu-figure">...</figure></section>
<section class="wu-section"><h2>問題</h2><figure class="wu-figure">...</figure></section>
<section class="wu-section"><h2>仕組み</h2>
  <figure class="wu-figure">...</figure>
  <figure class="wu-figure">...</figure>
  <figure class="wu-figure">...</figure>
</section>
<section class="wu-section"><h2>現実復帰</h2><figure class="wu-figure">...</figure></section>
<section class="wu-section"><h2>まとめ</h2><p>One sentence.</p></section>
```

### 作業メモ (work note)

Required sections: 今日分かったこと (what I learned today) / 次にやること
(what to do next). No `wu-summary`, `wu-toc`, or `wu-compare` — this kind
stays short and plain.

```html
<section class="wu-section"><h2>今日分かったこと</h2>
  <ol class="wu-steps"><li>...</li></ol>
</section>
<section class="wu-section"><h2>次にやること</h2>
  <ol class="wu-steps"><li>...</li></ol>
  <p class="wu-meta">...</p>
</section>
```

### 議事録 (meeting minutes)

Required sections: 決定 (decisions) / 宿題（誰が・いつまで） (action items,
who by when) / 論点（未決） (open discussion points). Usually no figure; a
`timeline` / `gantt` only when the meeting fixed a schedule.

```html
<section class="wu-section"><h2>決定</h2><div class="wu-decision">...</div></section>
<section class="wu-section"><h2>宿題</h2><ol class="wu-steps"><li>Who — by when — what.</li></ol></section>
<section class="wu-section"><h2>論点</h2><div class="wu-open">...</div></section>
```
