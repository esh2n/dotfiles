# 親モデルは背景ワーカーの完了をどう待つのが業界の慣行か

## 結論

4つの独立した実装（Claude Code、omp/oh-my-pi、pi の durable ランタイム、Codex）で一致する形が観測できた。

1. **既定の配送は「完了をパース済みメッセージとして親の会話に注入し、次のターンを起こす」形。** モデルは何もしない——ツール呼び出しを終えて（＝ターンを終えて）待てば、完了時に新しいメッセージとして再起動される。Claude Code の「completion notification in a later turn」、omp の「async-result injection into the parent conversation」、Codex の `<subagent_notification>` role="user" メッセージ、pi durable の `whenBusy: "followUp"` はすべてこの形。
2. **モデルに本当に他へ回す作業が無い場合のためだけに、専用のブロッキング `wait` / `wait_agent` ツールを用意し、その説明文に明示的な禁止文言を書く実装が複数ある**（omp の `wait`、Codex の `wait_agent`）。文言はどちらも「結果は自動配送される、ポーリングするな」を明言する。
3. **Bash 内で `sleep` を挟んだポーリングループは、ベンダー・OSS の双方で繰り返し観測される不具合パターン**であり、対策はツール説明文の強化・専用 wait ツールの追加・ランタイム側でのポーリング検知とガイダンス注入の三種類に収斂している。どれも完全な解決には至っていない——Claude Code 自身の Monitor 機構にも未解決の既知バグがある。

現状の jig Swarm ツール（`start` / `status` / `results` / `cancel` のみ、`wait` action が無い）は上記 (1) の型には対応しているが (2) を欠く。「同じターンで結果を返したい」と判断したモデルが、正規のブロッキング手段を持たないために `sleep` に頼った、という観察はこの欠落と整合する。

## 根拠

### レンズ1: ベンダー

**Claude Code**（`code.claude.com`、要約フェッチ経由 — 元 URL はリダイレクトされた）
- 「A background subagent's results reach Claude as a completion notification in a later turn. Claude waits for that notification before reporting the subagent's results, and if you ask about progress first, it reports that the subagent is still running.」（`/docs/en/sub-agents`）
- 「While agent view is open, Claude Code also sends a notification through your configured terminal notification channel when a local background session starts needing your input, finishes, or fails.」（`/docs/en/agent-view`）
- ドキュメント上に「待つための」専用ツールの記述は無い（要約フェッチの評価）。

**このセッション自身の Bash ツール説明文**（直接観測、要約でない一次資料 — Claude Agent SDK が本セッションに渡した文字列そのもの）
- 「Use the Monitor tool to stream events from a background process (each stdout line is a notification). For one-shot "wait until done," use Bash with run_in_background instead.」
- 「If waiting for a background task you started with `run_in_background`, you will be notified when it completes — do not poll.」
- 「Do not retry failing commands in a sleep loop — diagnose the root cause.」

