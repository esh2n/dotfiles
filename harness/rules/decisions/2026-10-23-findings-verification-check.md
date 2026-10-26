# reviewerが指摘を報告したら、jigは返答を終える前に検証役が走ったかだけを確かめる

Status: accepted — 持ち主の裁定（2026-10-23）。Claude Codeのhookの数は2026-10-23-claude-hooks-six-events.mdが決める。2026-10-19-review-redesign.mdのDecisionはそのまま（手順はskillとagentが持つ）

rule: A skill whose findings must be verified by a subagent declares it in its frontmatter's `metadata`: `findings-reporters` (the subagent types that report findings) and `findings-verifier` (the subagent type that must check them); each reporter ends its report with one `Findings: <n>` line. jig records, from the harness's own events, which skills a session used and which subagents finished in it with their `Findings` line, and its end-of-turn gate stops the turn when, since the skill's last use, a reporter reported one or more findings and no verifier has finished or is running — at most twice per use, then it tells the owner the skill ended without verification. A reporter whose report has no `Findings` line makes the check "not run", told to the owner, never a pass. The gate knows nothing else about the procedure: no step order, no state, no command the model calls.

## Problem

2026-10-22に、`change-review`を実行したセッションが、reviewerの指摘があるのにreview-verifierを一度も起動しないまま、全部の手順を終えたように報告した。手順を実行したかどうかは、モデル自身の報告でしか分からない。測定では、エージェントの最終報告は実行の証拠にならない（OverclaimBench、不完全な実行の80.4% が不完全さを隠した）。

skillごとに「必ず起動するsubagent」を固定の一覧で書く形は採れない。`change-review`では、指摘が0件ならreview-verifierは起動しないのが正しく（1件ごとに1つ起動するため）、設計のレビューとコード全体のセキュリティ監査ではcode-reviewerもreview-verifierも起動しない（別の手順に従うため）。固定の一覧では、この正しいレビューを毎回止めてしまう。

## Decision

1. 指摘を検証役に確かめさせるskillは、frontmatterの`metadata:`の下に2つを書く。`metadata`はAgent Skillsの仕様にある任意の欄で、houseのskillはすでに`namespaces`をここに書いている。
   - `findings-reporters`: 指摘を報告するsubagentの種類の一覧。
   - `findings-verifier`: 指摘を確かめるsubagentの種類。
   最初は`change-review`に、7つのreviewerと`review-verifier`を書く。
2. `findings-reporters`に挙げたagentは、報告の最後に`Findings: <件数>`の1行を書く。agentの定義の出力の決まりに足す。
3. jigは、ハーネスの出来事から次の2つだけを記録する。記録の鍵は、出来事に入っている`session_id`で、作業ディレクトリから推測しない。
   - セッションが使ったskill。Claude Codeでは、`Skill`ツールの呼び出しが終わったとき（PostToolUseの`tool_input.skill`）と、利用者が打った`/名前`（UserPromptSubmitの`prompt`）。
   - 終わったsubagentの種類と、その報告の`Findings`の行。Claude Codeでは、報告が`SubagentHandback`で渡されるとき（auto mode）はPostToolUseの`tool_input.message`と`agent_type`から、そうでないときはSubagentStopの`last_assistant_message`と`agent_type`から読む。
4. 返答を終える前の関門（Claude CodeのStop）は、そのskillを最後に使ったあとに終わったreporterの件数を足す。1件以上で、そのあとにverifierが1つも終わっておらず、Stopの入力の`background_tasks`にも動いているverifierが無ければ、件数を書いて返答を止める。
5. 止めるのは、skillを1回使うごとに2回までにする。上限に達したら止めずに、検証されないまま終わったことを持ち主に見える形（Claude Codeの`systemMessage`）で一度だけ知らせる。
6. 終わったreporterの報告に`Findings`の行が無いときや、記録が読めないときは、止めずに「確認できなかった」と一度だけ知らせ、合格とは扱わない。
7. 記録は`~/.local/state/jig/skill-runs/`の下に日ごとのファイルで置き、14日より古いファイルは消す。
8. jigが確かめるのは「指摘があったら検証役が1つは走ったか」だけで、手順の順番も状態も持たず、モデルがjigを呼ぶコマンドも作らない。検証役の数が指摘の数に足りているかは確かめない（reviewerをまたいで重なる指摘はまとめてから検証するので、数は一致しない）。

