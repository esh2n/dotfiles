# Swarm 拡張の土台 — コード確認記録（2026-09-27）

役割: 判断・推奨はしない。事実のみ、file:line かURL、引用は原文のまま。

Method: 直接一次資料 = ローカルの `git log`/`find`/`wc -l`/ファイル読み取り、および
`curl` での直接フェッチ（pi.dev / raw.githubusercontent.com / docs.litellm.ai、いずれも
200 応答、HTML から `<[^>]+>` 除去でテキスト化——JS 実行なしの静的 HTML に本文が
埋め込まれている形式で、要約ではなく原文）。gh 認証トークンは読み出していない
（`curl` のみ、`api.github.com` は未認証アクセスで到達可）。

---

## 1. graph-ideal の残り（worktree `.claude/worktrees/graph-ideal`、ブランチ `feat/graph-ideal-form`、HEAD `b020aca5`）

### 1-1. 何がどこにあるか

- `domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/graph/` 配下、非テストの
  実装ファイルだけで **18,593行**（`wc -l` 合計、テスト・fixture・API.md込みの総数。
  実装のみなら概算1万行弱）。
- 主要ファイルと行数（直接 `wc -l`）:
  - `agent-cli.js` 566行（+ テスト `test/agent-cli.test.js` 793行）— CLI から `agent()` を
    1回叩く `yoki-agent` コマンドの実装。
  - `journal.js` 560行（+ `test/journal.test.js` 440行）— run の journal（resume 用の
    index順再生ログ）。
  - `api.js` 572行 — `agent`/`parallel`/`pipeline`/`budget`/`workflow` の7グローバルを
    ワークフロースクリプトへ注入する実装（`API.md` 1-166行に契約仕様）。
  - `runner.js` 413行 — スクリプトの compile/execute。`node:worker_threads` + `node:vm`
    で本体を隔離実行（`API.md` 174-252行、決定 D4）。
  - `top.js` 500行 + `top-render.js` 481行 + `top-fold.js` 243行 + `top-estimate.js` 94行
    — `yoki-graph top` というクロスラン・ライブビューア（`API.md` 483-551行）。
  - `widget-lines.js` 186行（+ `test/widget-lines.test.js` 230行）— pi ボトムウィジェット用の
    行組み立て純粋関数。
  - `worktree.js` 101行（+ `test/worktree.test.js` 130行）— `git worktree` 隔離（後述 §5）。
  - `schema.js` 369行、`retry.js` 128行、`budget.js` 134行、`guard.js` 130行、
    `catalog.js` 257行、`models.js` 123行、`lock.js` 126行、`gate.js` 211行、
    `worker-source.js` 310行、`worker-host.js` 202行、`progress.js` 208行。
  - `backends/`: `common.js` 239行、`codex.js` 261行、`omp.js` 225行、`mock.js` 77行、
    `index.js` 50行。
  - `API.md` 858行 — このシステムの仕様書そのもの（本文の多くをここで引用済み）。
  - pi 側: `domains/dev/config/pi/extensions/yoki-graph-widget.ts` 304行
    （`622352bd feat(pi): yoki-graph live progress bottom widget`、直接 `git log` で確認）。
    **専用テストファイルは無い**（`find . -iname '*widget*test*'` が拾うのは
    `widget-lines.test.js` だけ——widget-lines.js という純粋関数部分にはテストがあるが、
    `session_start`/`session_shutdown`・`fs.watch`・`ctx.ui.setWidget` の配線本体は
    未テスト）。

- テストは `test/*.test.js` が計 **28本**（`find ... -name '*.test.js' | wc -l`
  相当、上記の個別行数リストから数えた実ファイル数）、`node --test` で実行
  （`API.md` 801行 "Produced by `test/scripts.test.js` (`node --test`)"）。

### 1-2. 依存 — yoki 固有部分の量（`grep -ci yoki` を非テストファイル全件に実行、結果0件は割愛）

```
25 agent-cli.js   13 guard.js   13 budget.js   11 cli.js   9 catalog.js
8 journal.js      7 top.js      6 widget-lines.js   5 top-render.js
4 runner.js       4 api.js      3 worker-source.js  3 backends/omp.js
2 backends/index.js  2 backends/common.js  2 args.js
1 worker-host.js  1 top-fold.js  1 progress.js  1 models.js  1 lock.js
1 backends/codex.js
```
`worktree.js`・`schema.js`・`retry.js`・`gate.js`・`top-estimate.js`・`backends/mock.js` は
**0件**（"yoki" という文字列を一切含まない）。

実際に何を指しているかを `guard.js`/`budget.js`/`catalog.js`/`agent-cli.js` から
逐語で確認した結果、ヒットの大半は次の3種類のいずれかで、**yoki のランタイム/デーモンへの
挙動依存ではない**:
1. 設定ファイル名 `.yoki.json`（`guard.js:18-19,45-54`, `budget.js:17,23,36,62,68,76`）。
   > `guard.js:18-19`: "Cap resolution order (same as the hook): .yoki.json
   > \"workflowDailyCap\" (searched from `cwd` upward) -> YOKI_WORKFLOW_DAILY_CAP -> 5."
