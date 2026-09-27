# C: この家の構成に当てはめるための土台 — 事実集約（2026-09-27）

役割: 判断はしない。omp/pi/herdr/llama-server/LiteLLM の「載せる側」の実測・一次資料のみ。
前提の確立済み記録（内容は引用のみ、再調査しない）:
- `harness/rules/decisions/2026-09-22-subagents-and-workflows-by-scale.md`
- `harness/rules/decisions/2026-09-22-loop-native-goal.md`
- `harness/rules/decisions/2026-09-23-tier-fixed-main-subagent-escalation.md`
- `harness/rules/research/2026-09-22-multi-lane-review-per-harness.md`
- `harness/rules/research/2026-09-22-workflow-script-portability.md`（実機 omp 18.0.4 / pi 0.85.1 / codex 0.155.1 での実測ログ）

Method: 直接一次資料 = ローカル `--help` 実行、リポジトリの git 履歴・ファイル読み取り。
WebFetch-summarized = 小型モデルが要約した内容（(WebFetch) と明記）。gh api は本セッションの
サンドボックスで `tls: failed to verify certificate` により api.github.com に到達不能（`gh search`/
`gh api` 系はすべて失敗、`gh release list` も失敗）。GitHub 上のファイルは WebFetch 経由の raw
URL 取得で代替。npm レジストリも 403（社内ポリシー）で到達不能。

---

## 1. omp（oh-my-pi）— 最新版との差分、task/subagent、画面表示、既知の問題

**バージョン**: この機体は `omp --version` が **起動時にクラッシュ**（下記）。
09-22 の実機検証記録は omp 18.0.4 を使用。WebFetch（GitHub releases ページ要約、(WebFetch)）による
最新タグは **v18.3.4（2026-09-27、今日）**。18.0.4 → 18.3.4 の差分は未確認（changelog 未取得、
docs/… の raw URL は 404）。バージョンドリフトがある前提で読むこと。

**この機体での実行結果（今回新規に確認、直接一次資料）**:
```
$ omp --version
proxy key unresolved — starting omp WITHOUT LITELLM_API_KEY (proxy/* models will fail to auth)
error: Failed to load pi_natives native addon for darwin-arm64.
Tried:
- embedded addon dir: EPERM: operation not permitted, mkdir '~/.omp/natives/18.0.4'
...
```
`~/.omp/natives/18.0.4/` への `mkdir` が `EPERM`（このサンドボックス環境固有の書込み制限）で
native addon が読み込めず **起動不能**。9/22 時点の実機検証はこの制限より前に行われている
（当時は成功ログが残っている）。**この事実は「今この瞬間、この機体で omp が起動するか」の
状態であり、omp 自体の欠陥ではない** — サンドボックスの書込み許可の問題。

**task ツールの並列・fresh context（09-22 実測 + 今回の doc 追認）**:
- 09-22 実測: `tasks[]` 一括配列で並列 spawn、`task.maxConcurrency` 既定 32（`0`=無制限）、
  fresh context 確認済み（`docs/task-agent-discovery.md`「Subagents start blank — no conversation
  history」）。
- 今回 WebFetch（(WebFetch)、`docs/task-agent-discovery.md`）で確認したモデル決定順:
  > "For task dispatch, model precedence is: 1. `task.agentModelOverrides[agentName]` 2. the agent
  > frontmatter's prioritized `model` list 3. the parent's active model, then its configured/default
  > model fallback."
  → 09-22 実測の「`eval` の `agent()` には per-call `model` が無い」と矛盾しない。**`task` ツール
  経由（バンドル済み agent 型 `scout`/`reviewer`/`security-reviewer` 等）には per-agent モデル指定の
  正式な優先順位がある**。09-22 の「omp でモデル階層をやるなら agent frontmatter か
  `task.agentModelOverrides` 側」という訂正候補は、この一次資料で裏付けられた。

**画面表示 — Agent Hub（今回新規発見、(WebFetch) 経由、`docs/agent-hub.md`）**:
omp は「kubectl 風の一覧」に相当するものを**すでにネイティブで持つ**。
> "status (`running`, `idle`, `parked`, or `aborted`), agent identity, parent, and unread IRC count;
> model role, resolved model, and age since last activity; assigned task or current activity; cost,
> active time or elapsed span, request count, tool-call count, and tokens."
インスペクタ枠でコンテキスト使用量・ツール引数・親子関係も見える。実行中の agent へメッセージを
送って操縦する（steer）、parked を revive、terminate も可能——一覧だけでなく操作面も持つ。
さらにエディタ上部に「Subagents block」という pinned なジャンプリストが別途ある。
この機能は 09-22 の調査記録には出てこない（未発見だった）ため、C の土台としては新規の重要事実。

