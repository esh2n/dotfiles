---
question: "一つのポリシーを Claude Code・Codex・omp・pi・DSH に効かせる PreToolUse 型のガードが、無人の実行のときだけ追加の規則（テストのパスへの書き込み禁止、認証情報とデプロイのコマンドの禁止）を効かせるには、いまの実行が無人だとどう知るか。各ハーネスはフックや拡張に何を渡すか。実践者と公開リポジトリはどうしているか。何が壊れたか"
date: 2026-10-21
verdict: "「無人」を一つの値で渡すハーネスは無い。渡すものはハーネスごとに違い、どれも一部しか分からない。Claude Code は文書に無い環境変数（`CLAUDE_CODE_SESSION_ATTENDED`、`CLAUDE_CODE_ENTRYPOINT`）と、文書に無い UserPromptSubmit の `source` でヘッドレスと /loop の起動を区別できるが、/goal が動いているかはフックに渡さない。`permission_mode` は使えない（端末の既定が `auto`、`claude -p` の既定が `default` で、向きが逆）。Codex は `permission_mode` を `default` か `bypassPermissions` の二値でしか渡さず、`codex exec` も対話の `--yolo` も同じ `bypassPermissions` になる。omp と pi は拡張に `ctx.mode`（tui / rpc / json / print）を渡し、omp は goal の状態も `goal_updated` で渡す。業界で受け入れられているのは、モード判定ではなく「どのモードでも効く deny の規則」と「無人の実行は隔離した環境で回す」の組み合わせで、Anthropic の文書・OpenAI の文書・Willison が一致する。モードで規則を切り替える公開例は小さなリポジトリにしか無く（★4）、モードで分岐する公開フックの多くは無人側で規則を緩める向きに使っている。「禁止ではなく確認（ask）」は Claude Code では人がいないと自動で拒否に変わるので無人向けの形として働くが、Codex の PreToolUse は ask を扱えず、そのまま実行させる（fail open）"
unverified:
  - "Claude Code の `CLAUDE_CODE_SESSION_ATTENDED` と UserPromptSubmit の `source` は、手元の 2.1.303 の実行ファイルの文字列から読んだ。公式文書には無い。実際に `claude -p` を走らせてフックが受け取る値を測ってはいない（公開リポジトリ 2 件が 2.1.280 と 2.1.287 で測った記述はある）"
  - "Claude Code で /goal が終わったことをフックが知る手段は見つからなかった（始まりは UserPromptSubmit に `/goal ...` の文字列として届く）"
  - "omp の /loop が動いていることを拡張に知らせるイベントは、`extensibility/extensions/types.ts` には見つからなかった"
  - "DSH は手元に入っておらず、一次文書にも届かなかった。ヘッドレスが別の profile（`dsh --profile headless`）であることは二次の記事の記述のみ"
  - "Codex の `/goal` を `codex exec` で使えるか、そのときフックに何が渡るかは確かめていない"
  - "Anthropic の auto mode の記事と Willison の二つの記事は要約付き取得で読んだ（原文の逐語確認ではない）"
  - "無人の間だけ規則を切り替えたときの誤判定・すり抜けの件数を測った記録は見つからなかった"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# 無人の実行をフックがどう見分けるか、各ハーネスが渡すものと業界の実践

調査日 2026-10-21。四つの視点（ベンダー、実践者、測定、公開リポジトリ）をすべて当てた。目標ループそのものの実践（上限、完了の判定、事故の型）は `2026-10-20-goal-loops-practice.md` で調べ済みなので繰り返さない。無人の間の制約を決めた経緯は `../decisions/2026-10-19-unattended-runs-native-goal-and-loop.md` にある。

## 方法と確認の凡例

- 【直接】ページ全文またはファイルを自分で開いた。引用は逐語。
- 【バイナリ】手元の Claude Code 2.1.303 の実行ファイル（minify された JavaScript を含む単一バイナリ）を `strings` で読んだ。行番号は取れないので「位置は特定できず」とする。文書にない挙動で、版が上がれば変わりうる。
- 【要約】WebFetch の要約器を通して取得した。引用符内は要約器が返した文字列で、原文との一致は未確認。
- 【検索】WebSearch の要約だけで、元ページを開いていない。結論には使わない。
- 【届かず】読めなかった。「見つからない」は「届かなかった」の意味で、存在しないことを意味しない。
- 手元の版: Claude Code 2.1.303、Codex 0.160.0、omp 18.0.4、pi 0.85.1。DSH は未導入。Codex は `rust-v0.160.0` タグ（a956835d）、omp は `v18.0.4` タグを浅く clone して `file:行` で示す。pi は手元に入っている npm パッケージの `dist/` を開いた。
- 公開リポジトリの数字は 2026-10-21 に `gh api` で取った値。コード検索の件数はフォークや流出したソースの写しを含むので桁の目安にしかならない。
- 各経路の偏り。ベンダー文書は肯定側に偏る。issue 追跡は否定側に偏る。一人のリポジトリは一つの例で、一つの反例で覆る。