2. 環境変数の命名接頭辞 `YOKI_*`（`YOKI_GRAPH_GUARD_STATE_DIR` guard.js:34、
   `YOKI_GRAPH_MAX_AGENT_CALLS` 等 budget.js:31-38、`YOKI_AGENT_MOCK` agent-cli.js:48,469,475,479、
   `YOKI_PROFILES_ROOT` catalog.js:43）。
3. ツール自身の名前が文字列リテラルとしてエラーメッセージ・usage文言に出る
   （`agent-cli.js` の "yoki-agent: ..." 系が25件中の大部分）。
4. yoki-switch の生成物パス規約への参照（`catalog.js:6,39,49,135,188,248` —
   `core/skills/yoki-graph/SKILL.md` という出力先パス、`gen.js` という
   atomic-write ヘルパーへの言及）。

→ 「yoki 固有のものに何が縛られているか」という問いに対する事実:
**縛りは主に設定ファイル名・環境変数の命名規約・出力パス規約であり、
コード自体が yoki の実行時プロセスや API を呼び出して動作を変える箇所は
見当たらない**（`grep` で拾った全箇所を目視確認した範囲、逐語読みは
guard.js/budget.js/catalog.js/agent-cli.jsの該当行のみ、他ファイルの残りの
ヒットは行数のみ確認で内容は未読 — worker-source.js 3件・runner.js 4件・
api.js 4件・top.js 7件・widget-lines.js 6件・top-render.js 5件・
backends/omp.js 3件・cli.js 11件は `[unverified]`、個別に目視していない）。

一方 `backends/omp.js`/`backends/codex.js`/`backends/common.js` は
CLI 引数組み立て（`buildArgv`）・プロセス起動・使用量抽出のみで、
yoki 言及は2-3件（コメントのみと推測されるが未確認）——**codex/omp を
横断で叩く部分自体は omp/codex の公開 CLI 呼び出しであって、yoki 内部APIではない**
（`API.md` 254-286行の Backends 節が仕様として明記: `buildArgv`, `run`, `extractText`,
`extractUsage`, `supportsSchemaNatively` という4メソッドのインターフェース）。

### 1-3. ライセンス

同一リポジトリ（esh2n/dotfiles）内、README.md 1099-1101行:
"## License\n\nMIT"。単体の LICENSE ファイルは無い
(`find` で `LICENSE*` 該当なし、リポジトリルートにも無し)。
`API.md` 741-744行に明記:
> "Mechanisms in this section were re-implemented from the designs described in
> `six-ddc/codex-dynamic-workflows` (strict schema conversion, generic retry,
> run lock, execution caps) and `tintinweb/pi-subagents` (index-ordered prefix
> replay); no code was copied from either."
→ 第三者コードのコピーは無いと明記されている（この記述自体の裏取りはしていない、
`API.md` の自己申告）。

### 1-4. main との関係（現存 vs 削除済み）

- `git log --all --oneline | grep -i graph` で60件超ヒット（2026-08下旬〜09-13）。
- main は commit `68b80d76`（"retired hooks, loop, box, agent, graph"、2026-09-23）で
  `domains/dev/bin/yoki-graph`・`core/validation/test-yoki-graph.sh`・`skills/yoki-graph/`
  を含め丸ごと削除（既存記録 `fit-omp-pi.md:140-145` の記述と一致、今回 `git log --all`
  で再確認）。
- ブランチ `feat/graph-ideal-form` 自体は削除されておらず現存（`git worktree list`
  で `b020aca5` をチェックアウト中と確認済み）。
- pi の他の拡張（`guard.ts`/`gate.ts`/`compactor.ts`/`freshness.ts`）は
  **main に現存**——ただしパスが移動している。graph-ideal ブランチでは
  `domains/dev/config/pi/extensions/`、main では `home/shared/harness/pi/extensions/`
  （`git ls-tree -r main --name-only | grep pi/extensions` で確認、2026-09-24 の
  harness-top-level-dir 決定を反映したもの）。main 側にはこの4本に加え
  `__tests__/guard.test.ts`・`__tests__/skill-router.test.ts`・`__tests__/tier-router.test.ts`
  というテストと、graph-ideal ブランチには無い `skill-router.ts`・`tier-router.ts`・
  `compaction-judgment.ts` がある。**`yoki-graph-widget.ts` だけが main に運ばれず、
  branchに孤立したまま**（他4本は現行 main で生きてテストも付いている）。
- main 側 `guard.ts` の先頭（`git show main:home/shared/harness/pi/extensions/guard.ts`）:
  `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";`
  ——pi のパッケージスコープを直接 import している。この import が omp 環境でも
  解決される必要があるかどうか（jig が omp にこの拡張ファイル一式を配る際に
  import 文をどう扱うか）は本調査の範囲では確認できず `[unverified]`
  （jig 生成側のソースを検索したが `pi/extensions` や omp 向け変換ロジックへの
  直接ヒットは見つからなかった——探索不足の可能性あり）。

---

## 2. pi と omp の拡張 API — 共通部分と差分

一次資料: `https://pi.dev/docs/latest/extensions`（curl 直接取得、200、HTML本文埋め込み）、
`https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/extensions.md`（curl 直接取得）、
`https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/porting-from-pi-mono.md`（同）、
`https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/rpc.md`（同）。