**既知の問題**: CHANGELOG.md の raw URL は 404（パスが変わっている可能性、未確認）。
`omp --version` のクラッシュは本機体固有（native addon の EPERM）で、omp 一般の issue としては
未確認 `[unverified]`。

---

## 2. pi — 拡張 API の画面表示、別プロセス/別セッション、子への別モデル割当

**バージョン**: この機体 `pi --version` → **0.85.1**（直接一次資料、正常起動）。
WebFetch（GitHub releases ページ要約、(WebFetch)）による最新は **v0.87.1（2026-09-22）**。
0.85.1 → 0.87.1 の間に `v0.87.0`「Canonical session context and extension boundaries」
（`context_with_system` の system-message 変換、`turn_end`/`agent_before_settle` の
「actionable」化）がある——09-23 の pi-0.87 メモ（MEMORY.md 記載）と符合。バージョンドリフトあり。

**画面表示 — setWidget（今回、公式ドキュメント + 本リポジトリの実装コードの双方で確認）**:
WebSearch 経由で拾った要約（各種ミラー、(WebFetch) 相当）:
> `ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"])` — デフォルトはエディタ上に描画。
> `{ placement: "belowEditor" }` でエディタ下に描画。
> テーマ対応のファクトリ関数 `ctx.ui.setWidget("my-widget", (tui, theme) => {...})` で
> `render()`/`invalidate()` を持つカスタムコンポーネントを返せる。
> `ctx.ui.setWidget("my-widget", undefined)` でクリア。

**この事実は本リポジトリ内に実装として現存する**（直接一次資料、コード読み取り）:
`.claude/worktrees/graph-ideal/domains/dev/config/pi/extensions/yoki-graph-widget.ts`
（304 行、2026-09-13 コミット `8b79e554`）が実際に使っている API 呼び出し（コード内コメント、
0.84.4 の d.ts に対して検証済みと明記）:
```
ctx.ui.setWidget(key, (tui, theme) => Component, { placement })
```
component は pull-rendered（`render(width): string[]`）、`tui.requestRender()` で再描画要求、
`undefined` で除去、`session_shutdown` で teardown。fs.watch + 500ms coalesce + 5s セーフティ
tick でポーリング無し。**これは「動いた」実装であり、`session_start`/`session_shutdown` の
lifecycle フックと組み合わせて実際にレビュー系ランの進捗をエディタ下に出す用途で書かれ、
その後（milestone 4, commit `68b80d76`, 2026-09-23）ポリシー上の理由（自前実行系を持たない
という決定）で main から削除された**。widget 機構そのものが壊れていたという記録は無い。

**別プロセス/別セッションを起こす手段 — RPC モード（今回新規、(WebFetch)、`pi.dev/docs/latest/rpc`
と `rpc-commands`）**:
> "pi --mode rpc --no-session" — "Pi as a long-lived subprocess controlled through JSON records on
> stdin and stdout... language-independent integrations, process isolation, IDEs, and custom user
> interfaces."
セッション制御コマンド: `new_session`（`parentSession` 任意）、`switch_session`、`fork`（`entryId`
指定でコンテキストの特定地点から分岐）、`clone`。
**`new_session` はモデルを引数に取らない**——モデルは RPC プロセス単位（起動時の CLI フラグ）か、
セッション切替後に `set_model` で明示的に設定する必要がある。**「1 プロセス内で複数セッションに
別々のモデルを最初から割り当てる」直接の口は無い**（`[unverified]`: `set_model` の呼び出し
タイミングと確実性は未実測）。**別プロセスを複数起動すれば、プロセスごとに異なる `--model` を
渡すことで子ごとに別モデルは実現できる**（RPC ドキュメントの Python サンプルは 1 プロセス
1 プロンプトの subprocess spawn パターン）。

