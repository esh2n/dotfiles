# 委譲はサブエージェントとワークフローを規模で使い分け、スクリプトは一本、実行系は各ハーネス、実行の分担は決定的な仕事に限る

Status: accepted — ベンダーは制御をコードに置き規模で使い分け、読む並列と決定的な実行の分担には効いた測定があり、書く並列だけが負けている（2026-09-22）。`2026-09-22-workflow-research-only.md` の「ハーネス横断は考えない」を上書きする

rule: Choose a single subagent for one or two delegations, a workflow script for a fixed multi-step procedure; either way, only delegate read-and-report work or deterministic execution (tests, lint, build, schema checks) — never implementation needing shared design judgment or concurrent writes to one file. Write workflow scripts once in Claude Code's syntax; jig itself has no execution engine.

## Problem

複数のエージェントに仕事を分けるとき、モデルがターンごとに部下を立てる形（サブエージェント）と、先に書いたスクリプトが何を何本立てるかを決める形（ワークフロー）のどちらを使うか。五つのハーネス（Claude Code、Codex、pi、DSH、omp）で同じ手順を持てるか。高いモデルが設計し、安いモデルが実行する分担をどこまで認めるか。jig が実行系を持つか。

## Decision

二つの軸は独立している。

1. **形の選び方（軸 1）は本数と手順の決まり具合。** 一つ二つの委譲（調べてきて、これを見て）はサブエージェント。決まった多本数の手順（レビューの三レーン、調査の四方向、棚卸し、設計批評）はワークフロー。omp では前者が `orchestrate`、後者が `workflowz`。
2. **委譲してよい仕事（軸 2）は、形に関係なく同じ。** 読んで返す仕事（review、research、code-study、stocktake、design-review）と、正誤が決定的な検査（テスト、lint、build、スキーマ）で決まる実行。この二つはサブエージェントでもワークフローでも委譲でき、安いモデルの部下に渡してもよい。実行を並列にするときは各レーンの書き先を隔離する（worktree か重ならないファイル集合）。同じファイルを複数の部下が同時に書く形、途中で設計判断を共有し続ける必要がある実装は、どちらの形でもしない。
3. **スクリプトは Claude Code の dynamic workflow の書式で一本**（`agent()`/`parallel()`/`pipeline()`/`phase()`、`meta` ブロック）。走らせるのは各ハーネスの実行系。Claude Code は本体、DSH は本体（語彙を合わせたと文書に明記）、pi は拡張、omp は `workflowz`/eval kernel、Codex は AGENTS.md の指示で同じ手順を委譲させる。**一本で本当に五つで動くかは実機で確かめる。動かないハーネスには薄い変換を作る**（Codex と omp が候補）。
4. **jig は実行系を持たない。** 持つのはスクリプト、pi 用に選ぶ拡張の配線、部下のモデル階層を `tiers.json` から各ハーネスの書式（`model`/`tier`）へ翻訳する部分。headless（`claude -p`、`codex exec`）で jig がプロセスを立てる形は取らない。
5. **モデル階層。** 司令塔（設計と判断）は高い層、部下の既定は安い層。軸 2 に当てはまる仕事（読む、決定的に検査できる実行）は形を問わず安い層に渡してよい。pi は 0.87 の `ContextEditEntry` で同一セッション内の切替も併用する。

## Alternatives considered

- **サブエージェントだけ（モデルに制御も任せる）**: OpenAI の handoffs、Anthropic の agent teams（experimental、既定 off、「approximately 7x」）、Cursor の coordinator がこの形だが、各社とも実験扱いか「手前の軽い方を先に」と注記。ベンダーの制御の置き方は揃ってコード側: OpenAI「orchestrating via code makes tasks more deterministic and predictable」、Google ADK「deterministic and predictable」、Microsoft「関数 → エージェント → workflow の順」、Cognition「deterministic な Python スクリプト」、Claude Code「Reach for a workflow when a task needs more agents than one conversation can coordinate, or when you want the orchestration codified as a script you can read and rerun」、DSH「for one or two delegations, prefer plain subagent calls」。却下。
- **ワークフローだけ**: 一つ二つの委譲にスクリプトを書くのは過剰で、DSH と Claude Code の文書が明示的に「少数はサブエージェント」と言う。却下。
- **実行の分担を「読んで返す」に限る**: 当初の私の案。安いモデルの部下に実行を渡して負けた記録（Cognition「SWE 1.5 は主モデルとして力不足」、Amp「rush mode は複雑な仕事で結局安くならない」、Ronacher「安いモデルはループの中では安くない」）を重く見すぎた。効いた記録もある: Anthropic の research system（Opus 司令塔 + Sonnet 部下、+90.2%）、Amp の Librarian（3 倍速く 43% 安く品質同じ）、TRAE の並列パッチ + 回帰テストの選別（70.6 → 78.8%）。負けた例は「正誤を決定的に判定できない仕事」で、勝った例は「読む」か「テストで決まる」仕事。線は「読むだけ」でなく「決定的に検査できる」に引く。却下。
- **jig が headless を N 本起動する実行系を持つ**: 五つ全部に headless はあるが、`claude -p` は Manual モード始まりで権限の旗が要り、`--bare` は API キー、セッション内の拡張（pi のガード・関門）は動かない。paradigm 調査の結論「自前の CLI ラッパーは prompt-cache の共有・usage-limit を見た一時停止・権限モードに沿った承認・進捗 UI を再現できない」。ユーザーの嫌う点（エラー処理が複雑、実行が見えない）と同じ。この形の公開実装は全部 0〜40 星で定番なし。却下。
- **レビューだけ Claude Code から回す**: 五つを対等に扱う前提を壊す。pi に部下の機構が無いという前提も誤りだった（nicobailon/pi-subagents 3,737 星、tintinweb/pi-subagents 1,206 星「Claude Code の Workflow tool 用のスクリプトがそのまま動く」、QuintinShaw/pi-dynamic-workflows 535 星）。却下。