### 2-0. 大前提: omp は pi(-mono) のフォークであり、同期は2026-03-22で止まっている

`omp-porting-from-pi-mono.md`（`docs/porting-from-pi-mono.md`）冒頭:
> "**Commit:** `b21b42d032919de2f2e6920a76fa9a37c3920c0a`\n**Date:** 2026-03-22"
> "Update this section after each sync; do not reuse the previous range."

パッケージスコープの対応（同ファイル45-51行）:
> "`@mariozechner/pi-coding-agent` → `@oh-my-pi/pi-coding-agent`"
> "Some upstream packages publish under the `@earendil-works/*` scope instead of
> `@mariozechner/*`. Map it the same way"

→ **pi は現在 `@earendil-works/pi-coding-agent`、omp は `@oh-my-pi/pi-coding-agent`
という別スコープの別パッケージ**（omp 自身のドキュメントが明言）。「同じ拡張ファイルが
両方で動くか」への直接の答え: **型 import のパッケージ名からして別物であり、
最終同期日が半年前（2026-03-22、今日は09-27）なので、それ以降の pi 側の変更は
omp に未反映な可能性が高い**——実例は下記2-2で具体的に確認。

### 2-1. 共通する登録メソッド（表面上は同一）

pi公式ドキュメント（`pi.dev/docs/latest/extensions`、Choose an integration point 表、
直接引用）:
| Capability | Main API |
|---|---|
| Observe or modify lifecycle behavior | `pi.on()` |
| Add a model-callable operation | `pi.registerTool()` |
| Add a `/` command | `pi.registerCommand()` |
| Add a shortcut or CLI flag | `pi.registerShortcut()` or `pi.registerFlag()` |
| Send user or custom messages | `pi.sendUserMessage()` or `pi.sendMessage()` |
| Persist non-context session data | `pi.appendEntry()` |
| Add terminal rendering | Renderer registration and `ctx.ui` |

omp公式ドキュメント（`docs/extensions.md:29-36`、直接引用）:
> "Extensions can combine all of the following in one module:
> - event handlers (`pi.on(...)`)
> - LLM-callable tools (`pi.registerTool(...)`)
> - slash commands (`pi.registerCommand(...)`)
> - keyboard shortcuts and flags
> - custom message rendering
> - session/message injection APIs (`sendMessage`, `sendUserMessage`, `appendEntry`)"

omp の `ExtensionAPI` コアメソッド一覧（`docs/extensions.md:115-128`、直接引用）:
> "`on(event, handler)`"
> "`registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`"
> "`sendMessage`, `sendUserMessage`, `appendEntry`, `exec`"

→ **メソッド名の並び（`registerTool`/`registerCommand`/`registerShortcut`・`registerFlag`/
`sendMessage`・`sendUserMessage`/`appendEntry`）は pi・omp で文字通り一致**。
両ドキュメントのサンプルコードも `import type { ExtensionAPI } from "@.../pi-coding-agent"`
という同一の形（omp `docs/extensions.md:22-26`、pi `pi.dev/docs/latest/extensions`
Create and load 節）。

### 2-2. `ctx.ui.setWidget` — シグネチャ一致（両者で直接確認）

pi（`pi.dev/docs/latest/tui`、直接引用）:
> "@earendil-works/pi-tui provides the terminal component system used by Pi. ...
> ctx.ui.setWidget() ... The corresponding ctx.ui component factory ...
> After changing component state, invalidate the affected component and call the
> injected tui.requestRender() . The TUI coalesces render requests and updates the
> terminal."

omp（`docs/extensions.md:674`、直接引用）:
> "`setWidget` renders real widget components above or below the editor via
> `setHookWidget(...)` (`placement: \"aboveEditor\" | \"belowEditor\"`; string-array
> content capped at 10 lines)."

→ **placement enum（aboveEditor/belowEditor）・文字列配列10行キャップ・
pull-render + `tui.requestRender()` という契約は pi・omp で同一**。
graph-ideal の `yoki-graph-widget.ts`（304行）が実際にこの契約
（`ctx.ui.setWidget(key, (tui, theme) => Component, { placement })`、
`tui.requestRender()`、`session_shutdown` での teardown）で書かれていたことは
既存記録 `fit-omp-pi.md:85-97` で確認済み（再確認せず引用のみ）。

### 2-3. セッション終了時の後片付けフック — 名前と意味が食い違う

pi（`pi.dev/docs/latest/extensions`、直接引用）:
> "Close session-scoped resources from an idempotent session_shutdown handler."
> "agent_before_settle is the final actionable boundary: it can append entries and
> request one continuation. agent_settled is final and notification-only; use it
> when an integration needs to know Pi will not continue automatically."
> "Release resources in session_shutdown even when normal operation attempted
> cleanup. Keep cleanup idempotent because cancellation, reload, session
> replacement, and process exit can converge on the same path."

omp（`docs/extensions.md:333`、Session lifecycle 節見出しの列挙に `session_shutdown`
が単独で載る。「最終境界」に相当する概念は**別名**）:
> `docs/extensions.md`（Prompt and turn lifecycle 節）:
> "`session_stop` — main-session stop hook, awaited before settle. Advisory
> `{ continue: true, additionalContext }` requests are capped at 8 continuations.
> Explicit `{ decision: \"block\", reason }` refusals take precedence over advisory
> requests... This event never fires for task/subagent sessions..."