**エージェント拡張 API 自体の制約（今回、(WebFetch)、`pi.dev/docs/latest/extensions`）**:
> "Do not start processes, sockets, watchers, or timers in the factory because some invocations
> load extensions without starting a session." → 拡張の factory 内から直接子プロセスを spawn
> するのは非推奨（`session_start` からなら可、実際 yoki-graph-widget.ts も `session_start` で
> `fs.watch` を始めている）。
> "Extensions load in interactive, RPC, JSON, and print modes." — 拡張自体は RPC モードでもロード
> される。

**09-22 実機検証との整合**: tintinweb/pi-subagents 拡張（`SubagentWorkflow`）が確認した
「fresh context・並列・per-agent `model`」は拡張レイヤーの話で、今回確認した RPC モードは
pi 本体のレイヤー。両者は別の軸——RPC は「外部プロセスが pi を複数飼う」、tintinweb 拡張は
「pi 内部で Claude Code 形式のワークフローを回す」。Swarm の「親が裏で複数の pi インスタンスを
持つ」形は RPC 側、「1 つの pi セッション内で複数レーンを回す」形は拡張側、と別の実装面になる。

---

## 3. 09-13 の作業の残り — graph-ideal / yoki-graph / pi ボトムウィジェット（Phase 2b）

**現状（直接一次資料、`git branch -a` / `git worktree list` / `git log --all --oneline`）**:
- ブランチ `feat/graph-ideal-form` は**現存**（削除されていない）。
  ワークツリー `.claude/worktrees/graph-ideal`
  が `b020aca5`（`docs(pi): config links managed by link machinery`）でチェックアウト中。
- 関連ブランチも現存: `feat/graph-status-honesty`、`feat/graph-ui-polish`、`feat/omp-json-v3`、
  `feat/widget-session-scope`、`feat/pi-theme-unkai`。すべて main にマージされないまま
  ワークツリーとして残っている。
- `git log --all --oneline | grep -i graph` で 60 件超のコミットがヒットする（`top` viewer、
  widget、event fold、journal、agent-cli 等、2026-08 下旬〜09-13）。
- **main では milestone 4（commit `68b80d76`, 2026-09-23, 「retired hooks, loop, box, agent,
  graph」）で丸ごと削除済み**——`domains/dev/bin/yoki-graph`、`core/validation/test-yoki-graph.sh`
  （788 行）、`skills/yoki-graph/`（SKILL.md 含む一式）を含む。この削除は
  `2026-09-22-subagents-and-workflows-by-scale.md` の Consequences「yoki-graph（自前の実行系）と
  preflight.js は捨てる」と `2026-09-22-loop-native-goal.md`「実行系は jig に作らない」を実行した
  もの（決定記録から直接追跡できる）。

**「何ができていたか」（直接一次資料、`8b79e554` のコミット内容 + SKILL.md 全文読み取り）**:
コミット `8b79e554`「feat(graph): ideal-form phases 0-2b and pi link machinery」（2026-09-13、
merge、39 files, +4986/-42）で実装されていたもの:
- `yoki-graph/scripts/lib/graph/top.js`（500 行）+ `top-render.js`（481 行）+ `top-fold.js`
  （243 行）+ `top-estimate.js`（94 行）— **`yoki-graph top` というライブビューア**
  （既存の別コミット `1abbdb5f feat(graph): top renderer with column schema` の説明「kubectl-style
  top header, age, color」が示す通り、kubectl の `top`/`get pods -w` に近い列表示）。
- `widget-lines.js`（186 行）+ `domains/dev/config/pi/extensions/yoki-graph-widget.ts`（304 行）
  — pi のエディタ下ウィジェットに同じ描画ロジックを流用（上記 §2 で読んだファイル）。
- `agent-cli.js`（+94 行）、`events.js`（210 行、新規）、`journal.js`（+161 行）、`runner.js`
  （+74 行）— run の journal・event fold・agent 単位のライフサイクル管理。
- テストは 10 本の `*.test.js`（top-cli / top-estimate / top-fold / top-render / widget-lines /
  events / journal / lanes / results / runner）——**テスト付きで作り込まれていた**。
- SKILL.md（`core/skills/yoki-graph/SKILL.md`、この worktree で全文読み取り）によれば、対応する
  ワークフロー種別は `review` / `research` / `implement` / `preflight` / `design-review` /
  `acceptance` / `code-study` / `deliberate` / `stocktake` / `go-optimize`（10 種、カタログ生成式）。
  起動経路は「Claude Code 内はネイティブ Workflow tool、それを持たない harness（Codex の
  `codex exec`、omp）または CLI から直接触りたいときは `yoki-graph run <name> --backend
  <codex|omp> --args '{...}' --resume --json status` で同じスクリプトを回す」——**Codex と omp を
  ハーネス横断で束ねる自前の実行レイヤーがまさにここにあった**。