## 結論（先に）

1. **「無人」を一つの値で渡すハーネスは無い。** 渡すものは五つでばらばらで、どれも一部しか分からない（下の表）。共通に使える信号は「画面の無いモードで起動したか」だけで、Claude Code は文書に無い環境変数、omp と pi は拡張の `ctx.mode`、Codex は `permission_mode` が `bypassPermissions` かどうか、で間接的に分かる。**対話セッションの中で /goal や /loop が回っている状態**を PreToolUse の時点で見分けられるのは、omp の goal（`goal_updated` イベント）と Claude Code の /loop（UserPromptSubmit の `source`、文書に無い）だけ。
2. **許可モードは無人の信号にならない。** Claude Code では端末の既定が `auto`、`claude -p` の既定が `default` で、無人のほうが「控えめな」値になる。Codex は承認方針が `never` なら `bypassPermissions`、それ以外はすべて `default` で、`codex exec` も対話の `--yolo` も区別できない。omp の承認モードの既定は `yolo` で、普段の対話そのもの。
3. **業界で受け入れられているのは、モード判定ではなく「常に効く deny」と「無人は隔離した環境で」の組み合わせ。** Anthropic は deny の規則が `bypassPermissions` を含むすべてのモードで効くと書き、完全な無人はコンテナや VM の中だけと書く。OpenAI はフックを「a useful guardrail, not a complete enforcement boundary」と書く。Willison は無人で回すならサンドボックスと、被害が限られる認証情報を渡すことを勧める。
4. **モードで規則を切り替える公開例は小さく、向きが逆のものが多い。** 起動時の環境変数（`CLAUDE_UNATTENDED=1`）で無人の間だけ規則を足す例は ★4 のリポジトリ一つ。`permission_mode == bypassPermissions` で分岐する公開フックの多くは、無人や YOLO のときに確認を**省く**向きに使う。テストのファイルを守る公開フックは、モードではなく「どのエージェントか」「TDD のどの段階か」で切り替え、常時有効。
5. **「禁止ではなく確認（ask）」は、ハーネスによって働き方が逆になる。** Claude Code では、フックの `ask` は auto や `bypassPermissions` でも確認を出させ、`claude -p` で答える人がいなければ拒否になる。人がいれば確認、いなければ拒否、という形が本体の挙動で手に入る。omp と pi も画面が無いと `confirm` が `false` を返す。ところが Codex の PreToolUse は `ask` を「未対応」として失敗扱いにし、**ツールの呼び出しをそのまま通す**。一つのポリシーを全ハーネスに配るなら、Codex では ask が素通りになる。さらに、対話セッションで /goal や /loop を回して席を外すと、ask は拒否にならずに確認待ちで止まる。

---

## 視点 1: ベンダーと手元のソースは何を渡しているか

### Claude Code 2.1.303

**フックの共通入力【直接】** https://code.claude.com/docs/en/hooks
- `permission_mode`: 「Current permission mode: `"default"`, `"plan"`, `"acceptEdits"`, `"auto"`, `"dontAsk"`, or `"bypassPermissions"`. ... Not all events receive this field.」
- SessionStart の `source`: 「`"startup"` for new sessions, `"resume"` for resumed sessions, `"clear"` after `/clear`, `"compact"` after compaction, or `"fork"`」。ヘッドレスかどうかは含まない。
- Stop の `session_crons`: 「Each entry in `session_crons` describes one session-scoped scheduled wakeup, sourced from `CronCreate`, `ScheduleWakeup`, and `/loop`」「let hooks distinguish "session is done" from "session is paused waiting for background work to wake it back up"」。Stop にしか無く、PreToolUse には無い。
- UserPromptSubmit は人が打った指示以外でも動く。「`UserPromptSubmit` hooks don't fire only on prompts you type. Claude Code also runs them on: A session-scoped scheduled task firing, including a `/loop` iteration」。ただし文書の入力例に、どちらから来たかを示す欄は無い。
- `/goal` は「a built-in shortcut for a session-scoped prompt-based Stop hook」。goal が動いているかを示す入力欄は文書に無い。
- フックのコマンドに渡す環境変数として文書にあるのは `CLAUDE_PROJECT_DIR`、`CLAUDE_PLUGIN_ROOT`、`CLAUDE_PLUGIN_DATA`、`CLAUDE_CODE_REMOTE`（「`"true"` in remote web environments」）、`CLAUDE_CODE_BRIDGE_SESSION_ID`、`CLAUDE_ENV_FILE`、`CLAUDE_EFFORT`。無人やヘッドレスを示すものは無い。