→ `session_shutdown`（アイドンポテントなリソース解放）という**名前自体は一致**。
一方 pi の「最終アクション境界」は `agent_before_settle`/`agent_settled` の2イベント、
omp の相当機能は `session_stop`（continue上限8回・block/reason構造という別の意味論）
という**別名・別セマンティクス**——omp の `docs/extensions.md` 全文検索で
`agent_before_settle`・`context_with_system`（pi 0.87の目玉機能名、MEMORY.md
「pi 0.87 context boundaries」記載）は**1件もヒットしない**（`grep -n` で確認、
0件）。これは前掲2-0の「同期が2026-03-22で止まっている」を補強する具体例——
pi の0.87系（2026-09-22リリース、MEMORY.md記載）の変更が omp ドキュメントに
反映されていない。

### 2-4. 親の会話へメッセージを差し込む手段 — 語彙は同じ、配送オプションが違う

pi（`pi.dev/docs/latest/extensions`、直接引用、表の行）:
> "Send user or custom messages | `pi.sendUserMessage()` or `pi.sendMessage()`"

omp（`docs/extensions.md:205-217`、直接引用、`deliverAs` オプション列挙）:
> "`deliverAs: \"steer\"` (default) — interrupts current run"
> "`deliverAs: \"followUp\"` — queued to run after current run"
> "`deliverAs: \"nextTurn\"` — stored and injected on the next user prompt"
> "`deliverAs: \"aside\"` — injected at the next agent step boundary without
> interrupting the current tool batch..."

pi の `sendMessage`/`sendUserMessage` にも `deliverAs` に相当する配送指定はある
（JSON Event Stream ドキュメントで `steer`/`followUp` は確認済み、後述§3）が、
`nextTurn`・`aside` という2種は今回読んだ pi 公式ページには出てこない
（pi 側ページで見つからなかった、`[unverified]`: pi の拡張API自体に
`nextTurn`/`aside` 相当が無いと確定したわけではなく、今回読んだドキュメントページに
記載が無かっただけ）。

### 2-5. 子（subagent）の spawn フック — pi には存在しない概念