**Swarm との関係（判断はしないが、事実として）**: 「親が仕事を分け、裏で複数の作業役が動き、
kubectl 風の一覧で状態が見える」という形は、この repo で 2026-08 下旬〜09-13 にかけて
一度作り込まれ（`top` viewer・pi widget・journal・agent-cli・テスト一式）、2026-09-23 に
「自前の実行系を持たない」という決定（上記 2 本の decision）に基づいて main から明示的に
削除された。ブランチとワークツリー自体は残っているので、コードは失われていない。

---

## 4. 1 スロットの llama-server への同時投入 — キューか拒否か

**llama-server 本体（今回、(WebFetch) 要約 + WebSearch 要約、`ggml-org/llama.cpp`
`tools/server/README.md` および DeepWiki/HuggingFace ミラー、`[unverified]` な二次経由含む）**:
- `-np, --parallel N`（既定 `-1` = auto）でスロット数を決める。`-cb, --cont-batching`
  で continuous batching。
- サーバーは内部に `queue_tasks`（実行可能）と `queue_tasks_deferred`（スロット待ち）の
  2 つのキューを持つ。スロットが埋まっている間に届いたリクエストは **`queue_tasks_deferred` に
  積まれ、拒否はされない**。スロットが空くと deferred から昇格する。
  Prometheus メトリクス `llamacpp:requests_deferred`（"Number of requests deferred"）が
  この状態を直接示す。
  → `--parallel 1` の構成（このリポジトリの `deterministic` tier、決定記録
  `2026-09-27-deterministic-falls-back-to-the-mac.md` が明記する「one slot with a 65,536-token
  context」）では、**複数リクエストは順番待ちで直列化される**。エラーにはならないが、
  並列に投げても実際には 1 本ずつしか進まない。
- README.md 直接一次資料からは「拒否 vs キュー」の明文は取得できず（WebFetch が「見つからない」
  と回答）、上記の結論は WebSearch 経由の二次要約（DeepWiki 等）に依拠——**`[unverified]`
  として一段弱い**が、`requests_deferred` メトリクスの存在自体は README.md の直接一次資料で
  確認済み（09-22 の実機検証記録には出てこない新規事実）。

**LiteLLM 側（今回、直接 WebFetch、`docs.litellm.ai/docs/routing`）**:
> "Limit the max concurrent calls made to a deployment. Useful in high-traffic scenarios."
```yaml
model_list:
  - model_name: gpt-5.6-terra
    litellm_params:
      model: openai/gpt-5.6-terra
      api_key: os.environ/OPENAI_API_KEY
      rpm: 2 # derives max_parallel_requests=2
```
(WebFetch の要約が付け加えた解釈、原文一致度は未検証)「上限に達したリクエストは待たされず
即座に 429 で失敗する。他の健全な deployment へのフォールバック対象として扱われる」
→ **LiteLLM 自身は deployment ごとの同時数制限を持てる（`max_parallel_requests` か `rpm` で
間接指定）が、上限超過時の挙動は「キュー」ではなく「即時 429」**。これは llama-server 自身の
「キューする」挙動と対照的——**2 層構成**（LiteLLM → llama-server）では、LiteLLM 側で
`max_parallel_requests` を設定していれば早い段階で 429 になり得るが、**設定していなければ
LiteLLM はそのまま素通しし、llama-server 側の deferred queue が実質的な直列化を担う**。

**このリポジトリの現状設定（直接一次資料、`home/shared/litellm/config/config.yaml` 36-68 行、
`harness/policy/models.json`・`tiers.json` も確認）**:
`deterministic` の 2 エントリ（order 1 = Linux desktop 実機、order 2 = Mac LM Studio）には
`rpm` も `max_parallel_requests` も**設定されていない**。`model_info` にあるのは
`allowed_fails`/`cooldown_time`（order 1）と `disable_background_health_check`（order 2）のみ。
→ **今の構成のまま Swarm の複数ワーカーが `deterministic` tier に同時にリクエストを出すと、
LiteLLM は 429 せず素通しし、実際の直列化は llama-server の 1 スロット・deferred queue が
黙って担うことになる**（体感は「並列のはずが 1 本ずつ進む」）。LM Studio 側（order 2、Mac の
フォールバック）の同時実行の扱いは今回未確認 `[unverified]`。