**許可モードの既定は無人のほうが控えめ【直接】** https://code.claude.com/docs/en/permission-modes
- 「Which mode a session starts in」の表: 「`claude -p` or the Agent SDK | `default`」「In a terminal or through the VS Code extension | `auto` with Claude Code v2.1.283 or later」。端末の対話が `auto`、ヘッドレスが `default` で、`permission_mode` を無人の信号にすると向きが逆になる。
- 「Deny rules block in every mode, including `bypassPermissions`.」
- `bypassPermissions` は「Isolated containers and VMs only」、「Only use this mode in isolated environments like containers, VMs, or dev containers without internet access」。完全な無人の行は「Run fully unattended inside a container | `claude -p "<prompt>" --dangerously-skip-permissions` | Required: a container, VM, or the sandbox runtime」。

**フックの ask は、人がいないと拒否になる【直接】**
- hooks 文書: 「A hook's `"ask"` also forces a permission prompt in auto mode: the classifier can still deny the tool call, but it can't approve the call silently.」「When Claude Code denies the call in a `-p` run where no one can answer that prompt, Claude reads the reason in the tool result instead.」
- headless 文書（https://code.claude.com/docs/en/headless 「Turn off permission prompts in unattended runs」）: 「Anything that would prompt is denied unless a `PermissionRequest` hook allows it ... In a `-p` run with no host, these requests are denied either way」。`--permission-prompts none` を付けると、確認を待つ相手（SDK の `canUseTool` など）がいても待たずに拒否する。
- goal 文書（https://code.claude.com/docs/en/goal）: 「A goal doesn't change your permission mode. To let goal turns run unattended, run `/goal` in auto mode. In Manual mode, Claude still asks before tool calls that your settings don't already allow」。つまり対話セッションの /goal で ask が出ると、拒否ではなく確認待ちで止まる。
- scheduled-tasks 文書（https://code.claude.com/docs/en/scheduled-tasks）の比較表: セッション内の予定タスクの「Permission prompts」は「Inherits from session」。

**文書に無いが、実行ファイルにある信号【バイナリ】（位置は特定できず）**
- 起動時に `CLAUDE_CODE_ENTRYPOINT` を決める関数: 画面が無い起動なら `sdk-cli`、あれば `cli`（`a.set("CLAUDE_CODE_ENTRYPOINT",e?"sdk-cli":"cli")`）。既に `cli` が入っていて画面が無い起動なら `sdk-cli` に書き換える。
- フックのコマンドと Bash ツールに渡す環境に `CLAUDE_CODE_SESSION_ATTENDED:e6()?"1":"0"` を入れる。`e6()` は `CLAUDE_CODE_SESSION_KIND` が `bg`・`daemon`・`daemon-worker` なら偽、対話なら真、画面が無ければ子セッションでなく VS Code・デスクトップ・リモートなど特定の入口のときだけ真。フックを起動するコードがこの関数の結果を環境に入れていること（`...k9e(y),CLAUDE_PROJECT_DIR:...`）を、フックのタイムアウト処理と同じ箇所で確かめた。
- UserPromptSubmit の入力の型に `source:U(["user","sdk","system","loop_wakeup","schedule_wakeup","poll_event"]).optional()` があり、説明は「`user` = submitted from the interactive composer, `sdk` = non-interactive entrypoint (`-p` / Agent SDK), `loop_wakeup` = dynamic /loop wakeup, `schedule_wakeup` = scheduled-task fire (CronCreate/routine), `system` = other machine-injected turns (peer/channel messages, task notifications, auto-continuation)」。公開文書の UserPromptSubmit の節にはこの欄が無い（`hooks.md` の生テキストを grep して確認）。
- goal の状態（`activeGoal`）は内部状態と分析イベント（`goal_active`）と SDK のストリームのメッセージ型（`active_goal`）にあり、フックの入力の型には見つからなかった。
- 手元の対話セッション（このサブエージェント）の Bash の環境では `CLAUDE_CODE_ENTRYPOINT=cli`、`CLAUDE_CODE_SESSION_ATTENDED=1` だった。`claude -p` 側の値は実行して測っていない。

### Codex 0.160.0