omp（`docs/extensions.md`、Subagent lifecycle 節、直接引用）:
> "`before_subagent_spawn` → `{ model?: string | string[]; block?: boolean; reason?:
> string; note?: string }`. Fires in the parent session exactly once per spawned
> child (`task`, eval `agent()`, workpool workers), at dispatch before the child
> resolves its model..."

pi（`pi.dev/docs/latest/extensions`、全文中に "subagent" という語は**1件もヒットしない**、
`grep -i subagent pi-extensions-text.txt` で確認、exit code 1 = 0件）。

→ **`before_subagent_spawn` は omp 固有**（omp本体が `task` ツールをネイティブに持つため）。
pi 本体には spawn 概念自体が無い（既存記録 `fit-omp-pi.md`/`omp-internals.md` の
「pi 本体に Swarm は無い」という結論と整合——今回は「spawn フックの語彙自体が
pi の公式拡張ドキュメントに存在しない」という、より直接的な形で再確認）。

### 2-6. キー割り当て・スラッシュコマンド

pi: `pi.registerCommand("hello", {...})` で `/hello` として登録
（`pi.dev/docs/latest/extensions`、Create and load an extension 節のサンプルコード
そのまま引用済み、上記）。`pi.registerShortcut()`/`pi.registerFlag()` も表に同列で並ぶ
（同ページ、Choose an integration point 表）。

omp: 同じ `registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`
の4つを1行で並べる（`docs/extensions.md:116`、直接引用済み、上記2-1）。

→ **メソッド名・役割分担は一致**。個々の型シグネチャ（例えば `registerShortcut` が
受け取るキーバインド表現の形式）までは今回読んだページの範囲では確認できていない
`[unverified]`。

### 2-7. RPC層に omp 固有の「子の状態購読」チャンネルが存在する（既存調査の盲点）

既存記録 `omp-internals.md`（4-2節）は「拡張の `pi.on(...)` から子の状態を購読する
公式イベントは無い」と結論している——これは**拡張API層**についての結論であり、
今回 `docs/rpc.md`（omp、直接引用）を読むと、**別の統合面である RPC プロトコル層**に
以下が存在する:
> "Subagent frames (`subagent_lifecycle`, `subagent_progress`, `subagent_event`),
> gated by `set_subagent_subscription`" (`docs/rpc.md:88`)
> "`set_subagent_subscription` selects: \"off\": no forwarded subagent frames /
> \"progress\": lifecycle and progress frames / \"events\": lifecycle, progress,
> and full subagent event frames" (`docs/rpc.md:611-615`)
> "`get_subagents` returns the registry snapshot sorted by subagent index and id.
> `get_subagent_messages` selects a transcript by `subagentId` or `sessionFile`;
> `fromByte` supports incremental reads." (`docs/rpc.md:617-619`)

→ **omp を `--mode rpc` で外部プロセスから駆動する場合、拡張(`pi.on`)経由では
手に入らない子の進捗フレーム（lifecycle/progress/event）を RPC のコマンド
(`set_subagent_subscription`)経由で購読できる**——これは in-process 拡張とは
別の統合ポイントであり、`omp-internals.md` の結論と矛盾しない（結論のスコープが
拡張APIに限定されていたため）。ただし `subagent_progress`/`subagent_lifecycle`/
`subagent_event` フレームの具体的なペイロード形（コスト・トークン・モデル名を
含むか）はこの `rpc.md` からは特定できず——`docs/rpc.md` 全文中に
"subagent_progress" は1回しか出現しない（見出しの列挙のみ、フィールド定義は
見つからず）`[unverified]`。

### 2-8. RPCプロトコル自体が pi と omp で非互換だと omp が自己申告している

`docs/rpc.md:573-589,603-607`（直接引用、まとめて）:
> "Command discovery is intentionally an OMP dialect: Pi's `get_commands`
> ... is not served..."
> "Concretely: Pi `model_change` carries `provider` + `modelId` while OMP carries
> a combined `model` plus role/fallback metadata; Pi uses a `usage` entry where
> OMP uses `model_usage`; and OMP has additional entry types..."
> "Lifecycle stays OMP: terminal settle is `agent_end` with `isTerminal !== false`,
> not Pi's `agent_settled`; `prompt_result`/`agentInvoked`, `open_session`,
> `set_event_filter`, `messageId`, `ready`, negotiation, chunking, host tools, and
> subagents are OMP extensions a Pi-family adapter must dialect around."

→ **omp自身のドキュメントが「PiのRPCクライアントはompと配線を共有できない」と
明言している**（usage フィールド名だけでも `usage` vs `model_usage` で違う）。
これは Q4（コスト取得）にも直結する事実——後述§4。

---

## 3. 子を画面なしで起こす手段 — pi と omp の非対話モード比較

一次資料: `pi.dev/docs/latest/cli`、`pi.dev/docs/latest/json`、`pi.dev/docs/latest/rpc-commands`、
omp `docs/cli-reference.md`（raw.githubusercontent.com、直接取得）。

### 3-1. モード切り替えフラグ

pi（`pi.dev/docs/latest/cli`、直接引用）:
> "pi --print \"Summarize this repository\""
> "pi --mode json \"Inspect this repository\" > events.jsonl"
> "-p, --print | Run the supplied prompts, write the final assistant text to
> stdout, then exit"
> "--mode json | Run the supplied prompts, write JSONL events to stdout, then exit"
> "--mode rpc | Read JSONL commands from stdin and write responses and events to
> stdout until shutdown"
> "RPC mode rejects @file arguments."

omp（`docs/cli-reference.md:39-40,155,164-204`、直接引用）:
> "# Non-interactive: process the prompt and exit (headless / print mode)
> omp -p \"List all .ts files in src/\""
> "`--mode <mode>` | Output/transport mode: `text` (default), `json`, `rpc`, `acp`,
> or `rpc-ui`."
> "`--no-ui` (only with `--mode rpc`) runs extensions headless: no
> `extension_ui_request` dialogs are sent to the host, and `ctx.hasUI` is `false`."

→ **`-p`/`--print`、`--mode json`、`--mode rpc` の3点は完全一致**。omp は
これに加えて `--mode acp`（Agent Client Protocol、今回中身は未調査）と
`--mode rpc-ui`（拡張のツールUIもRPC経由に含める）を持つ——**omp のほうがモードの
選択肢が多い**。

### 3-2. モデル・thinking深さの指定

pi（`pi.dev/docs/latest/cli`、直接引用）:
> "pi --model sonnet:high"
> "--model <pattern> | ... It accepts provider/id and an optional :<thinking>
> suffix."
> "--thinking <level> | Sets off, minimal, low, medium, high, xhigh, or max. It
> overrides a --model suffix and is clamped to the model's capabilities."

omp（`docs/cli-reference.md:98-104`、直接引用）:
> "`--thinking <level>` | Set the thinking level: `off`, `minimal`, `low`, `medium`,
> `high`, `xhigh`, `max`, or `auto`."
> "`--external-thinking` | Use a private scratchpad while disabling supported
> GPT/Claude/Gemini reasoning. Use at your own risk: providers have flagged this
> request shape as abuse."

→ **`--thinking <level>` のenum（off/minimal/low/medium/high/xhigh/max）は完全一致**。
omp のみ追加で `auto` と `--external-thinking`（プロバイダから乱用扱いされる旨の
警告つき）を持つ。

### 3-3. 途中経過を機械可読に受け取る（ツール呼び出し・ターン・トークン・費用）

pi（`pi.dev/docs/latest/json`、直接引用、イベント種別）:
> "agent_start / agent_end / agent_settled / turn_start / turn_end /
> message_start / message_update / message_end"
> "tool_execution_start | toolCallId, toolName, args | Tool execution started."
> "tool_execution_update | toolCallId, toolName, args, partialResult"
> "tool_execution_end | toolCallId, toolName, result, isError"
> 実例: `{ \"type\": \"message_update\", \"usage\": { \"input\": 100, \"output\": 1,
> \"cacheRead\": 0, \"cacheWrite\": 0, \"totalTokens\": 101, \"cost\": { \"input\": 0,
> \"output\": 0, \"cacheRead\": 0, \"cacheWrite\": 0, \"total\": 0 } }, ...}`

→ pi の `message_update` イベントは **`usage` に加えて `cost`（USD、input/output/
cacheRead/cacheWrite/totalの内訳）を自前で持つ**——これは後述§4の通り「pi自身の
モデル価格メタデータから計算された値」であり LiteLLM のヘッダから来た値ではない。

omp: 今回取得した `docs/cli-reference.md`・`docs/rpc.md` の範囲では
`--mode json` 用の専用ドキュメントファイル（pi の`json.md`相当）は見つからなかった
——`docs/rpc.md:80` が "3. `AgentSessionEvent` objects (`agent_start`,
`message_update`, etc.)" と述べ、`docs/rpc.md:521-522` で
"`message_start`, `message_update`, `message_end`" と
"`tool_execution_start`, `tool_execution_update`, `tool_execution_end`" を
列挙——**イベント名自体は pi と一致**するが、`message_update` の usage/cost
フィールド名が pi の `usage`/`cost` と同一かは今回確認できていない
`[unverified]`（§2-8 で見た「Pi uses a `usage` entry where OMP uses
`model_usage`」はセッションの**永続履歴エントリ**の話で、RPC/JSONの
ライブストリームイベントである `message_update.usage` と同じ対象かは
未確定——別の抽象レイヤの可能性がある）。

