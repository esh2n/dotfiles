# 委譲はサブエージェントとワークフローを規模で使い分け、スクリプトは一本、実行系は各ハーネス、実行の分担は決定的な仕事に限る

Status: accepted — ベンダーは制御をコードに置き規模で使い分け、読む並列と決定的な実行の分担には効いた測定があり、書く並列だけが負けている（2026-09-22）。`2026-09-22-workflow-research-only.md`の「ハーネス横断は考えない」を上書きする。Swarmの拡張を例外にした`2026-09-27-swarm-extension.md`は`2026-10-19-swarm-on-native-subagents.md`に置き換えられたので、例外はもう無い。reviewとdesign-reviewをスクリプトとして残す部分はsuperseded by `2026-10-19-review-redesign.md`（レビューはreview skillとレビュアーのエージェントに移した）。code-studyとstocktakeのスクリプトは632d2093でskillに移し、残るワークフローは`harness/workflows/implement.js`と`research.js`だけ。Consequencesの「pi拡張はtintinweb一択」はsuperseded by `2026-10-19-swarm-on-native-subagents.md`（nicobailon/pi-subagentsに替える）、「部下のモデル階層はtiers.jsonが唯一の元」はsuperseded by `2026-10-19-model-assignment.md`（部下のモデルは`harness/agents/models.json`がtierから引く）

rule: Choose a single subagent for one or two delegations, a workflow script for a fixed multi-step procedure; either way, only delegate read-and-report work or deterministic execution (tests, lint, build, schema checks) — never implementation needing shared design judgment or concurrent writes to one file. Write workflow scripts once in Claude Code's syntax; jig itself has no execution engine.

## Problem

複数のエージェントに仕事を分けるとき、モデルがターンごとに部下を立てる形（サブエージェント）と、先に書いたスクリプトが何を何本立てるかを決める形（ワークフロー）のどちらを使うか。五つのハーネス（Claude Code、Codex、pi、DSH、omp）で同じ手順を持てるか。高いモデルが設計し、安いモデルが実行する分担をどこまで認めるか。jigが実行系を持つか。

## Decision

二つの軸は独立している。

1. **形の選び方（軸1）は本数と手順の決まり具合。** 一つ二つの委譲（調べてきて、これを見て）はサブエージェント。決まった多本数の手順（レビューの三レーン、調査の四方向、棚卸し、設計批評）はワークフロー。ompでは前者が`orchestrate`、後者が`workflowz`。
2. **委譲してよい仕事（軸2）は、形に関係なく同じ。** 読んで返す仕事（review、research、code-study、stocktake、design-review）と、正誤が決定的な検査（テスト、lint、build、スキーマ）で決まる実行。この二つはサブエージェントでもワークフローでも委譲でき、安いモデルの部下に渡してもよい。実行を並列にするときは各レーンの書き先を隔離する（worktreeか重ならないファイル集合）。同じファイルを複数の部下が同時に書く形、途中で設計判断を共有し続ける必要がある実装は、どちらの形でもしない。
3. **スクリプトはClaude Codeのdynamic workflowの書式で一本**（`agent()`/`parallel()`/`pipeline()`/`phase()`、`meta`ブロック）。走らせるのは各ハーネスの実行系。Claude Codeは本体、DSHは本体（語彙を合わせたと文書に明記）、piは拡張、ompは`workflowz`/eval kernel、CodexはAGENTS.mdの指示で同じ手順を委譲させる。**一本で本当に五つで動くかは実機で確かめる。動かないハーネスには薄い変換を作る**（Codexとompが候補）。
4. **jigは実行系を持たない。** 持つのはスクリプト、pi用に選ぶ拡張の配線、部下のモデル階層を`tiers.json`から各ハーネスの書式（`model`/`tier`）へ翻訳する部分。headless（`claude -p`、`codex exec`）でjigがプロセスを立てる形は取らない。
5. **モデル階層。** 司令塔（設計と判断）は高い層、部下の既定は安い層。軸2に当てはまる仕事（読む、決定的に検査できる実行）は形を問わず安い層に渡してよい。piは0.87の`ContextEditEntry`で同一セッション内の切替も併用する。

## Alternatives considered