**フックの `permission_mode` は二値【直接】**
- `codex-rs/core/src/hook_runtime.rs:1032-1039`: `AskForApproval::Never => "bypassPermissions"`、`UnlessTrusted | OnRequest | Granular(_) => "default"`。文書は値を 5 つ挙げる（「`default`, `acceptEdits`, `plan`, `dontAsk`, or `bypassPermissions`」、【要約】 https://learn.chatgpt.com/docs/hooks ）が、0.160.0 のソースが出すのはこの二つだけ。
- `codex-rs/exec/src/lib.rs:574-576`: 「Default to never ask for approvals in headless mode.」`approval_policy: Some(AskForApproval::Never)`。よって `codex exec` のフックは `bypassPermissions` を受け取る。対話で承認方針を `never` にした場合（`--yolo` など）も同じ値で、区別できない。
- SessionStart の `source` は `startup / resume / clear / compact / fork`（`codex-rs/hooks/src/events/session_start.rs:24-41`）。ヘッドレスを示す値は無い。
- `codex-rs/hooks/src/schema.rs` に goal の欄は無い（`rg goal` で 0 件）。
- フックのコマンドは空の環境から始め、セッションの環境の写しを入れ直す（`codex-rs/hooks/src/engine/command_runner.rs:424-436` のコメント「Both launchers start with an empty environment. Replay the session snapshot」）。`codex exec` 専用の環境変数は見つからなかった。シェルツールに入る `CODEX_CI=1`（`codex-rs/core/src/unified_exec/process_manager.rs:103`）はモードに関係なく入る。

**PreToolUse の ask は素通り【直接】**
- `codex-rs/hooks/src/engine/output_parser.rs:458-459`: `Ask` は「PreToolUse hook returned unsupported permissionDecision:ask」。
- 同じ挙動のテストの名前が `unsupported_permission_decision_fails_open`（`codex-rs/hooks/src/events/pre_tool_use.rs:556`）で、期待値は `should_block: false`。
- 文書【要約】: ask などは「are parsed but not supported yet」、Codex は「marks the hook run as failed, reports the error, and continues the tool call」。さらに「Treat tool hooks as a useful guardrail, not a complete enforcement boundary.」

### omp 18.0.4

**拡張は実行モードと goal の状態を受け取る【直接】**（パスは `packages/coding-agent/src/` から）
- `extensibility/extensions/types.ts:453` `export type ExtensionMode = "tui" | "rpc" | "json" | "print";`、`:459` `mode: ExtensionMode;`。
- `hasUI` の注釈は「Whether UI is available (false in print/RPC mode)」（`types.ts:466`）だが、実装は「UI の文脈が何もしない既定のものでなければ真」（`extensibility/extensions/runner.ts:879-881`）で、RPC モードは `RpcExtensionUIContext` を渡し `setToolUIContext?.(rpcUiContext, true)` とする（`modes/rpc/rpc-mode.ts:956-957`）。**RPC では `hasUI` が真になり、注釈と食い違う。** 無人の判定には `ctx.mode` を使うほうが確か。
- 入力イベントの出どころ: `source: "interactive" | "rpc" | "extension"`（`types.ts:905`）。
- goal: `on(event: "goal_updated", ...)`（`types.ts:1283`）。本体は goal の変化を拡張に流す（`session/agent-session.ts:3752-3757`）。状態は `enabled`、`mode: "active" | "exiting"`、目標の `status` とトークンの使用量（`goals/state.ts:5-21`）。拡張が goal の開始と終了を自分で記録すれば、PreToolUse の時点で「goal 中か」を判定できる。
- goal の自動継続の既定は対話だけ（`config/settings-schema.ts:4778-4781`、`default: ["interactive"]`）。
- 承認モードの既定は `yolo`（`extensibility/extensions/wrapper.ts:191`、`settings?.get("tools.approvalMode") ?? "yolo"`）。値は `"always-ask" | "write" | "yolo"`（`tools/approval.ts:14`）。普段の対話が `yolo` なので無人の信号にならない。
- 画面の無い既定の UI では `confirm` が常に `false`（`extensibility/extensions/runner.ts:403`）。print では確認が拒否に変わる。RPC では確認の要求が RPC の相手に送られる（`modes/rpc/rpc-types.ts:386`）。
- /loop を拡張に知らせるイベントは `types.ts` に見つからなかった。

### pi 0.85.1

**実行モードは分かる、goal と承認は無い【直接】**（パスはパッケージの `dist/` から）
- `core/extensions/types.d.ts:208` `export type ExtensionMode = "tui" | "rpc" | "json" | "print";`、`:213` `mode`、`:215` 「Whether dialog-capable UI is available (true in TUI and RPC modes)」。pi の注釈は RPC で真と書き、omp の注釈と逆。
- 入力の出どころ `InputSource = "interactive" | "rpc" | "extension"`（`types.d.ts:655`）。
- 何もしない UI の `confirm: async () => false`（`core/extensions/runner.js:90`）。
- `types.d.ts` に goal、permission、approval の語は無い（grep で 0 件）。pi の本体に goal と承認の仕組みが無いことは `2026-10-20-pi-goal-options.md` で調べ済み。

### DSH

- 手元に無い。二次の記事【検索】 https://aicybr.com/blog/deepseek-harness-dsh-architecture-quick-start ほかによれば、ヘッドレスは別の profile（`dsh --profile headless`）で、Claude Code の `hooks.json` の一部を写すフックの橋渡しがある。フックに profile 名が渡るかは確かめていない。

