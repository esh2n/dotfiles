# 並列作業役（サブエージェント／Swarm／チーム）一覧表示の業界の作法

調査日: 2026-09-30。裁定記録 `2026-09-22-research-four-lenses.md` に従い四方向（ベンダー docs・ソース／名前のある実践者／測定／公開リポジトリと issue）で収集した。推奨は書かない。

## 0. 方法と検証の凡例

- 「ソース直読」= GitHub の raw ファイル（raw.githubusercontent.com）を `curl` で取得し、行番号付きでそのまま読んだもの。file:line で示す。
- 「API 直読」= `api.github.com` を `curl` で叩いた JSON をそのまま読んだもの（gh CLI は本セッションのサンドボックスで TLS 検証エラーになったため、指示どおり curl に切り替えた）。
- 「要約フェッチ」= WebFetch ツール（要約モデル経由）で取得したもの。マークダウン化された vendor docs をほぼそのまま返しているページ（Claude Code の costs ページ）は本文に近いと判断したが、要約色が強いページ（Claude Code の sub-agents ページ、Cursor、Codex の一部）は本文中に明記した。
- コード検索は `api.github.com/search/code` が認証必須で不可だったため、`sourcegraph.com` の公開ストリーム検索 API（無認証）でファイルパスを特定し、該当ファイルは raw で直読した。
- 到達できなかったもの（x.com は 402、grep.app は Vercel のチャレンジで 429、Cursor の一部 docs パスは 404）は該当箇所に明記した。「到達できない」であって「存在しない」ではない。
- GitHub 検索 API は無認証で 10 req/min、core API は 60 req/hour の別バケットで、途中 core が枯渇したため repo メタデータの一部は sourcegraph の `repoStars` フィールドを代替値として使った箇所がある(明記する)。

---

## 1. ベンダー docs・ソース

### 1.1 Kimi Code（MoonshotAI/kimi-code）— ソース直読

リポジトリ: https://github.com/MoonshotAI/kimi-code （MIT、`api.github.com/repos/MoonshotAI/kimi-code` 直読: `open_issues_count: 1507`, `pushed_at: 2026-09-30T07:31:36Z`, `created_at: 2026-05-22T08:02:03Z`。star 数は同一クエリで `stargazers_count` が欠落して返ったため sourcegraph の `repoStars: 7721`（2026-09-30 fetch）を代替値として使用）

**終わった行の扱い（グリッド本体）**: `apps/kimi-code/src/tui/components/messages/agent-swarm-progress.ts` の `AgentSwarmProgressComponent` は `members: AgentSwarmMember[]` を保持するが、削除する経路が無い。`ensureMemberCount()`（line 829-841）は配列を伸ばすだけで縮めない。`completeMember` / `failMember` / `cancelMember`（line 901-959）はメンバーの `phase` を `'completed'|'failed'|'cancelled'` に変えるだけで配列から外さない。完了直後は `COMPLETE_FILL_MS = 360`（line 30）だけバーが塗り終わるアニメーションをし、その後は静的なセルとして残り続ける（`cellCache` に固定される、line 733-761）。

**背後の実測コスト（別 PR で判明）**: この設計が招いた実害を Kimi 自身が特定して直している。`packages/agent-core-v2` 側の PR #3778（closed）本文より引用:
> "Completed subagent scopes (context memory, xstate machines, wire views, event dispatchers) are never destroyed — ~1MB each (up to ~5MB with large contexts) retained until session close, so big AgentSwarm runs grow the heap by hundreds of MB and GC stalls persist after the run ends."
（https://github.com/MoonshotAI/kimi-code/pull/3778 — API 直読 body）
同 PR は「aborted swarm members (user cancel / timeout) emitted no terminal event at all, so they were never cleaned up and stayed 'running' in the UI forever」とも書いており、これはまさにユーザーの観測した問題(a)（終わった行が残り続ける）と同型のバグを Kimi 自身が確認・修正した記録。修正は UI 行の除去ではなく **完了/失敗/キャンセル済みスコープの LRU キャッシュ化**（直近 32 件だけ常駐、`KIMI_CODE_SUBAGENT_SCOPE_CACHE_SIZE` で変更可、evict は 15秒タイムアウト・最大 3 回リトライ）。つまり Kimi の答えは「表示は残す・裏側のメモリだけ間引く」。

