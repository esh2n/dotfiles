---
name: yoki-graph
description: 多角の並列レビュー・調査・実装をワークフロー(グラフ)で回すときのカタログと起動方法。どのグラフがあるか(review / research / implement / preflight / design-review / acceptance / code-study / deliberate / stocktake / go-optimize)、いま必要かどうか、どう起動するかを決めるときに読む。Claude Code ではネイティブの Workflow tool、Codex / omp からは `yoki-graph` CLI が同じスクリプトを走らせる。「多角でレビューして」「並列で調べて」「codex から review 回して」「ワークフロー何がある？」やランの status/journal を見るときも。
---

# yoki-graph

## ワークフローは目的ではなく手段

グラフを回すこと自体に価値は無い。価値があるのは**独立したコンテキストを
並べて突き合わせること** — 互いに引きずられないレビュアー、角度の違う調査、
検証つきで直列化された実装バッチ。それが要らない仕事に持ち出すと、遅くて
高いだけの遠回りになる。

| 使う | 使わない |
| --- | --- |
| 複数の判定/検証を伴うバッチ、多角レビュー、複数ソースの調査 | 1パスで終わる読み書き、原因が1つに絞れている調査 |
| 独立コンテキストであること自体が結果を変える(アンカリングを避けたい) | 1エージェントにタイトなループを回させたほうが速い |
| per-task の verify + gate + delivery が要る | 手を動かせば終わる小さな修正 |

`core/CLAUDE.layer.md`(Expensive-Model Delegation)の原則そのまま:

> Workflow vs single agent: workflows for batches of adjudicated tasks
> (parallel, per-task verify + gate + delivery); a single agent for
> one-cause investigations with a tight repro loop; the main session only
> for judgment and acceptance

迷ったら下のカタログの「いつ使うか」に今のタスクがはまるか先に確認する。
はまらないなら単発の subagent でいい。

## カタログ