## Consequences

- yoki-graph（自前の実行系）と preflight.js は捨てる。review・research・code-study・stocktake・design-review はスクリプトとして残し、各ハーネスで走らせる。
- 実機検証（同日、`rules/research/2026-09-22-workflow-script-portability.md`）: **pi は tintinweb/pi-subagents 0.19.0 で同じスクリプトがほぼ無変更で動く**（3 レーン並列・fresh を子セッションの JSONL で確認。要調整は `meta.phases` の要素が `{title}` オブジェクトであること、`model` 名は tiers.json からの翻訳が要ること。headless で回すなら pty 必須）。**omp は 10 行のシムで動く**（`export` 不可、`args` なし、`agent()` に per-call の `model` が無く親のモデルで走る → 決定 5 の「部下は安い層」は omp では agent frontmatter か `task.agentModelOverrides` 側で行う。`Date.now()` が throw しないので replay の同一性は保証されない）。**Codex は不可**（スクリプトの実行系が無く、部下は親スレッドの fork で親の会話を継承することを子の rollout で確認。変換では埋まらない）。DSH は未導入で未検証。
- 訂正: pi 拡張の選択は tintinweb 一択（CC スクリプトのランナーとして「無変更で走る」と主張し実測で裏付いた唯一）。`tier` は tintinweb に無く `model` のみ。Claude Code 側で `meta.phases` の要素型を一度確かめる。
- 測定が無いもの: N 人のレビュアー対 1 人（独立セッションが同一セッション派生に勝つ測定はある: F1 28.6% 対 23.8%）。費用は読む並列で 1.6〜3.9 倍、上限は必須（Claude Code は 16 並列・1,000/run、omp は 32、Codex は 4）。
- 部下のモデル階層は jig の tiers.json が唯一の元。ハーネスごとの書式（Claude Code `model`、pi 拡張（tintinweb）`model`、omp は agent frontmatter / `task.agentModelOverrides`）へ翻訳する。

## Sources

- `rules/research/2026-09-22-orchestration-vendors.md`、`rules/research/2026-09-22-orchestration-paradigm.md`、`rules/research/2026-09-22-orchestration-practitioners.md`、`rules/research/2026-09-22-orchestration-evidence.md`、`rules/research/2026-09-22-orchestration-in-the-wild.md`、`rules/research/2026-09-22-orchestration-lens-workflow-engines.md`、`rules/research/2026-09-22-multi-lane-review-per-harness.md`、`rules/research/2026-09-22-pre-pr-gate-practice.md`
- Claude Code: https://code.claude.com/docs/en/workflows.md 、https://code.claude.com/docs/en/sub-agents.md 、https://code.claude.com/docs/en/best-practices.md
- Anthropic research system: https://www.anthropic.com/engineering/built-multi-agent-research-system 、OpenAI Codex subagents: https://learn.chatgpt.com/docs/agent-configuration/subagents
- Cognition: https://cognition.ai/blog/multi-agents-working 、Amp: https://ampcode.com/news/a-faster-librarian 、https://ampcode.com/news/rush-mode
- 統制比較: https://arxiv.org/html/2512.08296 、独立セッションのレビュー: https://arxiv.org/abs/2603.12123
- pi 拡張: https://github.com/nicobailon/pi-subagents 、https://github.com/tintinweb/pi-subagents 、https://github.com/QuintinShaw/pi-dynamic-workflows
- omp: https://github.com/can1357/oh-my-pi （docs/magic-keywords.md、docs/tools/eval.md）、DSH: https://github.com/deepseek-ai/deepseek-harness （docs/subsystems/workflow.md）