**別の完了UI（フッターの背景タスクバッジ）**: `apps/kimi-code/src/tui/components/chrome/footer.ts` の `[N agent running]` バッジ（line 486-492）は **稼働中の数だけ** を表示し、0件になると完全に消える。テストで検証済み:
> `expect(strip(footer.render(120)[0]!)).toMatch(/\[2 tasks running\]/); footer.setBackgroundCounts({ bashTasks: 0, agentTasks: 0 }); ... expect(after).not.toMatch(/tasks? running/);` （`apps/kimi-code/test/tui/components/panels/footer-bg-agents.test.ts` line 79-87、直読）
→ Kimi 社内でも「常駐グリッド（完了後も残す）」と「フッターバッジ（0で消える）」の**二つの流儀が同居**している。

**トークンの見せ方**: `packages/kosong/src/usage.ts`（直読）:
```
export interface TokenUsage {
  inputOther: number;
  output: number;
  inputCacheRead: number;
  inputCacheCreation: number;
}
export function inputTotal(usage) { return usage.inputOther + usage.inputCacheRead + usage.inputCacheCreation; }
export function grandTotal(usage) { return inputTotal(usage) + usage.output; }
```
→ **grandTotal はキャッシュ読み込み(inputCacheRead)とキャッシュ作成(inputCacheCreation)を両方合算に含める**設計。ユーザーの観測した「TOKENS がキャッシュ読み込みを含めて大きく出る」現象は、少なくとも Kimi の合算関数の定義どおりの挙動である。

**進み具合（PROGRESS）の作法**: `agent-swarm-progress-estimator.ts`（直読）。真の完了率は無い前提で、ツールコールの tick 頻度を実測して推定する。`unfinishedProgressCap = 0.85`（line 4）で「終わっていないエージェントは 85% を超えて表示しない」設計。`EstimatePrior`（`completedCount`, `typicalTotalMs`, `typicalToolCalls`, `typicalRatePerMs`、line 62-66）で「同じ Swarm 内で先に完了したエージェントの典型値」を後発エージェントの進捗予測に使う。`DEFAULT_RATE_WINDOW_MS = 45_000`, `DEFAULT_CATCHUP_TIME_MS = 1_500`（line 1-2）。

### 1.2 omp（oh-my-pi, can1357/oh-my-pi）— ソース直読

リポジトリ: https://github.com/can1357/oh-my-pi （MIT、`api.github.com/repos/can1357/oh-my-pi` 直読、2度目のリトライで成功: `stargazers_count: 33801`, `pushed_at: 2026-09-30T07:39:03Z`, `open_issues_count: 3337`, `created_at: 2025-12-31T14:01:28Z`）

**Agent Hub のステータス語彙**: `packages/tui/src/overlays/agent-hub-types.ts` line 7（直読）:
```
export type AgentStatus = "running" | "idle" | "parked" | "aborted";
```
**`"completed"` という状態は存在しない。** レジストリ自身のドキュメントコメント（`packages/coding-agent/src/registry/agent-registry.ts` line 1-9、直読）:
> "Sessions are registered explicitly at creation; finished agents stay registered as `idle` (live) or `parked` (session disposed, ref + sessionFile retained for revival) and are only removed on explicit release/teardown."
→ **終わったエージェントは自動では消えない**、ユーザーが `x`（abort + release）するまで残る設計を明言している。`packages/tui/src/overlays/agent-hub.ts` の冒頭コメント（line 5-8、直読）にも「`r` revives a parked agent; `x` aborts + releases one」とある。

**ただし「既定のライブ・ロスター」からは外れる**: issue #11214（open、API 直読 body）:
> "Default `task.agentIdleTtlMs` is 420000 ms (7 min); then the helper is `parked`, omitted from the live hub roster (running+idle only)."
（https://github.com/can1357/oh-my-pi/issues/11214）
→ 完了(idle)から 7 分で `parked` に落ち、既定表示（running+idle だけを映すビュー）からは外れる。つまり「表全体としては消えない」が「既定の一覧ビューからは時間で外れる」という**二層構造**。同issueは「CC/Codex にはブロッキングな Stop 相当のフックがあるが omp には無く、`yield` を出したエージェントを止める術がない」とも指摘（未解決）。