- **サブエージェントだけ（モデルに制御も任せる）**: OpenAIのhandoffs、Anthropicのagent teams（experimental、既定off、「approximately 7x」）、Cursorのcoordinatorがこの形だが、各社とも実験扱いか「手前の軽い方を先に」と注記。ベンダーの制御の置き方は揃ってコード側: OpenAI「orchestrating via code makes tasks more deterministic and predictable」、Google ADK「deterministic and predictable」、Microsoft「関数 → エージェント → workflowの順」、Cognition「deterministicなPythonスクリプト」、Claude Code「Reach for a workflow when a task needs more agents than one conversation can coordinate, or when you want the orchestration codified as a script you can read and rerun」、DSH「for one or two delegations, prefer plain subagent calls」。却下。
- **ワークフローだけ**: 一つ二つの委譲にスクリプトを書くのは過剰で、DSHとClaude Codeの文書が明示的に「少数はサブエージェント」と言う。却下。
- **実行の分担を「読んで返す」に限る**: 当初の私の案。安いモデルの部下に実行を渡して負けた記録（Cognition「SWE 1.5は主モデルとして力不足」、Amp「rush modeは複雑な仕事で結局安くならない」、Ronacher「安いモデルはループの中では安くない」）を重く見すぎた。効いた記録もある: Anthropicのresearch system（Opus司令塔 + Sonnet部下、+90.2%）、AmpのLibrarian（3倍速く43% 安く品質同じ）、TRAEの並列パッチ + 回帰テストの選別（70.6 → 78.8%）。負けた例は「正誤を決定的に判定できない仕事」で、勝った例は「読む」か「テストで決まる」仕事。線は「読むだけ」でなく「決定的に検査できる」に引く。却下。
- **jigがheadlessをN本起動する実行系を持つ**: 五つ全部にheadlessはあるが、`claude -p`はManualモード始まりで権限の旗が要り、`--bare`はAPIキー、セッション内の拡張（piのガード・関門）は動かない。paradigm調査の結論「自前のCLIラッパーはprompt-cacheの共有・usage-limitを見た一時停止・権限モードに沿った承認・進捗UIを再現できない」。ユーザーの嫌う点（エラー処理が複雑、実行が見えない）と同じ。この形の公開実装は全部0〜40星で定番なし。却下。
- **レビューだけClaude Codeから回す**: 五つを対等に扱う前提を壊す。piに部下の機構が無いという前提も誤りだった（nicobailon/pi-subagents 3,737星、tintinweb/pi-subagents 1,206星「Claude CodeのWorkflow tool用のスクリプトがそのまま動く」、QuintinShaw/pi-dynamic-workflows 535星）。却下。

## Consequences

- yoki-graph（自前の実行系）とpreflight.jsは捨てる。review・research・code-study・stocktake・design-reviewはスクリプトとして残し、各ハーネスで走らせる。
- 実機検証（同日）: **piはtintinweb/pi-subagents 0.19.0で同じスクリプトがほぼ無変更で動く**（3レーン並列・freshを子セッションのJSONLで確認。要調整は`meta.phases`の要素が`{title}`オブジェクトであること、`model`名はtiers.jsonからの翻訳が要ること。headlessで回すならpty必須）。**ompは10行のシムで動く**（`export`不可、`args`なし、`agent()`にper-callの`model`が無く親のモデルで走る → 決定5の「部下は安い層」はompではagent frontmatterか`task.agentModelOverrides`側で行う。`Date.now()`がthrowしないのでreplayの同一性は保証されない）。**Codexは不可**（スクリプトの実行系が無く、部下は親スレッドのforkで親の会話を継承することを子のrolloutで確認。変換では埋まらない）。DSHは未導入で未検証。
- 訂正: pi拡張の選択はtintinweb一択（CCスクリプトのランナーとして「無変更で走る」と主張し実測で裏付いた唯一）。`tier`はtintinwebに無く`model`のみ。Claude Code側で`meta.phases`の要素型を一度確かめる。
- 測定が無いもの: N人のレビュアー対1人（独立セッションが同一セッション派生に勝つ測定はある: F1 28.6% 対23.8%）。費用は読む並列で1.6〜3.9倍、上限は必須（Claude Codeは16並列・1,000/run、ompは32、Codexは4）。
- 部下のモデル階層はjigのtiers.jsonが唯一の元。ハーネスごとの書式（Claude Code `model`、pi拡張（tintinweb）`model`、ompはagent frontmatter / `task.agentModelOverrides`）へ翻訳する。

## Sources

- Claude Code: https://code.claude.com/docs/en/workflows.md 、https://code.claude.com/docs/en/sub-agents.md 、https://code.claude.com/docs/en/best-practices.md 、費用（agent teams約7倍）: https://code.claude.com/docs/en/costs.md
- OpenAI handoffs（コード制御の主張の出典）: https://openai.github.io/openai-agents-python/multi_agent/
- Google ADK（deterministic and predictableの出典）: https://adk.dev/agents/
- Microsoft Agent Framework（「関数で書けるなら関数を」の出典）: https://learn.microsoft.com/en-us/agent-framework/overview/agent-framework-overview
- Anthropic research system: https://www.anthropic.com/engineering/built-multi-agent-research-system 、OpenAI Codex subagents: https://learn.chatgpt.com/docs/agent-configuration/subagents
- Cognition: https://cognition.ai/blog/multi-agents-working 、Amp: https://ampcode.com/news/a-faster-librarian 、https://ampcode.com/news/rush-mode
- Ronacher「安いモデルはループの中では安くない」: https://lucumr.pocoo.org/2025/11/21/agents-are-hard/ 、Zechner「black box within a black box」: https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
- TRAEのSWE-bench Verified 70.6→78.8% のリーダーボード: https://github.com/SWE-bench/swe-bench.github.io
- headless実行系の公開実装が0〜40星で定番が無いことの例: https://github.com/kelvinschen/acpus 、https://github.com/JANG-MINWOO/agent-review-gate
- レビュー系スクリプトを残す判断の裏付け（Claude CodeのPRレビュー実装）: https://code.claude.com/docs/en/code-review.md
- 統制比較: https://arxiv.org/html/2512.08296 、独立セッションのレビュー: https://arxiv.org/abs/2603.12123
- pi拡張: https://github.com/nicobailon/pi-subagents 、https://github.com/tintinweb/pi-subagents 、https://github.com/QuintinShaw/pi-dynamic-workflows
- omp: https://github.com/can1357/oh-my-pi （docs/magic-keywords.md、docs/tools/eval.md）、DSH: https://github.com/deepseek-ai/deepseek-harness （docs/subsystems/workflow.md）