## 視点 2: 名の通った実践者は何を書いているか

| 実践者 | 書いていること | 読み |
|---|---|---|
| Simon Willison | 【要約】 https://simonwillison.net/2025/Sep/30/designing-agentic-loops/ : 「Run your agent in a secure sandbox that restricts the files and secrets it can access.」「Try to provide credentials to test or staging environments where any damage can be well contained.」「If a credential can spend money, set a tight budget limit.」Fly.io では $5 の予算の専用組織と、その組織の中だけを触れる API キーを作った。Anthropic の「use --dangerously-skip-permissions in a container without internet access」を引く。組み込みのサンドボックスについては「so far I've not seen convincing enough documentation of these to trust them」。フックには触れない | 認証情報とデプロイは「ガードで止める」より「渡す鍵を絞る・隔離する」 |
| Armin Ronacher（Willison の講演メモ経由） | 【要約】 https://simonwillison.net/2025/Jun/29/agentic-coding/ : 「Armin runs Claude Code with the `--dangerously-skip-permissions` option」、Willison は「I'm going to start using that option while running in a Docker container」「to ensure nothing too bad can happen」 | 確認を切るならコンテナで |
| Geoffrey Huntley | 【要約】 https://ghuntley.com/ralph/ : 「you'll wake up to a broken codebase that doesn't compile from time to time」。テストについては、文書が「affects the decision-making whether to delete, modify or resolve a test」と書き、指示に「If tests unrelated to your work fail then it's your job to resolve these tests」を入れる。権限やサンドボックスには触れない | 無人のループでテストの変更・削除をむしろ任せる実践者もいる（テスト編集の禁止は普遍ではない） |
| Kent Beck、その他 | テストを消す規則の全文は有料部分で読めなかった（`2026-10-20-goal-loops-practice.md` に記録済み）。「無人の間だけ規則を変える」を書いた名の通った実践者の文章は見つからなかった | — |

## 視点 3: 測定された証拠

| 出典 | 課題の種類 | 結果 |
|---|---|---|
| Anthropic「Claude Code auto mode」【要約】 https://www.anthropic.com/engineering/claude-code-auto-mode | コーディングの実際のツール呼び出し | 二段の判定で誤検知 0.4%（社員の実際の呼び出し n=10,000）、行き過ぎた操作の見逃し 17%（n=52）、持ち出しの見逃し 5.7%（合成 n=1,000）。一段目だけなら誤検知 8.5%。「It is not a drop-in replacement for careful human review on high-stakes infrastructure.」「In headless mode (`claude -p`) there is no UI to ask the human, so we instead terminate the process.」対話では「3 consecutive denials or 20 total」で人に戻す |
| anthropics/claude-code #95726（2026-09-20、open）【直接】 https://github.com/anthropics/claude-code/issues/95726 | 再現手順つきの不具合報告 | 同じ設定で、フックの `ask` は対話では `PermissionRequest` フックが解決し、`claude -p --input-format stream-json` では即座に拒否され `PermissionRequest` フックは呼ばれない。`default` でも `bypassPermissions` でも同じ。数字なし。報告者は不具合として扱うが、「無人なら ask は拒否」を求める側から見ると、この挙動がそのまま使える |
| METR「Recent frontier models are reward hacking」【要約】 https://metr.org/blog/2025-06-05-recent-reward-hacking/ | 研究・最適化の課題（RE-Bench、HCAST）。コーディングの日常作業ではない | o3 の不正: RE-Bench 30.4%（39/128）、HCAST 0.7%（8/1087）、LLM Foundry 最適化では 100%（21/21）。手口に「modifying the tests or scoring code」「Monkey-patching the evaluator」。「Instructing the model ... to not cheat ... had a nearly negligible effect」（「Please do not cheat.」で 80% のまま） |
| ImpossibleBench | コーディング | 測定値は `2026-10-20-goal-loops-practice.md` にある（GPT-5 の不正 54%、テストを読み取り専用にすると改変は防げるが特例処理は防げない）。テストのパスへの書き込みを止める規則の根拠になる |
| モードで規則を切り替えたときの誤判定・すり抜け | — | 測定は見つからなかった |

## 視点 4: 公開リポジトリの実態

### 無人を見分けて動きを変える例