**列（AGENT_COLUMNS）**: `agent-hub.ts` line 150-163（直読）に `{ id: "cost", head: "Cost", format: "price" }`, `{ id: "agent", head: "Agent" }` ほかが定義され、`agent-hub-renderer.ts`（直読）の `formatMetricColumns()`（line 295-316）が実際に並べる列は **Cost / 経過時間(active/time —) / requests / tools / tokens / age** の6つ。

**COST の出どころと見せ方**: `agent-hub-projection.ts`（直読）の `readSessionMetrics()` line 68-111 は生セッションの `message.usage.cost.total` を全アシスタントメッセージで積算する実測値。`formatCost()`（`agent-hub-renderer.ts` line 261-266）:
```
export function formatCost(cost: number): string {
  const amount = metricNumber(cost);
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}
```
→ **0 でも必ず `$0.0000` のように数値表示**（`—` にはならない）。0 を出す設計であって「不明」を別記号にする発想が無い。

**TOKENS の定義（cacheRead を含めない）**: `agent-hub-projection.ts` line 74, 92（直読）:
```
tokens: stats.tokens.input + stats.tokens.output + stats.tokens.cacheWrite,
...
tokens += message.usage.input + message.usage.output + message.usage.cacheWrite;
```
→ **omp 自身の合算はキャッシュ「書き込み」だけを含み、キャッシュ「読み込み」は含めない**。Kimi の `grandTotal`（inputCacheRead を含む）と**正反対の流儀**。これはユーザーの問題(b)「TOKENS がキャッシュ読み込みを含めて大きい」に直接効く分岐点で、二つの著名実装が逆の選択をしている一次証拠。

**PROGRESS のバー**: `agent-hub.ts` / `agent-hub-renderer.ts` 全文を `grep` した限り、個別エージェント行に対する「達成率バー」は存在しない（`renderProgressBar` は `contextGauge()` だけで使われ、これは「残りコンテキスト窓」用で「タスクの進み具合」ではない）。**omp の Agent Hub には Kimi 型の推定進捗バーが無く、状態語＋経過時間だけ**。

**未読カウント**: `agent-hub-types.ts` line 71-74（直読）に `IrcBusLike.unreadCount(id)` があり、`agent-hub.ts` 冒頭コメント（line 6）は列挙に「status, unread irc count」を含める。**未読数は omp の Agent Hub にも実在する列。**

**ステータス更新の実測フロー**: `packages/coding-agent/src/registry/agent-registry.ts` line 237-252（直読）で、結果が受理され `ref.session?.isStreaming !== true` なら `running → idle` に落とす。`setActivity()`（line 280-288）は `running` 以外では活動ギストの更新を捨てる、というように **running 以外の行への書き込みを意図的に止める**設計。

**トークン集計の別バグ（修正済み）**: PR #13088（closed、API 直読 body）:
> "A follow-up turn on a kept-alive or parked subagent ... creates a new executor monitor with its counters at zero. The observer registry replaced the stored progress with each new snapshot, so the hub row ... showed only the latest turn."
（https://github.com/can1357/oh-my-pi/pull/13088）
→ 逆方向のバグ（再開したエージェントの累積コスト/トークンが 0 にリセットされていた）が実在し、加算式に直すコミットとテスト（`session-observer-registry.test.ts`）で修正済み。

**関連 issue の量**: `agent hub parked` で GitHub 検索した時点で 66 件ヒット（API 直読、2026-09-30）。エージェント・ロスターの生死判定・表示範囲は同リポジトリで継続的に議論されている領域であり、決着した設計ではない。

### 1.3 Claude Code — vendor docs（要約フェッチ、Claude Code の `code.claude.com` ページを WebFetch 経由で取得。costs ページは Markdown 構造をほぼそのまま返しており原文に近いと判断、sub-agents ページは要約色が強い）