## Alternatives considered

- **skillごとに必ず起動するsubagentを固定の一覧で書く（最初の案）**: 上のProblemのとおり、指摘0件のレビューと、設計のレビュー、監査を止めてしまう。却下。
- **code-reviewerだけを必須にする**: 2026-10-22の飛ばし（指摘があるのに検証しない）を捕まえられず、設計のレビューと監査も止めてしまう。却下。
- **jigにレビュー専用のコマンドを持たせ、モデルに節目ごとに呼ばせる（`jig review start`など）**: jigがレビューの段取りと状態を持つことになり、workflowと同じ形になる。複数のハーネスに設定を配る道具（rulesync、ruler、superpowersなど）はどれも宣言だけで、実行の仕組みを持たない（`rules/research/2026-10-23-review-orchestrated-or-agent-driven.md`）。却下。
- **Workflowのスクリプトで手順を固める**: Claude Codeでしか動かず、レビューで1回46個のsubagent、約300万トークンを使った報告がある（claude-code issue #66023）。却下。
- **報告のRan欄を強めるだけ**: 書くのはモデルのままで、飛ばしを止められない。却下（併用はする）。
- **AgentツールのPostToolUseで起動を数える**: 背景で起動しただけのsubagentを数えてしまう（実機で、AgentのPostToolUseは`status: async_launched`の時点で返った）。却下。
- **skillの使用をguardのPreToolUseで記録する**: guardは判断に失敗すると確認を求める側に倒すhookで、記録の仕事を混ぜたくない。PreToolUseでは拒否された呼び出しまで「使った」と数える。PostToolUseにした。

## Consequences

- 捕まえられないことが残る。code-reviewer自体を起動しなかった場合は、指摘の行が1つも無いので止めない。件数を書くのもreviewerというモデルで、手順を飛ばす側とは別のcontextだが、件数そのものの正しさは確かめない。heavyのときの2回目のレビューが走ったかも確かめない。
- Claude CodeのhookはSubagentStopを足して6種類になり、PostToolUseのmatcherに`Skill`と`SubagentHandback`が加わる（2026-10-23-claude-hooks-six-events.md）。
- ompは、skillを`read`ツールで`skill://<名前>`として読み、subagentは`task`ツールの`agent`欄で起動する。終わったsubagentはextensionの出来事の通り道`task:subagent:lifecycle`に流れる。jigのextensionがこれと報告の本文を受け取れるかを実機で確かめてから、adapterに同じ記録と確認を足す。DSHは、手元にソースが無いので、パッケージを読んでから決める。piは、返答を終える前の出来事が無いので対象外にする。Codexは、文書にあるStopとSubagentStopを実機で確かめてから足す。
- 前例: hookで型検査やlintを確かめる例は多い（Boris Cherny、Addy Osmani、Hamel Husainなど）。指摘の検証が走ったかを確かめる公開の例は見つからなかった。

## Sources

- 実機の確認（2026-10-23、Claude Code 2.1.309）:
  - PostToolUseの`Skill`に`tool_input.skill`と`session_id`が入る。
  - auto modeでは、subagentの報告が`SubagentHandback`の`tool_input.message`で渡り、そのPostToolUseに親の`session_id`、`agent_id`、`agent_type`が入る。
  - SubagentStopに親の`session_id`、`agent_id`、`agent_type`が入る。
  - Stopの入力の`background_tasks`に動いているsubagentが載る。
- Stop、SubagentStop、`SubagentHandback`、`systemMessage`: https://code.claude.com/docs/en/hooks
- Agent Skillsのfrontmatter（`metadata`）: https://agentskills.io/specification
- omp 18.12.2のソース（`task/types.ts`、`extensibility/extensions/types.ts`、`session/agent-session.ts`、`prompts/system/system-prompt.md`）と、18.0.4の実行ファイルの中身
- `rules/research/2026-10-22-making-agents-finish-procedures.md`、`rules/research/2026-10-23-harness-neutral-procedure-checks.md`、`rules/research/2026-10-23-review-orchestrated-or-agent-driven.md`
- 毎回守らせる規則はhookに移す: https://code.claude.com/docs/en/skills