### 3-4. 途中で止める・追加指示を送る

pi（`pi.dev/docs/latest/rpc-commands`、直接引用）:
> "abort | Abort the current operation and wait for the session to become idle
> before responding."
> "steer | Queue a steering message while the agent is running. It is delivered
> after the current assistant turn finishes executing its tool calls, before the
> next LLM call."
> "{ \"type\": \"prompt\", \"message\": \"New instruction\", \"streamingBehavior\":
> \"steer\" }"

omp（`docs/rpc.md`、Command Schema 節、直接引用）:
> "{ id?, type: \"abort\" }"
> "{ id?, type: \"abort_and_prompt\", message: string, images?: ImageContent[] }"
> "{ id?, type: \"steer\", message: string, images?: ImageContent[] }"
> "{ id?, type: \"follow_up\", message: string, images?: ImageContent[] }"

→ **`abort`・`steer`・`follow_up`（pi は `followUp` 型フィールド名だがコマンド名としては
同じ概念）は両者に存在**。omp のみ `abort_and_prompt`（中断してすぐ次のプロンプトを
入れる複合コマンド）を追加で持つ。

### 3-5. システムプロンプト・スキル・拡張を子に読ませない/読ませる指定

今回読んだ範囲では、pi・omp いずれの CLI/RPC ドキュメントにも「このプロンプトだけ
システムプロンプトを空にする」「拡張をロードしない」という専用フラグは見当たらなかった
`[unverified]`——pi 側は `pi --extension ./hello.ts` で特定の1拡張を明示ロードする例は
あった（`pi.dev/docs/latest/extensions`、Add it to Pi 節）が、これは「追加ロード」であり
「除外」の指定ではない。既定でユーザー/プロジェクトディレクトリの拡張が自動ロードされる
前提（`extension-loading.md` 相当のドキュメントは今回未取得）。**「読ませない」ための
専用フラグの有無は未確認のまま**——この項目は「確認できなかったこと」に計上。

---

## 4. 費用とトークン — LiteLLM ヘッダと pi/omp 自身の計算の関係

一次資料: `https://docs.litellm.ai/docs/proxy/response_headers`（直接curl、200、
静的HTML本文）。

### 4-1. LiteLLM のコストヘッダ（vendor一次資料、直接引用）

> "Cost Tracking Headers ... x-litellm-response-cost float Cost of the API call
> x-litellm-response-cost-input float Uncached input cost component
> x-litellm-response-cost-output float Output cost component, reasoning included
> x-litellm-response-cost-cache-read float ... x-litellm-response-cost-cache-creation
> float ... x-litellm-response-cost-reasoning float ... x-litellm-response-cost-tool-usage
> float ... x-litellm-key-spend float Total spend for the API key"
> "The component headers sum to the total ... The cache and reasoning headers appear
> only when those costs are nonzero, and component headers appear on non-streaming
> responses only"
> "x-litellm-model-api-base string API base URL"（決定記録
> `2026-09-27-deterministic-falls-back-to-the-mac.md` が読む対象と同一ヘッダ）
> "x-litellm-complexity-router-tier ... x-litellm-complexity-router-cause ...
> x-litellm-complexity-router-score ... These headers are available on streaming
> and non-streaming requests to /v1/chat/completions, /v1/responses, and
> /v1/messages."

→ **`x-litellm-response-cost` はヘッダとして存在する**が、その内訳（input/output/
cache/reasoning の個別ヘッダ）は「non-streaming responses only」と明記——
**ストリーミング応答（pi/ompの通常のチャット呼び出しはストリーミング）では
コスト内訳ヘッダが付かない可能性が高い**（合計の `x-litellm-response-cost` 自体が
ストリーミングで付くかは、この文からは明言されておらず `[unverified]`——
"complexity router" 系ヘッダはストリーミングでも付くと明記されているが、
コストヘッダ節にその明記は無い）。