**行のライフサイクル（sub-agents ページ、要約フェッチ）**:
> "Claude Code clears a background subagent's row from the subagent panel below the prompt input in one of two ways, depending on how the subagent ended: When a subagent finishes successfully, Claude Code removes its row immediately and, except in screen reader mode, shows `/tasks to see subagents` in the footer for 30 seconds." / "When a subagent fails or you stop it, Claude Code keeps its row for 30 seconds. To clear the row sooner, select it and press `x`."
（https://code.claude.com/docs/en/sub-agents、要約フェッチによる引用のため直接ページを開いての再確認は未実施）
→ **成功時は即座に消える**、**失敗/停止時は30秒残る**、と Kimi/omp とは逆に「既定は消す」側の設計。`/tasks` にも「同じ30秒だけ done 済みとして残り、稼働中の下に並ぶ」。

**コストの出どころ（costs ページ、要約フェッチだが構造はほぼ原文）**:
> "Claude Code computes the dollar figure locally from token counts at list price, unless a `modelPricing` table is in effect... The figure is an estimate, so for authoritative billing see the Usage page in the Claude Console."
> `Usage by model: claude-sonnet-4-6: 1.2k input, 5.3k output, 940.0k cache read, 50.0k cache write ($0.55)`
（https://code.claude.com/docs/en/costs）
→ **コストはローカルの単価表からの推定値**であり、サーバー報告の確定額ではない、と明言。トークンは **input / output / cache read / cache write を項目として分けて表示**し、単一の「tokens」合計には潰していない。

**キャッシュ利用率は別立ての指標**:
> "Prompt cache (main): 14 requests · 91% of input tokens from cache · 2 misses ..."
→ 「入力トークンのうち何%がキャッシュ経由か」を独立した行で見せ、これも「合計トークン数」に混ぜない設計。

**並列エージェントのコスト増加（測定寄りの数値）**:
> "Agent teams use approximately 7x more tokens than standard sessions when teammates run in plan mode, because each teammate maintains its own context window and runs as a separate Claude instance."
→ ベンダー自身が「並列チームは最大 7 倍」と定量化。ユーザーの観測した TOKENS の大きさ自体は、複数ワーカーが並列に走る設計の必然という側面がベンダー文書からも裏付けられる。

### 1.4 Codex CLI（OpenAI）— vendor docs（要約フェッチ、learn.chatgpt.com/docs/codex/cli）

> "the documentation does mention subagents in one context: 'Ask Codex to delegate focused work to specialized agents, then bring their findings back into the main terminal session.' ... no status monitoring interface is described." / "The CLI emphasizes interactive, sequential workflows rather than parallel background processing. There is no mention of a status dashboard tracking multiple agents' metrics."
（要約フェッチのため直接ページを開いての一次確認は未実施だが、要約自体が「見当たらない」という否定的結論であることは明記）
→ **4ベンダー中、唯一「並列作業役の状態一覧」を持たない（少なくとも公開 docs に記載が無い）実装**。これは重みのある否定側の証拠。

### 1.5 Cursor — vendor docs（到達性に難あり）

`cursor.com/docs/agent/agents-window`, `cursor.com/docs/agent/overview` は到達できたが、要約フェッチの結果はいずれも「列やステータスフィールド、完了行の扱いについて具体的な記述は無い」という否定的な要約。`cursor.com/docs/cloud-agent/api/endpoints`, `cursor.com/help/ai-features/background-agents` は 404。`cursor.com/en/docs/background-agent` も 404。
→ **Cursor の一覧表示の列構成・完了行の扱いについては、到達できた公開 docs の範囲では確認できなかった**（存在しないのではなく、未到達）。

---

## 2. 名前のある実践者

### 2.1 @voidwarriorchan（到達不能、実在は確認）