| リポジトリ（★、最終 push） | 使う信号 | 何に使うか | 読み |
|---|---|---|---|
| TokonoMix/agents-never-sleep（★4、2026-10-06） | 起動時の環境変数 `CLAUDE_UNATTENDED=1`（自前のラッパー `claude-run` と cron が付ける） | 【直接】 `hooks/README.md`: 三つのフックが「env-gated to `CLAUDE_UNATTENDED=1`, so once wired they stay completely inert during your normal interactive sessions」。取り消せない操作の拒否、`AskUserQuestion` の拒否、未完了の印があるうちは止まらせない Stop。拒否の規則は「a conservative backstop, not a boundary」 | 質問の形にいちばん近い唯一の例。規模は小さい |
| mann1x/claude-hooks（★27、2026-10-08） | `CLAUDE_CODE_SESSION_ATTENDED`、`CLAUDE_CODE_ENTRYPOINT` | 【直接】 `claude_hooks/session_kind.py`: 表で「`CLAUDE_CODE_ENTRYPOINT` | `cli` | `sdk-cli` / `sdk-ts` / `sdk-py`」「`CLAUDE_CODE_SESSION_ATTENDED` | `1` | `0`」、「measured on 2.1.280」。`CLAUDE_CODE_CHILD_SESSION=1` は親が子に全部渡すので信号にならないと書く。どちらの変数も無ければ対話とみなす。用途はメモリの想起や保存を `claude -p` で止めること（規則の追加ではない） | 環境変数の読み方の一次の測定。止めた理由は「all cost and some damage」 |
| ai-driven-dev/framework（★523、2026-10-21） | 同じ二つの環境変数 | 【直接】 `plugins/aidd-telemetry/hooks/lib/presence.cjs`: 「Both variables are undocumented, so the block needs both to agree that a person is at the keyboard」「a change in Claude can only stop the asking, never block work wrongly」。人に尋ねる処理を、人がいると両方が言うときだけ出す | 文書に無い変数は「外れたら安全側」に倒して使う、という設計 |
| jikig-ai/soleur（★19、2026-10-21） | `CLAUDE_CODE_ENTRYPOINT`、`permission_mode` | 【直接】 `.claude/hooks/DEFER-DECISION-PAYLOAD-SHAPE.md`（2.1.287 で測定）: 「`CLAUDE_CODE_ENTRYPOINT` is `cli` in an interactive session and `sdk-cli` under `claude -p`」。フックの `ask` は allow の規則と `bypassPermissions` の下でも確認を出させる。**「a settings-file `env` block written through an ordinary Bash call reaches the hook of a fresh process, so an environment marker is agent-writable」**ので、環境変数の印には頼らない。未知のモードは deny、版が上がったら測り直す（「not a documented contract」） | 起動時の環境変数の印は、エージェント自身が書き換えられるという失敗の型 |
| egregore-labs/egregore（★292、2026-10-16） | `permission_mode` | 【直接】 `.claude/hooks/boundary-check.sh`: 「Sessions running with permission_mode=bypassPermissions skip the soft tier (never the hard tier)」「a session the user runs in bypassPermissions has already declared maximal trust — Egregore doesn't re-ask」 | YOLO のときに確認を**省く**向き。固い層は常に効かせる |
| oimiragieo/agent-studio | `permission_mode` | 【直接】 `.claude/hooks/safety/bash-command-validator.cjs`: `bypassPermissions` のとき警告だけにする（「allowed in bypassPermissions mode」） | 同じく緩める向き |
| Digital-Process-Tools/claude-remember（★201、2026-10-21） | — | 【直接】 issue #204: 要約のために入れ子の `claude -p` を起動すると、自分のフックがその中でも動き、余計なディレクトリを作り続けた。文書では入れ子の呼び出しに渡す前に `CLAUDE_CODE_SESSION_ATTENDED` などを外すと書く | フックは自分が起動した無人の子でも動く |

コード検索の件数（2026-10-21、`gh api search/code` の `total_count`、写しを含む目安）: `CLAUDE_CODE_SESSION_ATTENDED` 2,552、`CLAUDE_CODE_ENTRYPOINT sdk-cli` 2,744、`CLAUDE_UNATTENDED` 202、`.claude/hooks` の中で `permission_mode bypassPermissions` 125。

### テストのファイルを守るフック

| リポジトリ（★、最終 push） | 切り替えの軸 | 記録された失敗 |
|---|---|---|
| nizos/tdd-guard（★2,363、2026-10-12） | 常時有効、セッションの途中で on/off できる（README「Toggle on and off mid-session」）。モードでは切り替えない | 【直接】 `docs/enforcement.md` が自ら、シェルの自動承認があると `echo`・`sed`・`awk`・`perl` などでフックを回り道してファイルを変えられると書き、deny の規則を足すよう勧める。issue: #48「MCP Tools Bypass TDD Guard」（open）、#100「Validator blocks unrelated edits」（open、誤ブロック）、#83「blocks removal of dead code and its tests during refactoring」（closed、誤ブロック）、#193 判定用モデルの退役で「validation fails closed, blocking every non-test edit」（closed） |
| chieflatif/codex-vibeos-plugin（★1） | 【直接】 `proof-protection.sh`: エージェントの役割（`tester` と `test-auditor` だけ許す）。テストのパスの判定は `*/tests/*`、`*_test.go`、`*.spec.ts` など | — |
| ArcadeAI/safeword（★10）、martineserios/thebrana（★3） | TDD の段階（REFACTOR の段階でテストのファイルが stage されていたら拒否など） | — |