### 4-2. pi/omp が独自に費用を計算する仕組み（LiteLLMヘッダを読むかは未確認）

pi（`pi.dev/docs/latest/custom-provider`、直接引用）:
> "Every model needs an ID, display name, input capabilities, and cost metadata.
> Chat and classifier models also need a context window; chat models need an
> output limit and reasoning support..."
> サンプルコード中: "cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },"
> "Set a concrete terminal stop reason. Error and aborted messages need an
> errorMessage; successful messages need accurate input, output, cache,
> total-token, and cost values."

→ **カスタムプロバイダ（LiteLLMのようなOpenAI互換エンドポイントを含む）を pi に
登録する際、`cost` メタデータは必須フィールドとしてモデル定義時に手動で宣言する
契約になっている**。これは pi 側が LiteLLM の応答ヘッダから動的にコストを
読み取るのではなく、**pi自身が保持する $/token 表 × usage で計算している**ことを
強く示唆する（直接の否定文——「LiteLLMのヘッダは読まない」——は見つかっていないため
断定はできない、`[unverified]`だが、必須メタデータとして手動宣言を要求する設計は
「自動的にプロバイダ側のコストヘッダを信頼する」設計とは相容れない）。
→ 実務的な含意（判断はしないが事実として）: **LiteLLM 経由で新しいモデルを
tier に追加したとき、pi/omp 側の該当モデル定義に cost メタデータが無ければ、
pi/omp 自身が出す `usage.cost`（§3-3の `message_update.usage.cost`）は
0 または不正確になりうる**——この repo の `harness/policy/models.json` に
pi/omp向けの cost メタデータが存在するかどうかは今回確認していない
`[unverified]`。

### 4-3. omp のコスト表示（Agent Hub）との関係

既存記録 `omp-internals.md`（2-2節、今回再確認せず引用のみ）:
> "ロースター行の中核指標は `AgentMetricsSummary` ... tokens, requests, tools, cost,
> durationMs, ..."
これは Agent Hub という**拡張APIとは別のomp本体UI**の話であり、omp本体がどこから
`cost` 数値を得ているか（LiteLLMヘッダか自前価格表か）はこの記録・今回の調査の
いずれでも一次資料レベルでは特定できていない `[unverified]`。

---

## 5. 作業場所の隔離 — omp `isolated: true` の実装と、pi 側での git worktree 実装例

### 5-1. omp `isolated: true`（既存記録の引用、今回再検証はしていない）

既存記録 `omp-internals.md`（1-5節、逐語引用のまま）:
> "`isolated: true`（`task.isolation.enabled` かつ plan mode オフのときだけワイヤに存在する
> フィールド）を立てると、隔離バックエンド（`auto`/`apfs`/`btrfs`/`zfs`/`reflink`/
> `overlayfs`/`projfs`/`block-clone`/`rcopy`、`isolation.backend` で選択、PAL がフォール
> バックリストを歩く）でワークスペースを作り、そこで実行後に**パッチ取り込み**か
> **`omp/task/<id>` ブランチへコミットしてチェリーピック**のどちらかで親に合流する。
> 隔離実行は完了時に破棄され、再開不可"

→ **omp の `isolated: true` は git worktree ではなく、ファイルシステムレベルの
コピー・オン・ライト機構（APFS clone、btrfs/zfs snapshot、reflink等）**——
既存記録の結論を今回の追加調査でも覆す情報は見つからなかった。

### 5-2. pi 側の git worktree 実装例 — graph-ideal の `worktree.js`（本調査で直接読了）

`domains/dev/config/claude-profiles/runtime/yoki/scripts/lib/graph/worktree.js`
（101行、直接読了、全文引用可能なほど短い）:
- 依存は `fs`/`path`/`child_process` の Node標準ライブラリのみ（`require`3行、
  1-22行）。**"yoki" という文字列を一切含まない**（§1-2 の grep で確認済み）。
- `create(cwd, runId, n)`（68-79行）: `git rev-parse --show-toplevel` でリポジトリ
  ルートを特定し、`<repoRoot>/.claude/worktrees/graph-<runId>-<n>` に
  `git worktree add -b graph/<runId>-<n> <path>` を実行（77行）。
- `cleanup({path, repoRoot, branch})`（87-99行）: `git status --porcelain` が空
  （クリーン）なら `git worktree remove --force` + `git branch -D`、汚れていれば
  **削除せず** `{removed: false, path}` を返して呼び出し元に知らせる（89-91行、
  コメント58行: "can't tell -> treat as dirty, never silently discard work"）。
- 全ての git 呼び出しが `execFile` の非同期版（`execFileSync` ではない）——
  理由がコメントで明記（10-17行）:
  > "these run inside api.js's `agent()`, which parallel()/pipeline() fire several
  > of at once — and a sync call blocks node's single JS thread for its whole
  > duration ... Sync git here was quietly serializing the concurrency the API
  > is built around."