ユーザーから指定された「screen（Unread が残る）」の出典を辿った。GitHub 上に実在するアカウント（`api.github.com/users/voidwarriorchan` 直読）:
- 作成日 2026-03-04、`twitter_username: voidwarriorchan`（プロフィールの twitter 欄が同名で一致）、bio/blog は空。
- 公開リポジトリ 9件のうち `oh-my-pi` は can1357/oh-my-pi の **fork**（`api.github.com/repos/voidwarriorchan/oh-my-pi` 直読: `fork: true`, `parent: can1357/oh-my-pi`, `pushed_at: 2026-07-07`）。ただしコミット履歴を見る限り本家の commit をそのまま追随しているだけで、自分の改変コミットは見当たらない（直近30件はすべて本家由来のマージ/コミット）。
- 他に日本語圏の実務家であることを示す repo あり（`bengo-toolkit` = 法律事務所向け Claude Code プラグイン、`professional-legal-prompts` = 日本法の契約審査プロンプト）。
- **投稿本体は未確認**: x.com/twitter への WebFetch は `402 Payment Required` で到達不能。個人ブログの URL も無し（`blog` フィールド空）。GitHub の issue/PR 検索（`voidwarriorchan` で全文検索、API 直読）は無関係な4件のみヒット、gists も0件。
→ **「Unread が残る」画面そのものは到達できず未検証**。実践者本人の実在と、Claude Code 系ツールを日常的に扱っている属性までは確認できたが、投稿内容は「到達不能」として扱う（不在の確認ではない）。

### 2.2 Show HN の作者たち（弱い実践者シグナル）

HN Algolia API（無認証、`hn.algolia.com`）で "subagent panel claude code" を検索し、この一覧表示の課題そのものに取り組んだ第三者ツールが見つかった:
- Darshan Nere「Show HN: ObservAgent – Observability for Claude Code (cost, tools, subagents)」https://darshannere.github.io/observagent/ — HN投稿は2点・コメント0件（`hn.algolia.com/api/v1/items/47391414` 直読）。
- Latand「Show HN: Orchestrate parallel Claude Code and Codex agents on a live map」https://github.com/Latand/live-log-viewer-next — 4点・コメント0件（`hn.algolia.com/api/v1/items/48804797` 直読）。
→ 「コスト・トークン・サブエージェントの可観測性」を個人が繰り返し自作している事実はあるが、**いずれも注目を集めていない**（HN のポイント・コメントともに一桁）。これは実践者側の需要が「見えているが誰も強く支持していない」ことを示す弱い否定的シグナルとして扱う。

---

## 3. 測定（数値のあるもの）

| 出典 | 数値 | 意味 |
|---|---|---|
| Claude Code vendor docs | 「約7倍」 | Agent teams が plan mode で稼働すると通常セッションよりトークン消費が約7倍（要約フェッチ） |
| Claude Code vendor docs | 30秒 | 成功終了後のフッターヒント表示時間／失敗・停止行の残存時間（両方とも30秒、要約フェッチ） |
| omp issue #11214 | 420,000ms（7分） | 既定の `task.agentIdleTtlMs`。idle→parked への遷移までの時間、かつ既定ライブ・ロスターから外れる境目 |
| omp PR #12252 | 5分→30秒 | 背景ジョブ行の保持時間。「結果を消費済みなのに5分間の全保持ウィンドウ残っていた」バグを「消費済みなら30秒の猶予後にクリア」に短縮（Claude Code の30秒と独立に同じ桁の値に収束） |
| Kimi PR #3778 | 約1MB〜5MB／エージェント、「数百MB」 | 完了済みサブエージェントのスコープ（メモリ）を破棄しない場合のヒープ増加量の実測 |
| Kimi PR #3778 | 32件 | LRU で常駐させる完了済みスコープの上限件数（既定値、環境変数で変更可） |
| Kimi swarm-progress-estimator.ts | 0.85 | 未完了エージェントの表示進捗の上限（100%に到達させない） |
| Kimi swarm-progress-estimator.ts | 45,000ms / 1,500ms | 進捗レート推定の観測窓 / キャッチアップ時間 |
| Kimi swarm-progress.ts | 360ms | 完了時の「塗り終わり」アニメーション時間（`COMPLETE_FILL_MS`） |
| omp PR #13088 | ゼロリセット→加算 | 再開したサブエージェントの cost/tokens/requests/tools/duration が新規ターンのたびに0に戻っていたバグの修正（加算式に変更、テストで検証） |
| HN Algolia | 2点・4点 | 第三者の可観測性ツール2件の反応の小ささ |

---

## 4. 公開リポジトリと issue（実態）