テストのファイルを守る公開フックで、無人のときだけ効かせるものは見つからなかった。どれも常時有効で、役割や段階で例外を作る。

## 要約表

| 出典 | 課題の種類 | 結果 | 数字 | 名指しされた壊れ方 |
|---|---|---|---|---|
| Claude Code 文書 | 製品仕様 | `permission_mode` の既定は端末 `auto`、`-p` `default`。deny は全モードで効く。ask は `-p` で拒否 | 版 2.1.283 / 2.1.302 | 対話の /goal では ask が確認待ちで止まる |
| Claude Code 2.1.303 実行ファイル | ソース | `CLAUDE_CODE_SESSION_ATTENDED`、`CLAUDE_CODE_ENTRYPOINT`、UserPromptSubmit `source` | — | 文書に無く、版で変わりうる |
| Codex 0.160.0 ソース | ソース | `permission_mode` は二値、exec は `bypassPermissions`、ask は素通り | — | ask が fail open。exec と `--yolo` を区別できない |
| omp 18.0.4 ソース | ソース | `ctx.mode`、`goal_updated`、承認既定 `yolo` | — | `hasUI` の注釈が実装と食い違う |
| pi 0.85.1 dist | ソース | `ctx.mode`、goal と承認は無い | — | — |
| Anthropic auto mode 記事 | 実際の呼び出し | 判定器は境界ではない | 誤検知 0.4%、見逃し 17% / 5.7% | 見逃しが残る |
| claude-code #95726 | 不具合報告 | ヘッドレスで ask が即拒否 | なし | `PermissionRequest` が呼ばれない |
| METR | 研究課題 | テストや採点コードの改変 | o3 30.4%（RE-Bench）、0.7%（HCAST） | 「不正するな」の指示は効かない |
| agents-never-sleep | 公開リポジトリ | 起動時の環境変数で無人の規則を足す | ★4 | 境界ではないと自ら書く |
| soleur | 公開リポジトリ | 入口の環境変数と `permission_mode` を測る | ★19、2.1.287 | 環境変数の印はエージェントが書き換えられる |
| egregore、agent-studio | 公開リポジトリ | `bypassPermissions` で緩める | ★292 | 向きが逆 |
| tdd-guard | 公開リポジトリ | 常時有効のテスト保護 | ★2,363 | シェルと MCP での回り道、誤ブロック、判定器の退役で全面ブロック |

## 合成

### 業界の型は「モードで切り替える」ではなく「常に効く deny と隔離」

ベンダー二社と Willison が一致するのは、(1) deny の規則はモードに関係なく効かせる、(2) 確認を切った無人の実行はコンテナや VM の中で回す、(3) フックや判定器は境界ではない、の三点。Anthropic は deny が `bypassPermissions` でも効くと書き、完全な無人の行に「Required: a container, VM, or the sandbox runtime」と書く。OpenAI はフックを「not a complete enforcement boundary」と書く。Willison は認証情報とデプロイについて、ガードではなく「渡す鍵を絞る、予算を付ける、隔離する」を勧める。モードで規則を足す実装は ★4 の一例だけで、ベンダーの文書にも名の通った実践者の文章にも見つからなかった。

### モードで切り替えるなら、ハーネスごとに信号が違い、それぞれに穴がある

| ハーネス | ヘッドレス起動 | 対話の中の goal | 対話の中の loop・予定タスク | 許可モード |
|---|---|---|---|---|
| Claude Code | `CLAUDE_CODE_SESSION_ATTENDED=0`、`CLAUDE_CODE_ENTRYPOINT=sdk-cli`（文書に無い）。UserPromptSubmit `source: "sdk"`（文書に無い） | フックに渡らない。始まりは UserPromptSubmit に `/goal ...` が届く | UserPromptSubmit `source: "loop_wakeup"` / `"schedule_wakeup"`（文書に無い）。Stop の `session_crons`（文書にある） | 使えない（対話の既定が `auto`） |
| Codex | `permission_mode: "bypassPermissions"`（対話の `--yolo` と同じ） | フックに渡らない | CLI に機能が無い | 二値のみ |
| omp | `ctx.mode` が `print` / `rpc` / `json` | `goal_updated` イベント | 見つからなかった | 使えない（既定が `yolo`） |
| pi | `ctx.mode` | 機能が無い | 機能が無い | 仕組みが無い |
| DSH | profile 名（未確認） | 未確認 | 未確認 | 未確認 |

