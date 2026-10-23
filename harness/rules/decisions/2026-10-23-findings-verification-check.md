# reviewer が指摘を報告したら、jig は返答を終える前に検証役が走ったかだけを確かめる

Status: accepted — 持ち主の裁定（2026-10-23）。Claude Code の hook の数は 2026-10-23-claude-hooks-six-events.md が決める。2026-10-19-review-redesign.md の Decision はそのまま（手順は skill と agent が持つ）

rule: A skill whose findings must be verified by a subagent declares it in its frontmatter's `metadata`: `findings-reporters` (the subagent types that report findings) and `findings-verifier` (the subagent type that must check them); each reporter ends its report with one `Findings: <n>` line. jig records, from the harness's own events, which skills a session used and which subagents finished in it with their `Findings` line, and its end-of-turn gate stops the turn when, since the skill's last use, a reporter reported one or more findings and no verifier has finished or is running — at most twice per use, then it tells the owner the skill ended without verification. A reporter whose report has no `Findings` line makes the check "not run", told to the owner, never a pass. The gate knows nothing else about the procedure: no step order, no state, no command the model calls.

## Problem

2026-10-22 に、`change-review` を実行したセッションが、reviewer の指摘があるのに review-verifier を一度も起動しないまま、全部の手順を終えたように報告した。手順を実行したかどうかは、モデル自身の報告でしか分からない。測定では、エージェントの最終報告は実行の証拠にならない（OverclaimBench、不完全な実行の 80.4% が不完全さを隠した）。

skill ごとに「必ず起動する subagent」を固定の一覧で書く形は採れない。`change-review` では、指摘が 0 件なら review-verifier は起動しないのが正しく（1 件ごとに 1 つ起動するため）、設計のレビューとコード全体のセキュリティ監査では code-reviewer も review-verifier も起動しない（別の手順に従うため）。固定の一覧では、この正しいレビューを毎回止めてしまう。

## Decision

1. 指摘を検証役に確かめさせる skill は、frontmatter の `metadata:` の下に 2 つを書く。`metadata` は Agent Skills の仕様にある任意の欄で、house の skill はすでに `namespaces` をここに書いている。
   - `findings-reporters`: 指摘を報告する subagent の種類の一覧。
   - `findings-verifier`: 指摘を確かめる subagent の種類。
   最初は `change-review` に、7 つの reviewer と `review-verifier` を書く。
2. `findings-reporters` に挙げた agent は、報告の最後に `Findings: <件数>` の 1 行を書く。agent の定義の出力の決まりに足す。
3. jig は、ハーネスの出来事から次の 2 つだけを記録する。記録の鍵は、出来事に入っている `session_id` で、作業ディレクトリから推測しない。
   - セッションが使った skill。Claude Code では、`Skill` ツールの呼び出しが終わったとき（PostToolUse の `tool_input.skill`）と、利用者が打った `/名前`（UserPromptSubmit の `prompt`）。
   - 終わった subagent の種類と、その報告の `Findings` の行。Claude Code では、報告が `SubagentHandback` で渡されるとき（auto mode）は PostToolUse の `tool_input.message` と `agent_type` から、そうでないときは SubagentStop の `last_assistant_message` と `agent_type` から読む。
4. 返答を終える前の関門（Claude Code の Stop）は、その skill を最後に使ったあとに終わった reporter の件数を足す。1 件以上で、そのあとに verifier が 1 つも終わっておらず、Stop の入力の `background_tasks` にも動いている verifier が無ければ、件数を書いて返答を止める。
5. 止めるのは、skill を 1 回使うごとに 2 回までにする。上限に達したら止めずに、検証されないまま終わったことを持ち主に見える形（Claude Code の `systemMessage`）で一度だけ知らせる。
6. 終わった reporter の報告に `Findings` の行が無いときや、記録が読めないときは、止めずに「確認できなかった」と一度だけ知らせ、合格とは扱わない。
7. 記録は `~/.local/state/jig/skill-runs/` の下に日ごとのファイルで置き、14 日より古いファイルは消す。
8. jig が確かめるのは「指摘があったら検証役が 1 つは走ったか」だけで、手順の順番も状態も持たず、モデルが jig を呼ぶコマンドも作らない。検証役の数が指摘の数に足りているかは確かめない（reviewer をまたいで重なる指摘はまとめてから検証するので、数は一致しない）。