| リポジトリ | star | 直近 push | open issues | ライセンス | 備考 |
|---|---|---|---|---|---|
| MoonshotAI/kimi-code | 7,721（sourcegraph代替値、2026-09-30） | 2026-09-30T07:31:36Z | 1,507 | MIT | 作成2026-05-22。swarm関連の issue/PR だけで検索134件ヒット |
| can1357/oh-my-pi | 33,801（API直読） | 2026-09-30T07:39:03Z | 3,337 | MIT | 作成2025-12-31（9か月で3万超）。"agent hub parked" 検索だけで66件ヒット |

両リポジトリとも当日(2026-09-30)にpushされており活発。ただし open issue 数が非常に多く（omp: 3,337、kimi-code: 1,507）、エージェント一覧の生死判定・カウント方式に関する issue/PR が継続的に出ている＝**「一覧表示の作法」は業界内でもまだ揺れている段階**であることを示す。Codex（OpenAI）は同種の機能自体が vendor docs に見当たらず、比較対象になる公開実装を確認できなかった。Cursor は closed-source の SaaS で、リポジトリそのものが公開されていない。

---

## 5. 比較表

| 実装 | 完了行の扱い | トークンの数え方 | 費用の出どころ | 進み具合(PROGRESS) |
|---|---|---|---|---|
| Kimi Code swarmグリッド | 消えない（配列に残る、360ms塗り終わりの後は静的）。裏のメモリはLRUで32件だけ常駐 | grandTotal = other + output + cacheRead + cacheCreation（**キャッシュ読込を含む**） | 未確認（このファイル群では見つからず） | ツールコール頻度からの推定、未完了は85%上限、同Swarm内の完了済みエージェントの実測値を事前分布に使う |
| Kimiフッターの背景バッジ | 0件で完全に消える（稼働数のみ表示） | — | — | — |
| omp Agent Hub | 消えない設計だが、idle→7分でparkedになり既定ビュー(running+idle)からは外れる。`x`で明示release | tokens = input + output + cacheWrite（**キャッシュ読込を含めない**） | 実測: 各assistantメッセージの`usage.cost.total`を積算。0でも`$0.0000`と数値表示（—にしない） | 無し（進捗バーは無く状態語＋経過時間のみ） |
| Claude Code subagentパネル | 成功時は即消去（フッターに30秒ヒント）。失敗/停止は30秒残り`x`で早期消去。`/tasks`も同30秒doneのまま下部表示 | input/output/cache read/cache writeを項目分けして表示、合算は`/usage`のTotal列で別掲。プロンプトキャッシュ率は別行 | ローカルでトークン数×リスト価格を計算した推定値。`modelPricing`設定時は契約レート表記付き | 記載なし（要約フェッチの範囲では言及なし） |
| Codex CLI | 該当UIなし（vendor docsに記載なし） | 該当なし | 該当なし | 該当なし |
| Cursor background/cloud agents | 到達できた docs の範囲では不明 | 不明 | 不明 | 不明 |

---

## 6. 確認できなかったこと（「無い」ではなく「届かなかった」）

- @voidwarriorchan の実際の投稿内容（"Unread が残る" 画面）— x.com が WebFetch で 402、代替のブログ/gist なし。
- Cursor の background/cloud agents 一覧の列構成・完了行の扱い — 複数の docs パスが404、到達できたページも記述なし。
- Codex CLI に並列サブエージェント一覧UIが**本当に存在しないのか**、単に該当ページに未到達なのかの切り分け — 到達したページの要約では「見当たらない」だが、Codex の GitHub リポジトリ内ソース（openai/codex）までは未確認。
- omp の Agent Hub における COST の実測値の出どころ（サーバー報告かローカル単価表か）— `message.usage.cost.total` がどこで計算されるか（クライアント側かプロキシ側か）までは、今回読んだファイル群では特定できず。
- Kimi Code の Agent Swarm グリッドに COST 列自体が存在するかどうか — `agent-swarm-progress.ts` にはCOSTの記載が無かったが、これは「このコンポーネントには無い」であって「Kimi Code全体のどこにも無い」の確認ではない。
- grep.app によるコード横断検索は Vercel のチャレンジで 429 になり使えなかった（sourcegraph で代替）。