**omp (can1357/oh-my-pi)** — ソースをリポジトリから直接取得（`gh api`）
- `docs/tools/wait.md`: 「Results and peer messages also auto-deliver without calling `wait`. Continue useful work instead of polling.」「A single 30-minute safety cap returns a still-running snapshot; there is no polling ladder or per-call timeout.」
- `packages/coding-agent/src/prompts/tools/task-async-contract.md`: 「Results auto-deliver; NEVER poll.{{#if waitTool}} Completely blocked? Call `wait` to receive the first settled job{{#if ircEnabled}} or peer message{{/if}}.{{/if}}」
- `packages/coding-agent/src/prompts/tools/wait.md`: 「Wait only when blocked with nothing else to do. ... Results and messages auto-deliver. NEVER poll while work remains.」
- `docs/tools/task.md`: 「Live progress keeps streaming into the same tool block via `onUpdate(...)`; each final result arrives later as an async-result injection into the parent conversation.」
- `packages/coding-agent/src/prompts/system/eager-task.md`: 独立した作業単位は並列 `task` 呼び出しに fan-out させ、自分で実装しないことを明示（ポーリングの話とは別軸だが、「ターンを終えて委譲する」設計思想の裏付け）。

**Codex (openai/codex)** — ソースを直接取得
- `codex-rs/prompts/src/multi_agent_instructions.rs`: `const DEFAULT_MULTI_AGENT_V2_WAIT_AGENT_USAGE_HINT_TEXT: &str = "When calling `wait_agent`, prefer longer waits (minutes) to avoid busy polling.";`
- `codex-rs/core/src/context/subagent_notification.rs`: 完了は `content_kind = "multi_agent.subagent_notification"`、`role() -> "user"`、タグ `<subagent_notification>...</subagent_notification>` を持つ合成メッセージとしてコンテキストへ注入される実装（＝新規ターンを起こす形の完了通知）。

**pi (earendil-works/pi)** — durable パッケージの公開サンプル（`packages/durable/test/examples/23-subagent-background.ts`）
- コメント: 「Subagents keep working while the main agent answers the user, and each answer is delivered back to the main agent as a new message once it arrives.」
- 実装: `whenBusy: followUp ? "followUp" : "steer"` — 「Post the report as a follow-up input: it starts a turn when the main agent is idle, or waits for its current answer.」
- 注意: pi 本体には built-in の `task` / `wait` ツールが無いことを確認済み（`gh api repos/earendil-works/pi/contents/packages/coding-agent/src/tools/wait.ts` → 404、`repos/earendil-works/pi/git/trees/main` に `packages/coding-agent/src/tools/`・`src/task/` が存在しない）。上記は下位ランタイムの実証コードであり、pi 本体の製品機能ではない。

**Roo Code**（`roocodeinc.github.io/Roo-Code`、要約フェッチ経由）
- Boomerang Tasks はモデルを待たせず、ハーネス自体が親プロセスを一時停止する設計: 「The parent task (in Orchestrator mode) pauses, and the new subtask begins in a different, specialized mode.」「The parent task resumes with only the summary of the subtask.」— ポーリングという選択肢自体が生じない、別解。

**Cursor / Amp**: 公式ドキュメントに配送機構（ブロッキング/ポーリング/通知）の技術的記述が見当たらなかった（到達はできたが情報が無い、not documented であり not reachable ではない）。

### レンズ2: 実践者

Simon Willison (simonwillison.net)、Geoffrey Huntley (ghuntley.com)、Thorsten Ball (registerspill.thorstenball.com)、Armin Ronacher (lucumr.pocoo.org) の各サイトを確認したが、「sleep でポーリングするか、ターンを終えて委譲するか」という具体的な設計判断を論じた投稿は見つからなかった。Simon Willison の "Judgement"（2026-07-03）はサブエージェント委譲の運用ルール（モデルの階層をどう割り当てるか）を記録しているが、非同期の待ち方には触れていない。

このレンズは薄い。WebSearch の予算が本セッション開始前に使い切られていたため、到達できたのは WebFetch で URL を直接指定できたサイトのみに限られる。named practitioner の一次資料で本問いに直接答えるものは見つからなかった。

### レンズ3: 測定・インシデント（issue trackerは否定寄りに偏ることに注意）

- **Claude Code #95202**「Subagents keep polling long jobs with shell sleep loops instead of using run_in_background/Monitor notifications」（closed 2026-09-17）。本文: 「Subagents launched via the `Agent` tool repeatedly fall back to waiting for long-running shell jobs by polling ... even when the prompt explicitly forbids it and spells out the alternative.」4体の Opus サブエージェントで実測、明示的な禁止指示があっても sleep+tail/grep/pgrep ループに頼った実例を4回報告し「Stronger prompt wording reduces the frequency but has not eliminated it.」と結論。クローズ理由は「Filed in error by an automated session; closing.」——このコメントは issue 起票の手続き上の誤りを指すのみで、報告された不具合自体が解決済みという確認ではない。
- **Claude Code #97696**「Background subagent reports "completed" with a live Monitor; the Monitor's event never resumes it」（open, 2026-09-27、2.1.283 で再現、#86085 の再提出）。ツール結果の実文言を引用: 「Monitor started (task …, expires in 10m …). You will be notified on each event. Keep working — do not poll or sleep.」——この約束通りに動かず、Monitor のイベントがサブエージェントを再開させない実例を報告。「The harness's own guidance ("do not poll or sleep", use Monitor) leads straight into this path for any long external wait.」
- **omp #7227**「High CPU while `hub wait`-ing on a background job」。実測: アイドル時 CPU 1–3%、バックグラウンドジョブ実行中で wait 無し 1%、`hub wait` 中（shimmer 無効）12–14%、`hub wait` 中（shimmer 有効・既定）**30–40%**。専用 wait ツールにも実装・レンダリングコストがあることを示す数値。
- **omp #6602**「feat(hub): make bare wait event-driven by default」。既存の `wait` ツールにも内部タイムアウト（`async.pollWaitDuration` の既定 `smart` ラダー: 5s → 10s → 30s → 1m → 5m）があり、タイムアウトのみで戻ると「イベント駆動の待機がモデル駆動のポーリングに変わる」（"turning an event-driven wait into model-driven polling"）と明記。`indefinite` を既定にする提案（open）。
- **Cline PR #11521**「fix(sdk): guide repeated run_commands polling loops」（state: CLOSED、`mergedAt: null` — マージされず終了、クローズ理由の記載なし）。3回目の類似ポーリング検出後に挿入される文言を実装: 「You have repeated {label} {count} times without a file edit. Do not keep polling in short loops; use one longer wait/read if needed, inspect the saved log/output directly, or proceed/submit if there is enough evidence.」`sleep` のみのコマンドや `tail -N` / `wc -l` / `ps` / `pgrep` の反復を正規化して検出する実装だった。採用の可否（他ブランチでの再実装含む）は確認できなかった。
- **pi-agent-teams #50**「Leader polling timers touch the invalidated ctx after session replacement and kill the Pi process」（open）。1秒間隔のリフレッシュタイマーがセッション置換後も生存し、`assertActive()` が投げた例外が `unhandledRejection` ハンドラ不在のため `uncaughtException` として Pi プロセス全体を終了させる。拡張自身が実装した定期ポーリングが実害（プロセスクラッシュ）を出した例。

### レンズ4: 実態（公開リポジトリ、`gh api` で直接取得した数値）

| リポジトリ | ★ | 直近 push | 備考 |
|---|---|---|---|
| can1357/oh-my-pi | 33,840 | 2026-09-30（当日） | `wait` ツール・`task-async-contract.md` あり |
| earendil-works/pi | 110,634 | 2026-09-30（当日） | built-in `task`/`wait` ツールなし（404 確認済み） |
| openai/codex | 127,355 | 2026-09-30（当日） | `wait_agent`・`subagent_notification.rs` あり、open issues 19,741 |
| cline/cline | 69,597 | 2026-09-30（当日） | polling ガードは PR 段階（未マージ）、open issues 1,519 |
| RooCodeInc/Roo-Code | 24,290 | — | Boomerang Tasks は親プロセスを一時停止する設計 |
| sst/opencode | 211,057 | 2026-09-30（当日） | サブエージェントの配送方式はドキュメント上未確定 |
| tmustier/pi-agent-teams | 109 | 2026-06-20 | 約3ヶ月停滞、open issues 18、決定記録の既存所見と一致 |

## 分からないこと

- Kimi Code (MoonshotAI/kimi-code) の CLI 内部の wait/deliver 機構は未確認。公式ブログ（`kimi.ai/blog/agent-swarm`）は「Deploy up to 100 sub-agents working in parallel」「4.5x faster than sequential execution」という数字のみを出し、配送機構（ブロッキング/ポーリング/通知のいずれか）は開示していない。
- OpenCode (sst/opencode) の親子セッション間の正確な配送方式（ブロッキングか非同期か）はドキュメントから確定できなかった。
- Cursor Background Agents / Cloud Agents、Amp (Sourcegraph) の Agent-to-Agent の技術的な配送機構は非公開ドキュメントの範囲では確認できなかった。
- Cline PR #11521 がなぜクローズされ、マージされなかったかの理由は記録が見当たらず不明。
- 対象セッションの推論テキストにあった「NEVER yield before complete deliverable」という文言の出所は、収集した4ベンダーのツール説明文のいずれとも一致しない。モデル自身が生成した理由付けである可能性が高い `[unverified]`。
- 実践者個人ブログでこの具体的な設計判断（sleep か、ターンを終えるか、専用 wait ツールか）を論じた一次資料は見つからなかった。WebSearch の予算が本セッション開始前に枯渇していたため、到達できたのは URL を直接指定できた範囲（WebFetch・`gh api`／`gh search`）に限られる。

## Sources

- Claude Code — sub-agents: https://code.claude.com/docs/en/sub-agents （要約フェッチ経由、元 URL `docs.claude.com/en/docs/claude-code/sdk/sdk-agents` からリダイレクト）
- Claude Code — background agents / agent view: https://code.claude.com/docs/en/agent-view （要約フェッチ経由）
- Claude Code — common workflows: https://code.claude.com/docs/en/common-workflows （直接フェッチ）
- Claude Code issue #95202: https://github.com/anthropics/claude-code/issues/95202
- Claude Code issue #97696: https://github.com/anthropics/claude-code/issues/97696
- omp docs/tools/wait.md: https://github.com/can1357/oh-my-pi/blob/main/docs/tools/wait.md
- omp docs/tools/task.md: https://github.com/can1357/oh-my-pi/blob/main/docs/tools/task.md
- omp packages/coding-agent/src/prompts/tools/task-async-contract.md: https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/prompts/tools/task-async-contract.md
- omp packages/coding-agent/src/prompts/tools/wait.md: https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/prompts/tools/wait.md
- omp packages/coding-agent/src/prompts/system/eager-task.md: https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/prompts/system/eager-task.md
- omp issue #7227: https://github.com/can1357/oh-my-pi/issues/7227
- omp issue #6602: https://github.com/can1357/oh-my-pi/issues/6602
- Codex codex-rs/prompts/src/multi_agent_instructions.rs: https://github.com/openai/codex/blob/main/codex-rs/prompts/src/multi_agent_instructions.rs
- Codex codex-rs/core/src/context/subagent_notification.rs: https://github.com/openai/codex/blob/main/codex-rs/core/src/context/subagent_notification.rs
- pi durable example 23-subagent-background.ts: https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/23-subagent-background.ts
- Roo Code — Boomerang Tasks: https://roocodeinc.github.io/Roo-Code/features/boomerang-tasks （要約フェッチ経由）
- Cursor — Background Agent: https://cursor.com/docs/background-agent （要約フェッチ経由、配送機構の記述なし）
- Amp — Agent to Agent: https://ampcode.com/docs/orbs/agent-to-agent （要約フェッチ経由、配送機構の記述なし）
- Cline PR #11521: https://github.com/cline/cline/pull/11521
- Cline definitions.ts（PR ブランチ、ポーリングガード実装）: https://raw.githubusercontent.com/cline/cline/robin/run-commands-polling-guidance/sdk/packages/core/src/extensions/tools/definitions.ts
- pi-agent-teams issue #50: https://github.com/tmustier/pi-agent-teams/issues/50
- Kimi — Agent Swarm blog: https://www.kimi.ai/blog/agent-swarm （要約フェッチ経由、配送機構の記述なし）
- OpenCode — Agents docs: https://opencode.ai/docs/agents/ （要約フェッチ経由）
- Simon Willison — Judgement (2026-07-03): https://simonwillison.net/ （タグページ経由の要約、subagent 委譲ルールの記録。本問いには非直接）
- 参照した文脈: `harness/jig/src/app/swarm/tool.ts`、`harness/rules/decisions/2026-09-27-swarm-extension.md`