---

## 5. herdr — 外から pane を作って中身を出す API

**バージョン**: この機体 `herdr --version` → **0.7.5**（直接一次資料）。

**pane API（今回、直接一次資料、`herdr pane --help` / `herdr agent --help` / `herdr api --help`
のローカル実行）**:
```
herdr pane split / read / send-text / send-keys / wait-output / run / close / swap / move / resize
herdr agent list / get / read / send-keys / prompt / rename / focus / wait / attach / start / explain
herdr api snapshot / schema
```
- `herdr agent start <NAME> --kind <KIND> --pane <ID> [-- ARGS...]` の `--kind` の
  possible values に **`pi` と `omp` の両方が含まれる**（他に `claude`, `codex`, `gemini`,
  `cursor`, `devin`, `agy`, `cline`, `mastracode`, `opencode`, `copilot`, **`kimi`**, `kiro`,
  `droid`, `amp`, `grok`, `hermes`, `kilo`, `qodercli`, `maki`）。**`kimi` も既にサポート対象に
  含まれている**（この事実は Kimi Code 型 Swarm の文脈で直接関連する）。
- `herdr agent list` / `herdr agent get <target>` が実行中エージェントの一覧・単体情報を返す
  （フィールドの詳細は `--help` からは取得できず、`herdr api schema` で確認できる可能性が
  あるが今回は未実行 `[unverified]`）。
- `herdr agent wait` — 指定した状態に達するまで待つ、`herdr agent prompt` — 実行中の agent に
  プロンプトを送る。**pane の中身を外から作り、進捗を監視し、指示を送り込む一連の操作が
  socket API 経由で揃っている。**
- WebSearch 経由の要約（(WebFetch) 相当、herdrdev/herdr の SKILL.md 由来）:
  > "The local Unix socket lets agents create workspaces, split panes, spawn helpers, read output,
  > and wait for state changes."
  > `herdr pane split 1-1 --direction right` / `herdr pane split --current --direction right --cwd
  > "$PWD" --no-focus`
  これは herdr 自身のリポジトリの SKILL.md からの二次要約であり、原文の逐語確認はしていない。

**未確認**: `herdr agent list` の出力フィールド（コスト・トークン数など omp Agent Hub 相当の
情報を持つか）、herdr の「kimi」統合が実際にどの程度動くか（検知のみか操作までか）、
herdr の GitHub 上の star 数・保守状況（`gh api` 到達不能のため未取得）。

---

## 確認できなかったこと（明示的な「no precedent found」相当）

- omp 18.0.4 → 18.3.4 の変更点の一次資料（CHANGELOG.md raw URL が 404、releases ページの
  要約のみ、(WebFetch) の二次情報）。
- omp の CHANGELOG.md 自体の所在（パスを変えて再探索していない）。
- pi の RPC モードで「1 プロセス内の複数セッションに最初から別モデルを割り当てる」直接の口が
  本当に無いのかの確定（`set_model` のタイミング・確実性が未実測）。
- llama-server の `--parallel 1` 時の挙動について、README.md 一次資料からの直接引用
  （拒否でなくキューという結論は WebSearch 経由の二次要約に依拠、`[unverified]` 気味）。
- LiteLLM の 429 即時拒否という挙動の逐語原文（WebFetch の要約に含まれる記述で、
  `docs/routing` 本文そのものの引用ではない）。
- herdr の `agent list`/`get` が返すフィールドのスキーマ（`herdr api schema` は未実行）。
- herdr の GitHub リポジトリの star 数・最終 push・保守状態（api.github.com 到達不能のため）。
- Mac の LM Studio（`deterministic` order 2）が複数同時リクエストをどう扱うか
  （キュー・拒否・並列処理のいずれか）は今回未調査。
- gh api / gh search 系はこのセッションのサンドボックスで TLS 証明書検証エラーにより
  全滅しており、in-the-wild 系（herdr の採用実態、他の swarm 実装の star 数等）の裏取りが
  一切できていない——他の担当のレーンでカバーされている前提。
