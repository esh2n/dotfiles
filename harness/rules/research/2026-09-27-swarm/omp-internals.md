# omp（oh-my-pi）内部実装調査 — task / Agent Hub / 拡張API / 既知バグ

対象コミット: `can1357/oh-my-pi` タグ `v18.3.4`、HEAD `dff728c572a8c4c29016549b6e407c4550fcdac6`（2026-09-27T06:30:39+02:00）。
方法: `git clone --depth 1 --branch v18.3.4 https://github.com/can1357/oh-my-pi.git` を
`$TMPDIR` 配下に shallow clone し、ソース・同梱 docs/*.md・CHANGELOG.md を直接読み取り。
GitHub issue 検索は `api.github.com` に対する未認証 `curl`（`gh` は本セッションでは未使用、指示通り）。
以降「一次資料」= このクローンのファイル読み取り、「issue」= 未認証 REST API 実測。
判断はしない。

---

## 0. 手元 Mac の omp 版と最新版の差

- 手元（Nix store, `/nix/store/mc8zaaarq4wxm4s6sxi220r4wpj1k3ww-omp-18.2.11/`）: **18.2.11**（2026-09-23 リリース）。
  `npm view` は `registry.npmjs.org` への到達がサンドボックスで403、`~/.bun`・mise global 配下に
  oh-my-pi の package.json は無し。Nix store のディレクトリ名がバージョンの一次資料。
- 最新: **18.3.4**（2026-09-27、今日）。
- 18.2.11 → 18.3.4 は 6 バージョン・4 日分、うち **18.3.0（2026-09-24）が破壊的変更を含む**
  （`packages/coding-agent/CHANGELOG.md:139-184`）:
  > "The `hub` tool is deprecated; use `wait`, `write`, and the `proc://` protocols instead."
  > "The `Launch` configuration group has been renamed to `Services`."
  **注意: この `hub` は「Agent Hub」（Alt+A の TUI ロースター画面）とは別物。** 廃止されたのは
  モデル呼び出し可能な `hub` **ツール**で、Agent Hub という TUI 機能自体は 18.3.4 でも健在
  （後述）。この二つの混同を避けること。
  - 18.3.0 で `wait`・`proc://`・`agent://` write ターゲットが新設され、`task` の完了待ち・
    子への操縦・background job/service 管理がこの3経路に統合された。
  - 18.3.3（`packages/coding-agent/CHANGELOG.md:20-52`）で `task` の `complexity` フィールドが
    追加され、18.3.4 で即座に `solutionSpace`（後述）に置き換えられている——**2リリース連続で
    「子にどれだけ考えさせるか」の入力欄が作り直されている**。
  - 18.3.4 の Fixed: "Fixed agents looping for hours when every turn spends the whole output
    limit on reasoning" — 直近まで実運用で踏まれていた不具合。
  - `omp 18.2.11` は issue #13058（後述、Agent Hub のコンテキスト窓バグ）の再現環境そのもの
    （macOS arm64, Homebrew）——**手元の版がまさにこのバグを踏む版**。

---

## 1. task ツール — 起こし方・maxConcurrency 超過・モデル/深さ指定・作業ディレクトリ

一次資料: `docs/tools/task.md`（同梱ドキュメント、ソース参照付き）、
`packages/coding-agent/src/task/index.ts`、`packages/coding-agent/src/task/executor.ts`、
`packages/coding-agent/src/task/parallel.ts`、`packages/coding-agent/src/task/settings.ts`、
`packages/coding-agent/src/sdk.ts`。

### 1-1. 同期 / 裏起動

- `async.enabled` 設定（`packages/coding-agent/src/tools/settings.ts:846-856`）: **既定 `true`**。
  true のとき、非 `blocking` な spawn は `AsyncJobManager` 経由の裏ジョブになり、ツール呼び出しは
  即座に `Spawned agent <id> (job <jobId>).` を返して戻る（`docs/tools/task.md` Outputs節）。
  `async.enabled=false` か、呼び出したエージェント型の frontmatter が `blocking: true` のときだけ
  同期実行（呼び出し元がブロックされる）。バンドル済みエージェント（`scout`/`reviewer`/
  `security-reviewer`/`task`/`sonic`）はどれも `blocking: true` を宣言していない
  （`docs/tools/task.md` 冒頭）——**既定では task 経由の子は全部裏で並列に動く**。
- 1回のツール呼び出しで `tasks[]` バッチ配列（`task.batch` 既定 on）を渡せば、複数の子を
  一括で fan-out できる。バッチは共有背景 `context`（必須）を全員の system prompt に注入する。

### 1-2. `task.maxConcurrency` 超過分の扱い — 待ち行列（拒否ではない）

- `task.maxConcurrency` の既定値は **32**（`packages/coding-agent/src/task/settings.ts:223-226`、
  `default: 32`）。`0` は無制限（`Semaphore` コンストラクタが `Number.POSITIVE_INFINITY` に変換、
  `packages/coding-agent/src/task/parallel.ts:159-162`、issue #3305 の修正として明記）。
- 実体は 1個のプロセス内 `Semaphore`（`packages/coding-agent/src/task/parallel.ts:150-207`）。
  `acquire()` は空きがなければ内部 FIFO キュー (`#queue: Array<() => void>`) に積まれて
  `Promise` として待つ——**エラーにも拒否にもならず、順番が来るまで無期限に待つ**
  （`AbortSignal` を渡していれば中断可）。
- **重要な事実: 半導体待ち中の spawn は Agent Hub のロースターに一切現れない。**
  同期パス (`packages/coding-agent/src/task/executor.ts:500-560`、`#runSyncSpawns`) も
  非同期ジョブ本体 (`packages/coding-agent/src/task/index.ts:1125-1230`) も、
  **`semaphore.acquire()` が解決した後に初めて** `runSubprocess()` → `createAgentSession()` を
  呼ぶ。`AgentRegistry.global().register(...)`（Hub がロースター行を作る唯一の書き込み元）は
  `createAgentSession` 内 (`packages/coding-agent/src/sdk.ts:3806-3818`) にあり、
  この呼び出し自体が semaphore 獲得後のコードパスにしか無い。つまり
  **待ち行列に積まれている間、その子エージェントの id は Agent Registry に存在せず、
  Agent Hub にも pinned Subagents block にも一切表示されない**。
- 一方、非同期（裏実行）の task spawn は `AsyncJobManager.register(...)` 呼び出し時に
  `queued: true` を渡している（`packages/coding-agent/src/task/index.ts:1290`）。これは
  ジョブ管理側（`/jobs` コマンド・`read proc://`）には即座に見える——ただし：
  - `AsyncJob.status` は常に最初から `"running"`（`packages/coding-agent/src/async/
    job-manager.ts:355`、`status: "running"` を無条件セット）。`queued` は**別のブール
    フィールド**であり、`markRunning()`（semaphore 獲得後にジョブ本体が呼ぶ、
    `packages/coding-agent/src/task/index.ts:1160`）が呼ばれるまで `true` のまま。
  - **しかし `/jobs` の描画コード (`packages/coding-agent/src/modes/controllers/
    command-controller.ts:1770-1780`, `formatJobStatus`) は `job.status`
    （running/completed/cancelled/failed の4値）しか見ておらず、`job.queued` フラグは
    どこにも表示されない。** ユーザー向けには「semaphore待ち」と「実行中」の区別が
    `/jobs` 上で文字通り見分けがつかない（両方 "running" と表示される）。
  - `queued` フラグの唯一の用途は内部の容量計算（`AsyncJobManager.atCapacity`,
    `job-manager.ts:308-315`: `job.status === "running" && !job.queued` の集計）——
    表示用ではなく admission-control 用。
- **結論: overflow は待ち行列に入る（拒否ではない）が、「Queued」という状態は omp のどの
  ユーザー向け画面にも存在しない。** Kimi Code 型の画面が示す STATUS 列の "Queued" 値に
  直接対応するものは無い——内部には `queued:boolean` という同義のデータはあるが、
  どのレンダラーもそれを読んでいない。

### 1-3. AsyncJobManager 自身の同時実行上限（`task.maxConcurrency` とは別軸）

- `DEFAULT_MAX_RUNNING_JOBS = 15`（`packages/coding-agent/src/async/job-manager.ts:41`）。
  `register()` はこの上限に達すると**その場で例外を投げる**
  （`Background job limit reached (${maxRunningJobs}). Wait for running jobs to finish or
  cancel one.`、`job-manager.ts:341-345`）——**待たせずに即座に失敗させる**、`Semaphore` とは
  正反対の挙動。ただし `queued: true` のジョブ（task spawn）は `atCapacity` の集計対象外
  （`!job.queued` 条件）なので、task 経由の子がこの15件枠を圧迫することは無い。
  この15件枠が実際に効くのは **bash/eval の裏実行ジョブ**（`queued` を立てない種別）。
  Swarm で `task` 以外の裏ジョブ（自動バックグラウンド化した `bash` 等）を大量に併走させると、
  `task.maxConcurrency=32` より先にこの15件枠で失敗する経路がある。

### 1-4. 子ごとのモデル指定・thinking の深さ指定

- モデル決定順（`docs/task-agent-discovery.md` "Model and structured-output precedence"、
  一次資料 `packages/coding-agent/src/task/executor.ts`）:
  1. `task.agentModelOverrides[agentName]`（設定ファイル、エージェント名をキーに上書き）
  2. エージェント frontmatter の優先順位付き `model` リスト（CSV/配列、`@role` エイリアス展開可）
  3. 親セッションの現在モデル → 親の既定モデルへのフォールバック
- ロール別名: `~/.omp/agent/config.yml` の `modelRoles.<role>: <selector>[:effort]` を
  frontmatter の `model: "@role"` から参照。`/model` の Roles ビューで GUI 編集可。
- 効果（thinking effort）の per-spawn 指定は **既定オフ**: `task.enableEffort` は
  `default: false`（`packages/coding-agent/src/task/settings.ts:210-212`）。オフのときは
  ワイヤスキーマから `effort` フィールド自体が消える（モデルに見えない）。オンにすると
  各 task item に `effort: "lo"|"med"|"hi"` を持たせられ、解決済みモデルが対応する最低/中間/
  最高レベルにマップされる（`task.maxEffort` で天井、既定 `max`）。
- **18.3.4 の破壊的変更**: `task` の入力フィールドが `complexity`（18.3.3 で新設）から
  `solutionSpace`（自由記述: 「どれだけ解が絞られているか」）に置き換わった
  (`packages/coding-agent/CHANGELOG.md:9-10`)。`auto` thinking classifier はこの
  `solutionSpace` テキスト**だけ**を見る——`task` 本文の分量は見ない、との明記
  (`docs/tools/task.md` Inputs 表、`solutionSpace` 行: "Volume of work does not widen it")。
- 深さ制御は `task.maxRecursionDepth`（既定 `2`）。上限に達すると子から `task` ツール自体を
  剥奪する。

### 1-5. 子の作業ディレクトリ — 選べるのは「親と同じ」か「隔離ワークスペース」の二択

- 既定（`isolated` 未指定 or `false`）: **非隔離 spawn は常に親の cwd をそのまま渡す**
  (`docs/tools/task.md` Flow 11: "Non-isolated spawns call `runSubprocess(...)` directly
  with parent cwd")。`RunSubprocessOptions.cwd: string` は必須フィールドで、呼び出し元は
  自由な任意ディレクトリを指定するワイヤ入力を持たない（task item のスキーマに `cwd` は無い）。
- `isolated: true`（`task.isolation.enabled` かつ plan mode オフのときだけワイヤに存在する
  フィールド）を立てると、隔離バックエンド（`auto`/`apfs`/`btrfs`/`zfs`/`reflink`/
  `overlayfs`/`projfs`/`block-clone`/`rcopy`、`isolation.backend` で選択、PAL がフォール
  バックリストを歩く）でワークスペースを作り、そこで実行後に**パッチ取り込み**か
  **`omp/task/<id>` ブランチへコミットしてチェリーピック**のどちらかで親に合流する。
  隔離実行は完了時に破棄され、再開不可（`isolated agents are torn down at completion
  — not revivable`）。
- **つまり「選べる」の実態は二値スイッチ（隔離 on/off）であって、任意のディレクトリを
  子ごとに割り当てる機能ではない。**

---

## 2. Agent Hub — 列を作るコード・状態の種類・進捗値

一次資料: `docs/agent-hub.md`（同梱ドキュメント）、
`packages/tui/src/overlays/agent-hub-types.ts`、`agent-hub-renderer.ts`、
`agent-hub-projection.ts`、`packages/coding-agent/src/registry/agent-registry.ts`。

### 2-1. 状態の種類 — 4値のみ、"queued" は無い

- `AgentStatus = "running" | "idle" | "parked" | "aborted"`
  (`packages/tui/src/overlays/agent-hub-types.ts:7`、`agent-registry.ts` が re-export)。
- 遷移規則（`agent-registry.ts` `setStatus()`）: `aborted` は終端で戻れない
  (`ref.status === "aborted"` は `status === "aborted"` 以外を拒否)。`running` に戻ると
  `lifecycle` がリセットされる（フォローアップ/wake ターン用）。`idle`→`parked` は
  `task.agentIdleTtlMs`（既定 `420_000` ms = 7分、`<=0` で無効化）経過後に
  `AgentLifecycleManager` がタイマーでパークする。
- **「終わったが親が未読」は独立した状態としては存在しない**——`idle` が「終わって
  復帰待ち」の唯一の状態で、未読の概念は別軸の `IrcBusLike.unreadCount(id)`
  （agent-hub-types.ts 末尾）という**メッセージ数カウンタ**として表現される。
  ロースターの行は「status (running/idle/parked/aborted), ... and unread IRC count」
  として**別々の列**で両方出す（`docs/agent-hub.md` Roster節）——ステータス値そのものに
  "unread" は無い。

### 2-2. 列を作るコード

- ロースター行の中核指標は `AgentMetricsSummary`
  (`agent-hub-types.ts:9-18`): `tokens, requests, tools, cost, durationMs,
  durationKind?("active"|"span"|"unknown"), contextTokens?, contextWindow?`。
  `progressMetrics()`（`agent-hub-projection.ts:27-58`）が進行中セッションの生 progress から、
  `readSessionMetrics()` が完了/parked セッションの `getSessionStats()` から作る——
  **どちらも「タスク完了率」の概念は持たない**。数値化された進捗は
  トークン/リクエスト/ツール呼び出し/コスト/経過時間のみ。
- `STATUS_ORDER = { running: 0, idle: 1, parked: 2, aborted: 3 }`
  (`agent-hub-projection.ts:19`) — ロースターのデフォルトソート順。
- 実際の "PROGRESS" 相当の帯グラフは **コンテキスト窓の使用率バー**であって
  タスク進捗ではない: `contextGauge(tokens, window)`
  (`packages/tui/src/overlays/agent-hub-renderer.ts:180-193`) が
  `renderProgressBar(ratio, 10, ...)` を使い `━/─` のバー + `tokens/window NN%` を描画する。
  「このタスクは何%終わったか」を示す値は omp のどこにも無い——あるのは
  「このモデルの文脈窓を何%使い切ったか」だけ。
- ヘッダ行のテーブル列（`agent-hub-renderer.ts` の別関数、cost/duration/req/tools/tok/age、
  6列固定幅レイアウト、コード上の列幅は `{width:8}`,`{width:13}`,`{width:8}`,`{width:9}`,
  `{width:8}`,`{width:8}` と直書き）はまさに **Cost / Duration / Req / Tools / Tokens / Age**
  の6列——お手本の NAME/MODEL/EFFORT/STATUS/PROGRESS/IDLE/AGE/NOTE とは列構成が異なる
  （NAME・MODEL・STATUS は別の行要素として表示され、この関数の6列には含まれない）。

### 2-3. Agent Hub は「常時表示」ではなく開閉式オーバーレイ

- `Alt+A`（`app.agents.hub`）または `Ctrl+S`（`app.session.observe`、レガシー名）で
  開閉するオーバーレイ (`docs/agent-hub.md` "Open the Hub")。**入力欄の下に常駐する
  ものではない**——お手本の「入力欄の下に常に一覧を出す」とは表示モデルが違う
  （常駐する方は次節の Subagents block）。

---

## 3. 「Subagents block」（入力欄上の pinned jump list）

一次資料: `docs/agent-hub.md` "Pinned jump list and click to focus"、
`packages/coding-agent/src/modes/interactive-mode.ts:670-846`（実装コード）。

- 設定 `display.pinnedAgents`: `"collapsed"`（既定、数行+展開ボタン）/ `"full"`（全表示）/
  `"off"`（非表示）。
- **表示対象は "active" な subagent セッションだけ**:
  `isHudSubagent(session) = session.kind === "subagent" && session.status === "active"`
  (`interactive-mode.ts:670-672`)。idle/parked/aborted の子はこの pinned block には**出ない**
  ——Agent Hub の全4状態ロースターとは別物で、稼働中のものだけの短い一覧。
- 折りたたみ規則 `layoutPinnedHud()` (`interactive-mode.ts:757-776`): 3件以下ならそのまま
  全件表示、4件以上なら collapsed時は先頭3件+展開行、expanded時は全件+折りたたみ行
  (`SUBAGENT_HUD_COLLAPSED_LIMIT = 3`)。
- **各行の内容**（`renderSubagentHudLines()`, `interactive-mode.ts:785-846`）: ドット記号 +
  （設定で有効なら）モデルバッジ + エージェントID + エージェント型バッジ + 説明文または
  タスクプレビュー文——**列ではなく1行のテキスト**。STATUS/EFFORT/PROGRESS/IDLE/AGE/NOTE
  のような個別カラムは無く、状態を示す記号（実行中を示す緑ドットのみ）とテキストのみ。
- `tui.mouse` 有効時はこの一覧・Agent Hub のカードともクリックでフォーカス可能
  (`docs/agent-hub.md`)。

**要約: omp の「常時見える一覧」は Subagents block で、これは稼働中のみを一行テキストで
並べる簡易ジャンプリストであり、お手本の多列常駐テーブルとは形が違う。多列・全状態
（parked/aborted含む）の詳細ロースターは Agent Hub というオーバーレイ側にしかなく、
それは常時表示ではなく Alt+A で開閉するモーダル。**

---

## 4. 拡張 API — 常駐ウィジェットと子の状態購読

一次資料: `docs/extensions.md`、
`packages/coding-agent/src/extensibility/extensions/types.ts`、
`packages/tui/src/chat/extension-types.ts`、
`packages/coding-agent/src/session/agent-session-types.ts`。

### 4-1. 常駐ウィジェット表示 API — `ctx.ui.setWidget`

- シグネチャ（`extensibility/extensions/types.ts:270`）:
  `setWidget(key: string, content: ExtensionWidgetContent, options?: ExtensionWidgetOptions): void`
- `ExtensionWidgetContent = string[] | ExtensionUiComponentFactory | undefined`
  (`packages/tui/src/chat/extension-types.ts:9`)。
- `ExtensionUiComponentFactory = (tui: TUI, theme: Theme) => ExtensionUiComponent`、
  `ExtensionUiComponent = Component & { dispose?(): void }`（同ファイル 5-7行）——
  `Component` は pull-rendered（`render(width): string[]`）想定。
- `ExtensionWidgetOptions.placement?: "aboveEditor" | "belowEditor"`
  （同ファイル `WidgetPlacement` 型、`types.ts:207-209`）。既定は `aboveEditor`
  （`docs/extensions.md:673`「デフォルトはエディタ上に描画」）。
  文字列配列を渡す場合は **10行に切り詰められる**（同 673行）。
- `undefined` を渡すとクリア。再描画は `Component` 側が持つ `requestRender()`
  相当のコールバック（`tui` 引数経由、実装は本リポジトリの旧 `yoki-graph-widget.ts` が
  `tui.requestRender()` を使っていたのと同じ契約——今回のクローンでも
  `Component`/`TUI` 型定義自体は変わっていない）。
- **再描画のトリガーは自前**: 拡張側が `fs.watch`・タイマー・イベントハンドラの中で
  明示的に `tui.requestRender()` を呼ぶ必要がある。omp が子の状態変化を検知して
  自動的にウィジェットを再描画してくれるわけではない（後述4-2の通り、そもそも
  そのためのイベントが無い）。

### 4-2. 子の状態を購読する API — 一次資料からは「無い」に近い

- 拡張のイベント一覧（`docs/extensions.md` "Event surface"）のうち Subagent 関連は
  **`before_subagent_spawn` の1個だけ**（`docs/extensions.md` "Subagent lifecycle" 節、
  行番号 377-381付近）:
  > "Fires in the parent session exactly once per spawned child (`task`, eval `agent()`,
  > workpool workers), at dispatch before the child resolves its model"
  ペイロードは `{ agent, invocationKind, modelRole, patterns, spawnKey }` で、
  ハンドラは `model`（ルーティング先の差し替え）・`block`（拒否）・`note`（UI表示用の理由文）
  を返せる。**これは起動時1回だけのフックであり、その後の進捗・完了・状態遷移は
  一切通知しない。**
- `task:subagent:event` / `task:subagent:progress` / `task:subagent:lifecycle` という
  イベント名は `docs/tools/task.md` "Side Effects" 節にあるが、これは**内部イベントバス**
  （`packages/coding-agent/src/task/executor.ts` 内で `EventBus` に emit されるだけ）であり、
  `docs/extensions.md` の Event surface 一覧には載っていない——**拡張の `pi.on(...)` から
  直接購読できるドキュメント上の経路は無い**（`[unverified]`: このバスに拡張から直接
  アクセスする非公式な手段が無いかまではソースの全走査をしていない。ドキュメント上の
  正式な拡張イベントとしては存在しないことのみ確認済み）。
- `ctx.getAsyncJobSnapshot()`（`extensibility/extensions/types.ts:460`）はポーリング用の
  読み取り専用スナップショットだが、返す型 `AsyncJobSnapshotItem` は
  `Pick<AsyncJob, "id" | "type" | "status" | "label" | "startTime" | "endTime" | "agentId">`
  （`packages/coding-agent/src/session/agent-session-types.ts:73-76`）——**`queued`・
  コスト・トークン数・モデル名は含まれない**。ジョブの生死と種別と開始/終了時刻しか
  拡張からは読めない。
- `ExtensionContext.agent`（`docs/extensions.md` Handler context 節）は「このハンドラが
  今動いているセッション自身」のロール（`{kind, id, name, depth, parentId}`）を返すだけで、
  **他の全エージェントを横断するレジストリではない**——子の視点では自分のことしか
  分からず、親の視点でも「今動いている全ての子の一覧」を返す拡張APIは見つからなかった。

**結論: omp の拡張APIには、①ウィジェットを常時表示する仕組みは揃っている
（`ctx.ui.setWidget`、実装済みで枯れている）が、②子の状態・コスト・トークン・モデル・
経過時間をイベントやポーリングで購読するAPIは存在しない（起動時1回のフックと、
ステータス種別すら持たない粗いジョブスナップショットのみ）。①と②を組み合わせて
Kimi Code 型の常駐ウィジェットを作るには、②が無いため、拡張側が `AgentRegistry`
相当のデータに別経路（未公開の内部API、またはセッションファイルの直接読み取り）で
アクセスする必要があり、それは今回のドキュメント調査の範囲では確認できなかった。**

---

## 5. 子の結果を親が受け取る仕組み

一次資料: `docs/tools/task.md` Outputs / Flow 節。

- 同期呼び出し: ツール呼び出しの戻り値にそのまま結果（`SingleResult[]`）が入る。
- 裏実行（`async.enabled=true`）: ツール呼び出しは即座に `Spawned agent <id> (job <jobId>).`
  を返し、**子が終わった時点で「async-result injection」として親の会話に後から挿入される**
  （`docs/tools/task.md` Outputs節: "each final result arrives later as an async-result
  injection into the parent conversation"）。
- 「未読」の概念: `write agent://<id>` で子にメッセージを送るのがIRC的な仕組みで、
  `IrcBusLike.unreadCount(id)` が未読メッセージ数を保持——Agent Hub のロースターの
  「unread IRC count」列がこれを表示する。**ただし「子の作業が完了して親がまだ見ていない」
  という状態そのものは、この unread カウントとは別物**（子完了は `idle` ステータス+
  async-result injection のペアで表現され、親がそれを読んだかどうかを追跡する専用の
  フラグはロースターのデータ構造に見当たらない——`idle` は「完了して復帰可能」を表す
  だけで、「親が結果を確認済みか」は別軸として実装されていない）。
- 複数の子がほぼ同時に終わると、親はその都度モデルターンを起こす——これが
  issue #13096（後述）の指摘そのもの: 5並列 task が数秒差で終わると親は最大5回起こされる。

---

## 6. 既知の不具合 issue（直近3か月、task・Agent Hub・subagent関係）

`api.github.com` への未認証 `curl` で `search/issues` を実行（2026-09-27時点のスナップショット）。

### Agent Hub / hub 関連

| # | 日付 | 状態 | 内容 |
|---|---|---|---|
| [#13089](https://github.com/can1357/oh-my-pi/issues/13089) | 2026-09-24 | open | 18.3.0 で `hub` **ツール**が削除されたが、`LEGACY_BUILTIN_TOOL_NAME_ALIASES` に何のエイリアスも追加されず、設定・エージェント定義に残った `hub` 参照が警告なしに黙って無効化される。実測コマンド付き（`omp -p ... --config <(...)` が警告無しで通る）。ラベル `enhancement, ux, tool, triaged` |
| [#13165](https://github.com/can1357/oh-my-pi/issues/13165) | 2026-09-24 | open（`wontfix`ラベル） | Agent Hub で子にフォーカス後 Esc を押すと、公式の挙動説明（"Esc returns to main"）に反して main セッションではなくその子に留まる。再現手順あり |
| [#13066](https://github.com/can1357/oh-my-pi/issues/13066) | 2026-09-24 | open | "keep hub roster stable with new agents on top"（ロースターの並び順が新規エージェント追加で不安定になる） |
| [#13058](https://github.com/can1357/oh-my-pi/issues/13058) | 2026-09-24 | open | **omp 18.2.11（macOS arm64、手元と同一版）** で、子のモデルが fallback チェーンで
切り替わった後もAgent Hub のコンテキスト窓使用率バー（`contextGauge`、上記2-2節）が
古いモデルの窓サイズのまま——ラベルは新モデルに更新されるが使用率%が壊れる。
再現手順・実際の表示例付き（`64K/256K` のままになるべきところ `64K/500K` にならない、
という具体的な誤り）。ラベル `bug, tui, prio:p2, agent, triaged` |
| [#13061](https://github.com/can1357/oh-my-pi/issues/13061) | 2026-09-24 | open | 上記13058に対応する修正PR（未マージ、open） |
| [#13088](https://github.com/can1357/oh-my-pi/issues/13088) | 2026-09-24 | closed | "keep agent hub usage across subagent follow-up turns"（修正済み） |

### task / async job 関連

| # | 日付 | 状態 | 内容 |
|---|---|---|---|
| [#13096](https://github.com/can1357/oh-my-pi/issues/13096) | 2026-09-24 | open（`proposal`） | **数値付き**: 直近24時間のマルチエージェント作業で176件の `task` バッチが
21,461モデルターンに及んだ。「5並列の子が数秒差で終わると親は最大5回起こされ、
その都度キャッシュ済みプレフィックス全体を再読込する」。30日ベースラインで
「ツール呼び出しターンの85.9%がちょうど1個のツールしか呼ばない」——つまり多くの
wake ターンは実質何も決めていない、という自己計測付きの提案 issue |
| [#13313](https://github.com/can1357/oh-my-pi/issues/13313) | 2026-09-25 | open（`duplicate`ラベル） | `wait` ツールが「launch-completion owner (agent id) が session-id の
staleness チェックと一致しない」ため恒久的にスキップされ続けるバグ。サービス終了後の
完了通知が二度と配送されない、プロセスを殺しても直らない、という報告。3ファイルの
該当行まで特定した詳細な原因分析付き |
| [#9916](https://github.com/can1357/oh-my-pi/issues/9916) | 2026-08-27 | closed（`duplicate`） | **数値付きの負の証拠**: Linux x64・30GiB RAM機で、12個のomp プロセス合計RSS 3.7GB、
上位セッションが885MB/792MB/759MB/678MB/362MB/282MB、**14日間で25回のkernel OOM kill**。
「サブエージェントは別プロセスではなく同一プロセス内の `AgentSession` オブジェクトで、
`task.maxConcurrency` は**件数だけを見るキャップでありメモリを一切見ていない**」と
本文が明記。リークは見つからず「定常状態コストの高さ + admission control の不在」と結論 |
| [#7826](https://github.com/can1357/oh-my-pi/issues/7826) | 2026-08-06 | open | セルフホストvLLM上の zai-org/GLM-5.2-FP8 で「頻繁にエージェント死のループ」——
自己ホスト型バックエンド（この家の llama-server 相当の構成）での不具合、未解決のまま |
| [#5207](https://github.com/can1357/oh-my-pi/issues/5207) | 2026-07-11 | open | "Cross-process per-provider/model concurrency limits with fallback"
（プロセス横断でのモデル別同時実行数制御は無い、という機能要求。1スロットバックエンドへの
複数omp/複数拡張からの同時アクセスに関係） |
| [#3749](https://github.com/can1357/oh-my-pi/issues/3749) | 2026-06-28 | closed | 過去の重大バグ: "Provider concurrency semaphore held for entire agent lifetime, not
just LLM request — causes deadlock with nested subagent spawns"（ネストしたサブ
エージェント起動でデッドロックしていた。修正済みだが、並行制御まわりのバグの
蓄積を示す履歴として記録） |
| [#3305](https://github.com/can1357/oh-my-pi/issues/3305) / [#3306](https://github.com/can1357/oh-my-pi/issues/3306) / [#3307](https://github.com/can1357/oh-my-pi/issues/3307) | 2026-06-23 | closed | `task.maxConcurrency: 0`（無制限のはず）が実際には直列化してしまうバグとその修正
（現在の `normalizeConcurrencyLimit` 実装 (`parallel.ts:150-152`) はこの修正の結果） |

### 費用インシデント（負の証拠として同じ重みで）

| # | 日付 | 状態 | 内容 |
|---|---|---|---|
| [#7661](https://github.com/can1357/oh-my-pi/issues/7661) | 2026-08-04 | closed（`[CRITICAL]`ラベル付きタイトル） | **「opencode-goプロバイダしか設定していないのに、AWS Bedrock-mantle
（openai-gpt-5.5）に537回呼ばれ$83.66課金された」**。`~/.omp/agent/config.yml` の
`modelRoles` は全て `opencode-go/*` のみを参照しており、Bedrock関連プロバイダは
一度も設定していないと本文が明記。設定ファイルの全文が issue に添付されている。
2026-08-05に closed（原因・対応内容は今回未確認、issue番号のみ記録） |

**この節全体の性質**: issue tracker は負の情報に偏るチャンネルであり、上記は「omp の
task/Agent Hub 機構が壊れている」ことの証明ではなく「直近3か月で報告された既知の
穴」の一覧。特に #9916（メモリ）・#7661（想定外プロバイダへの課金）・#13096（wake頻度）は
Swarm のように多数の子を長時間並走させる用途で踏みやすい種類の問題であり、
件数と数値が具体的にある3件として重みを置いて良い。

---

## 確認できなかったこと

1. `task:subagent:event`/`:progress`/`:lifecycle` 内部イベントバスに拡張から非公式に
   アクセスする手段があるか（`docs/extensions.md` の正式なイベント一覧には無いことは
   確認済みだが、`EventBus` 実装コードそのものの全走査はしていない）。
2. `AgentRegistry` グローバルシングルトンに拡張の `ExtensionContext` からアクセスできる
   非公開の抜け道があるか（型定義上は公開されていないことのみ確認）。
3. issue #7661（Bedrock課金インシデント）の根本原因と修正内容——issue本文の設定証跡までは
   読んだが、closed後のコメント・修正コミットは未取得。
4. 手元Mac (18.2.11) が実際に issue #13058 のバグを踏むかどうかの実機再現（今回は
   ソース読み取りのみで実行確認はしていない——`omp --version` はこのサンドボックスでは
   native addon の EPERM で起動不能、09-22時点の実機記録を参照するのみ）。
5. `job.queued` フラグが `/jobs` 以外の経路（例えば RPC モードの `proc://` JSON応答）で
   露出しているか——`/jobs` コマンドの2つのレンダラー（プレーンテキスト版とTUI版）は
   確認したが、RPC/ACP向けの別レンダラーは未確認。
6. bun global / mise 経由で別バージョンの omp がインストールされている可能性
   （`~/.bun`・mise global 配下を検索したが該当ファイルなし。Nix store の 18.2.11 が
   唯一発見できたインストール）。
7. `npm view @oh-my-pi/pi-coding-agent version` はサンドボックスの `registry.npmjs.org`
   宛403で実行できず、npm レジストリ上のメタデータ（週間DL数、最終公開日時など）は今回未取得。