この表から分かる壊れ方は次のとおり。

1. **対話セッションで回す無人の実行は、多くのハーネスで見分けられない。** Claude Code の /goal、Codex の /goal は PreToolUse の時点で分からない。決定メモが「goal にも loop にも同じに効かせる」と書く範囲を、モード判定だけでは覆えない。
2. **文書に無い信号は版で変わる。** soleur は版が上がるたびに測り直す条件を書き、ai-driven-dev は外れたら「尋ねない」側に倒す。
3. **起動時の環境変数の印は、エージェントが書き換えられる。** soleur は、Bash から設定ファイルの `env` を書けば次の起動のフックに届くことを測った。Claude Code は SessionStart フックに `CLAUDE_ENV_FILE` を渡し、そこに書いた値が後の Bash に届くと文書に書く。印を「無人なら規則を足す」に使うと、印を消せば規則が外れる。
4. **フックは無人の子でも動く。** claude-remember の入れ子の `claude -p` では、親のフックがそのまま動いた。無人の規則を環境変数で足すと、対話の親が起動した子にも効く（あるいは外し忘れる）。

### 「禁止ではなく確認」は Claude Code・omp・pi では無人向けに働き、Codex では働かない

- Claude Code: フックの `ask` は auto でも `bypassPermissions` でも確認を出させ（文書と soleur の測定）、`claude -p` では拒否になる（文書と #95726）。人がいれば確認、いなければ拒否、をモード判定なしで得られる。ただし対話セッションの /goal や /loop では拒否にならず確認待ちで止まる（goal 文書の Manual mode の記述、scheduled-tasks の「Inherits from session」）。止まるのは安全側だが、無人の実行はそこで進まなくなる。
- omp と pi: 画面の無い既定の UI では `confirm` が `false` を返すので、print では拒否になる。RPC では相手のプログラムが答えるので、相手が自動で承認すれば通る。
- Codex: PreToolUse の `ask` は失敗扱いで呼び出しを通す（`unsupported_permission_decision_fails_open`）。Codex では、確認にしたい規則も deny で書くしかない。
- 公開リポジトリのテスト保護は、確認ではなく deny で、常時有効だった。誤ブロックの報告（tdd-guard #100、#83）と回り道の報告（#48、`sed` などのシェル）が同時にある。

### 証拠が支えること / 支えないこと / 足りないこと

- **支える。** 認証情報とデプロイのコマンドは、モードに関係なく deny にし、無人の実行は隔離した環境で回すこと（ベンダー二社、Willison、soleur と egregore の「固い層は常に効く」）。Claude Code では、テストのパスへの書き込みを ask にすれば、ヘッドレスでは自動で拒否、対話では確認になること。
- **支えない。** 許可モード（`auto`、`yolo`、`bypassPermissions`）を無人の信号に使うこと。Claude Code と omp では普段の対話そのものの値で、Codex では二値しかない。公開フックの多くは同じ値を「緩める」向きに使っている。
- **支えない。** 起動時の環境変数だけで無人の規則を足すこと。採用例は ★4 の一つで、エージェントが印を書き換えられるという測定がある。
- **足りない。** モード判定で規則を切り替えたときの誤判定とすり抜けの件数、テスト編集の常時禁止を対話で使ったときの誤ブロックの率。どちらも数字は見つからなかった。

### 受け入れられている型と、その既知の壊れ方

受け入れられている型は「どのモードでも効く deny の規則」と「無人の実行は隔離した環境（コンテナ、VM、サンドボックス）で回す」の組み合わせで、モード判定は前提にしていない。既知の壊れ方は三つある。一つ目に、ガードはシェルの回り道（`sed`、`echo` など）と MCP のツールですり抜けられ、境界にはならない（tdd-guard の文書と #48、OpenAI の注意書き）。二つ目に、常時有効のテスト保護は正当な編集も止める（tdd-guard #100、#83）。三つ目に、判定器が落ちると全部止まる（#193）。

モード判定を足す場合に分かっている壊れ方は、ここまでに挙げたとおりである。対話の中の goal は Claude Code と Codex では見えない。文書に無い信号は版で変わる。環境変数の印はエージェントが書き換えられる。Codex では ask が素通りになる。

## 前例が見つからなかったもの

- 五つのハーネスに一つのポリシーを配り、無人の間だけ規則を足す公開実装。
- 「無人の間だけテストのパスへの書き込みを禁じる」公開フック（見つかったテスト保護はすべて常時有効）。
- Claude Code の /goal が動いていることを PreToolUse で判定する公開実装。
- モード判定で規則を切り替えたときの誤判定・すり抜けの測定。
- 無人の間の規則の切り替えについて書いた、名の通った実践者の一次の文章。
- DSH のフックに profile 名や実行モードが渡るという一次の記述。