- テスト `test/worktree.test.js`（130行）が付いている。
- `API.md:769-771`（直接引用）:
  > "`opts.isolation: 'worktree'` (`go-optimize.js`'s Propose phase) is a
  > runner-level feature (`worktree.js`, real `git worktree` off `cwd`'s HEAD)
  > that doesn't touch the backend at all."
  →「バックエンド（codex/omp）に一切触れない」独立した仕組みとして設計されている
  ことが明記されている。

→ **事実として**: pi 拡張として git worktree ベースの隔離をやりたい場合、
このリポジトリには「yoki にもcodex/ompバックエンドにも依存しない、101行・
テスト付きの実装例」が既に存在する（同一リポジトリ内、MITライセンス自己申告、
第三者コード非依存を`API.md`が明言）。ただし**この関数自体を pi の
`ExtensionAPI`（`pi.registerTool`等）から呼び出す配線コードは
`yoki-graph-widget.ts` には含まれておらず**（widget.tsは進捗表示ウィジェットのみで
worktree.jsを呼んでいない、`yoki-graph-widget.ts`のインポート文は未確認だが
既存記録`fit-omp-pi.md`が説明する役割は「進捗表示」のみ）、worktree.js は
`agent-cli.js`/`api.js` という yoki-graph 独自のランナー経由でのみ呼ばれている
（`API.md`769行の "runner-level feature" という記述、ランナーは pi/omp の
外側にある yoki-graph 自身のプロセス）。**pi の拡張API内から直接この関数を
呼ぶ実装例そのものは存在しない** `[unverified扱いに近い事実]`——存在するのは
「外部ランナーから呼ばれる隔離ユーティリティ」であって「pi拡張内蔵の隔離ツール」
ではない、という区別。

### 5-3. pi公式の「隔離」ドキュメントは git worktree に触れていない

`pi.dev/docs/latest/containerization`（"Isolate Pi" ページ、直接引用）:
> "Choose an isolation method | Method | Where Pi runs | What is isolated | ...
> Plain Docker | Container | Pi, built-in tools, ! commands, and extensions | ...
> Docker Sandboxes | Managed sandbox | ... | Provider credentials remain on the
> host ... OpenShell | Local or remote sandbox | ... | Gondolin extension | Host |
> Built-in tools and ! commands | ..."

→ pi公式の「隔離」ガイドは **Docker／Docker Sandboxes／OpenShell／Gondolin拡張の
4方式のみを扱い、git worktreeには一切言及しない**
（`grep -i worktree` で該当ページ内0件、確認済み）。
`pi.dev/docs/latest/isolate-pi` という直感的なURLは **404**（Page Not Found、
直接確認）——正しいスラッグは `/docs/latest/containerization`。

---

## 確認できなかったこと

- jig が現在 pi/omp 両方に拡張ファイル（`guard.ts`等）を配っているか、配る際に
  `@earendil-works/pi-coding-agent` → `@oh-my-pi/pi-coding-agent` のようなimport書き換えを
  行っているか。jigのソース内を `pi/extensions`・`earendil-works`・`oh-my-pi` で検索したが
  該当箇所を見つけられなかった（探索範囲が不十分な可能性あり）。
- omp の Bunネイティブ`import()`と pi の`jiti`が、存在しないパッケージへの
  `import type` 文（型のみimport）をどちらも実行時エラー無く読み飛ばすか
  ——実機の omp がこのサンドボックスでは起動不能（既存記録 `fit-omp-pi.md:26-38`
  のEPERM、native addon）のため実行確認していない。
- `subagent_progress`/`subagent_lifecycle`/`subagent_event`（omp RPC）の
  ペイロード形——コスト・トークン・モデル名を含むか、`docs/rpc.md`本文からは
  フィールド定義を特定できなかった。
- omp の `--mode json` 専用ドキュメントページの所在——`docs/`一覧に`json.md`相当が
  見当たらず、`cli-reference.md`/`rpc.md`からの間接情報のみ。
- pi/omp の `message_update.usage.cost`（またはomp相当）が実際に LiteLLM の
  `x-litellm-response-cost` ヘッダを読んでいるのか、完全に自前の価格表だけで
  計算しているのかの断定——`pi.dev/docs/latest/custom-provider`の必須メタデータ
  という設計から自前計算だと強く推測されるが、ソースコードレベルの確認はしていない。
- LiteLLM の `x-litellm-response-cost`（内訳ではなく合計）自体がストリーミング
  応答でも付与されるかどうかの明文——vendor文書はコスト内訳ヘッダについてのみ
  "non-streaming only" と明記し、合計ヘッダについては明記していない。
- pi/ompのどちらでも「このプロンプトだけシステムプロンプト・スキル・拡張を
  読ませない」という専用フラグの有無。
- `pi.registerShortcut()`/`pi.registerFlag()`の型シグネチャの詳細（キー表現形式等）。
- omp の`docs/extensions.md`が最新のomp実装（v18.3.4）と一致しているか
  ——ドキュメントとコードの乖離自体は今回検証していない（ドキュメントを一次資料として
  扱った）。
- graph-ideal の `top.js`/`top-render.js`/`journal.js`等、yoki言及があった残りの
  ファイル（agent-cli.js/guard.js/budget.js/catalog.js以外）の該当行の内容——
  行数のみ確認し、目視での逐語確認はしていない。