## Alternatives considered

- **skill ごとに必ず起動する subagent を固定の一覧で書く（最初の案）**: 上の Problem のとおり、指摘 0 件のレビューと、設計のレビュー、監査を止めてしまう。却下。
- **code-reviewer だけを必須にする**: 2026-10-22 の飛ばし（指摘があるのに検証しない）を捕まえられず、設計のレビューと監査も止めてしまう。却下。
- **jig にレビュー専用のコマンドを持たせ、モデルに節目ごとに呼ばせる（`jig review start` など）**: jig がレビューの段取りと状態を持つことになり、workflow と同じ形になる。複数のハーネスに設定を配る道具（rulesync、ruler、superpowers など）はどれも宣言だけで、実行の仕組みを持たない（`rules/research/2026-10-23-review-orchestrated-or-agent-driven.md`）。却下。
- **Workflow のスクリプトで手順を固める**: Claude Code でしか動かず、レビューで 1 回 46 個の subagent、約 300 万トークンを使った報告がある（claude-code issue #66023）。却下。
- **報告の Ran 欄を強めるだけ**: 書くのはモデルのままで、飛ばしを止められない。却下（併用はする）。
- **Agent ツールの PostToolUse で起動を数える**: 背景で起動しただけの subagent を数えてしまう（実機で、Agent の PostToolUse は `status: async_launched` の時点で返った）。却下。
- **skill の使用を guard の PreToolUse で記録する**: guard は判断に失敗すると確認を求める側に倒す hook で、記録の仕事を混ぜたくない。PreToolUse では拒否された呼び出しまで「使った」と数える。PostToolUse にした。

## Consequences

- 捕まえられないことが残る。code-reviewer 自体を起動しなかった場合は、指摘の行が 1 つも無いので止めない。件数を書くのも reviewer というモデルで、手順を飛ばす側とは別の context だが、件数そのものの正しさは確かめない。heavy のときの 2 回目のレビューが走ったかも確かめない。
- Claude Code の hook は SubagentStop を足して 6 種類になり、PostToolUse の matcher に `Skill` と `SubagentHandback` が加わる（2026-10-23-claude-hooks-six-events.md）。
- omp は、skill を `read` ツールで `skill://<名前>` として読み、subagent は `task` ツールの `agent` 欄で起動する。終わった subagent は extension の出来事の通り道 `task:subagent:lifecycle` に流れる。jig の extension がこれと報告の本文を受け取れるかを実機で確かめてから、adapter に同じ記録と確認を足す。DSH は、手元にソースが無いので、パッケージを読んでから決める。pi は、返答を終える前の出来事が無いので対象外にする。Codex は、文書にある Stop と SubagentStop を実機で確かめてから足す。
- 前例: hook で型検査や lint を確かめる例は多い（Boris Cherny、Addy Osmani、Hamel Husain など）。指摘の検証が走ったかを確かめる公開の例は見つからなかった。

## Sources

- 実機の確認（2026-10-23、Claude Code 2.1.309）:
  - PostToolUse の `Skill` に `tool_input.skill` と `session_id` が入る。
  - auto mode では、subagent の報告が `SubagentHandback` の `tool_input.message` で渡り、その PostToolUse に親の `session_id`、`agent_id`、`agent_type` が入る。
  - SubagentStop に親の `session_id`、`agent_id`、`agent_type` が入る。
  - Stop の入力の `background_tasks` に動いている subagent が載る。
- Stop、SubagentStop、`SubagentHandback`、`systemMessage`: https://code.claude.com/docs/en/hooks
- Agent Skills の frontmatter（`metadata`）: https://agentskills.io/specification
- omp 18.12.2 のソース（`task/types.ts`、`extensibility/extensions/types.ts`、`session/agent-session.ts`、`prompts/system/system-prompt.md`）と、18.0.4 の実行ファイルの中身
- `rules/research/2026-10-22-making-agents-finish-procedures.md`、`rules/research/2026-10-23-harness-neutral-procedure-checks.md`、`rules/research/2026-10-23-review-orchestrated-or-agent-driven.md`
- 毎回守らせる規則は hook に移す: https://code.claude.com/docs/en/skills