<!-- catalog:begin -->
<!-- GENERATED from core/workflows/*.js + packs/*/workflows/*.js by
     runtime/yoki/scripts/lib/graph/catalog.js. Edit a script's `meta`, not this table. -->

| workflow | 何をするか | いつ使うか |
| --- | --- | --- |
| `acceptance` | Acceptance check for finished work: map each criterion to the evidence that actually pins it, adversarially verify the coverage claims, and report the gaps a human must close | Implementation is done and you need to know whether it can ship — which criteria are pinned by tests, which are manual-only, and which are silently unmet |
| `code-study` | Read a specific codebase against fixed questions: locate the relevant parts, read them, spot-check the citations, and report with file:line evidence | You need to understand how an existing implementation actually works — a library you might borrow from, a codebase you inherited, a product whose approach you are weighing. Reading, not web research |
| `deliberate` | Double-diamond deliberation: ground in existing code/docs, reframe the real question, diverge with forced-diversity operators, gate load-bearing claims through code/web evidence, converge on pre-registered criteria, adversarially challenge (one retry loop), synthesize | Design sparring, architecture choices, product direction — judgment calls where some sub-claims need evidence (from the repo or the web) and some need perspectives. Use research instead when the whole answer must come from current sources. |
| `design-review` | Review a design/spec against project reality before implementation: 5 fresh lanes (conventions/architecture/security/wording/release) + failure-modes when pattern checklists are installed, adversarial verification, ends with the 論点 a human must decide | A design doc, ADR, or spec is written and you want it stress-tested against the repo's own rules before anyone implements it |
| `implement` | Batch-execute an agreed task list: dependency waves computed in code, file-overlap-aware parallelism in one working tree, per-task verify+retry with test evidence, optional delivery (commit / draft-pr) as a final phase | You already have an agreed task list (from /sdd tasks or a plan) and want it executed with per-task quality gates instead of one long prose run |
| `preflight` | Pre-PR local quality gate: fan-out review, judge screens findings, auto-fix accepted code findings (security report-only), lint/build gate, content-hash pass marker | Before opening a PR — run the local quality gate on the branch diff |
| `research` | Multi-angle research: decompose a question, search each angle in parallel, verify load-bearing claims against sources, synthesize with citations | Investigating a technology, trend, or decision where the answer must come from current sources, not model memory |
| `review` | Instrumented multi-agent code review: fresh-context reviewers with C/I thresholds, adversarial verification, per-agent metrics | Reviewing local changes or a branch diff with independent (non-anchored) reviewer contexts |
| `stocktake` | Periodic harness stocktake: scan skills / hooks / MCP / memory / freshness for stale, unused, or version-drifted items and produce a keep/drop report (report-only, no deletion) | Monthly config GC, or whenever ~/.claude feels bloated |
| `go-optimize` (go pack) | Evidence-gated Go performance optimization: pprof hot-spot ID, parallel worktree proposals across distinct angles, statistical + mechanism gating via benchstat/pprof diff, adversarial verify, draft-by-default delivery | A Go package has a benchmark (or needs one) and you want measured, gated optimization proposals instead of a single unverified "this should be faster" edit |
<!-- catalog:end -->

`(<pack> pack)` が付くグラフは、そのパックが有効な機体にだけ
`~/.claude/workflows/` へインストールされる(`yoki-switch pack enable go`)。
この機体で実際に何が入っているかは `yoki-graph list`。

## 起動する

**Claude Code の中では、ネイティブの Workflow tool がこれまでどおり本来の
経路。**yoki-graph CLI に切り替える必要はない。

```js
Workflow({ name: 'review',   args: { range: 'origin/main...HEAD' } })
Workflow({ name: 'research', args: { question: '…' } })
Workflow({ name: 'implement', args: { tasksFile: 'tasks.md', delivery: 'none' } })
```

Workflow tool を持たない harness(Codex の `codex exec`、omp)、または CLI から
`--resume` / `--json` / `status` でランを直接触りたいときは同じスクリプトを
`yoki-graph` で回す:

```
yoki-graph run review    --backend codex --args '{"range":"origin/main...HEAD"}'
yoki-graph run research  --backend omp   --args '{"question":"…"}'
yoki-graph run implement --backend codex --args '{"tasksFile":"tasks.md","delivery":"none"}'
yoki-graph list
yoki-graph status <runId> [--once|--watch]
```

backend は `codex` / `omp` / `mock` の3つ。**`claude` backend は無い** —
Claude Code の中ではネイティブの Workflow tool が唯一のサポート経路で、
`claude -p` を叩くのはそれと二重の非サポート経路になる(かつ従量課金に
移る可能性がある)ため。`--backend claude` を渡すとその旨を名指しで拒否して
exit 1 になる。同じ理由で yoki-loop からも `--harness claude` を外した
(Claude Code は `/loop` と定期実行を自前で持つ)。

グラフを**書く**のはこのスキルの仕事ではなく `workflow-authoring` スキルの
領域。yoki-graph はその実行だけを担う。

## 起動前に必ず決めておくこと

`implement` / `go-optimize` の `delivery`(commit / draft-pr / pr)は
**起動前にユーザーへ確認する**。グラフは途中で聞き返してこない — 未指定は
必ず安全側(`'none'` / `'draft'`)に倒れる。→ [references/cli.md](references/cli.md)

## 詳細

| 知りたいこと | 参照 |
| --- | --- |
| 全フラグ、ワークフロー別の `args` と起動例、delivery のルール、よくある失敗 | [references/cli.md](references/cli.md) |
| モデル tier の解決、`--model-map`、モデル別 usage 表 | [references/model-map.md](references/model-map.md) |
| 進捗行の読み方、`--json` イベント、`status --watch` | [references/status.md](references/status.md) |
| 日次キャップ(guard)、ラン単位の実行キャップ、リトライ/タイムアウト/トークン計上 | [references/budget.md](references/budget.md) |
| 1ランでの backend 混在、Claude Code から Codex/omp レーンを混ぜる `providers` | [references/providers.md](references/providers.md) |
| `sandbox`(呼び出しごとの書き込み権限)と `gate`(コマンド検証) | [references/gate.md](references/gate.md) |
| journal の読み方、`--resume` の prefix 再生、runId ロック | [references/resume.md](references/resume.md) |

単発で Codex / omp に1つの仕事を投げるだけなら、グラフではなく
`yoki-agent`(→ `yoki-agent` スキル)。
