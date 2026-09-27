# 調査担当B: 発端の投稿 と 比較実装（Claude Code agent teams / OpenAI Agents SDK / pi-agent-teams）

担当範囲: Kimi Code 本体は対象外。四つのレンズのうち「発端」「ベンダー」「実践者」「測定」「実態(gh)」を横断して記録する。

## 検証方法メモ（環境の制約）

- このサンドボックスでは `gh api` / `gh repo view` などの gh CLI ネットワーク呼び出しが TLS 検証で失敗する（`tls: failed to verify certificate: x509: OSStatus -26276` — Go バイナリが macOS Keychain 経由の証明書検証をこのサンドボックス内で行えず、原因不明のエラーを返す。`SSL_CERT_FILE`/`GODEBUG=x509usefallbackroots=1` を試したが解消せず）。**gh CLI そのものは不可**。
- 回避策として `curl` に `CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt` を指定すると GitHub REST API (`api.github.com`) には到達できた。以降の GitHub 実態調査はすべて **未認証 curl 経由の REST API**（`gh search code` 相当のコード検索は認証必須のため実行不可、リポジトリ/コミット/issue/PR/タグの一覧は取得できた）。
- X (Twitter) は指示通り `https://api.fxtwitter.com/<user>/status/<id>` で読んだ。

---

## 1. 発端: @voidwarriorchan (VWC / Void戦士ちゃん) の Swarm 投稿

**結論: 指定された起点 URL は Swarm と無関係のツイートで、記述された一連の投稿（herdr/headless/kubectl 風表示/Astra 用 Swarm）は見つけられなかった。「確認できず」。**

- 指定 URL `https://x.com/voidwarriorchan/status/2075033184652480712` を `https://api.fxtwitter.com/voidwarriorchan/status/2075033184652480712` で取得した結果、本文は次の通り:
  > "ドパおじの方が楽しそう"（2026-07-09、いいね6,364・RT1,026・返信102、SOU_BTC の「ドパガキ/セロトニンおじさん」ツイートの引用）
  Swarm・herdr・kimi-cli 等への言及は一切なし。ID の指定ミスか、fxtwitter 側のキャッシュ不整合の可能性がある。
- プロフィール自体は実在を確認（`https://api.fxtwitter.com/voidwarriorchan`）: フォロワー8,473・フォロー25・投稿6,360件・2020年8月開設・東京・bio "Any sufficiently advanced technology is indistinguishable from magic. | Building AI-native systems."。ただし fxtwitter のプロフィールエンドポイントは最新ツイート一覧を返さないため、そこから遡ることはできなかった。
- `WebSearch` で以下を試したが、該当ツイートは1件もヒットしなかった（すべて無関係な検索結果）:
  - `"voidwarriorchan" OR "Void戦士ちゃん" swarm herdr headless kubectl`
  - `site:x.com voidwarriorchan swarm`（WebSearch は site: 演算子非対応と明記される）
  - `Void戦士ちゃん 独自ハーネス swarm kimi-cli`
  - `voidwarriorchan "kubectl" swarm 表示`
  - `voidwarriorchan Astra swarm`
  - `"voidwarriorchan" swarm agent GitHub`
- GitHub 上に `voidwarriorchan` という名のリポジトリ・コード言及も無し（`api.github.com/search/repositories?q=voidwarriorchan` → `total_count: 0`。コード検索は認証必須で未実施）。
- 副産物として herdr 上で Swarm を組んでいる**別人**の公開実装が2件見つかった（VWC との関連は確認できず、あくまで「in the wild」の並走事例として記録）:
  - [jmcjm/Hivemind](https://github.com/jmcjm/Hivemind) — 「A swarm of Claude Code agents in herdr — one coordinator commands drones in separate herdr panels. The human talks only to the coordinator and never browses drone panels.」ファイルベースの brief/report/mail、ゼロポーリング（Monitor 通知）。★2、herdr ≥0.8 必須、「Drones may lose first input; retry mechanism handles up to 3 attempts」「Monitor notifications expire after 30 minutes and must be re-armed」という既知の制約あり。README に VWC やSNS投稿への謝辞なし。
  - [bandoyer/swarm-forge-herdr](https://github.com/bandoyer/swarm-forge-herdr) — herdr への移植版だが、思想の出典は「[swarm-forge](https://github.com/unclebob/swarm-forge), created by Robert C. Martin」であり VWC とは無関係。★0。
- herdr 公式ドキュメント（`https://herdr.dev/docs/integrations/`）には swarm/coordinator-drone を指す記述が存在しない。Kimi Code 統合は「hook reports Kimi session identity and lifecycle state to Herdr for native restore and authoritative idle/working/blocked status」とあるのみで、swarm 機能自体は herdr のネイティブ機能ではなく、上記のようなサードパーティが herdr のセッション/パネル基盤の上に組んでいるものと分かる。

**この節全体を「確認できなかったこと」に計上する。** 発端の一次情報（本人の投稿）は今回のリサーチでは裏取りできなかった。

---

## 2. OpenAI Agents SDK（旧 openai/swarm の後継）

### ベンダー一次情報

- 旧 `openai/swarm` は明示的に非推奨: `https://github.com/openai/swarm`
  > "Swarm is now replaced by the OpenAI Agents SDK, which is a production-ready evolution of Swarm."
  > "We recommend migrating to the Agents SDK for all production use cases."
  ★22,000、コミット29件のみ（教育目的で凍結、実質メンテナンスなし）。
- Handoffs: `https://openai.github.io/openai-agents-python/handoffs/`
  - 「Handoffs allow an agent to delegate tasks to another agent.」ツールとしてモデルに見せる方式（`transfer_to_refund_agent` のような tool 名が自動生成される）。
  - `handoff()` の引数: `agent`/`tool_name_override`/`tool_description_override`/`on_handoff`/`input_type`/`input_filter`/`is_enabled`。
  - 制約: 「Handoffs remain within a single run; input/output guardrails apply only to first and final agents respectively」「Server-managed conversations don't support handoff input filters」「Nested handoff history (opt-in beta) doesn't redact sensitive data in generated summaries」。
- オーケストレーション方針: `https://openai.github.io/openai-agents-python/multi_agent/`
  - 2方式: 「Allowing the LLM to make decisions」vs「determining the flow of agents via your code」、「You can mix and match these patterns」。
  - **Agents as Tools**: 「A manager agent keeps control of the conversation and calls specialist agents」（`Agent.as_tool()`）。「one agent should own the final answer, combine outputs from multiple specialists」場合に向く。
  - **Handoffs**: 「A triage agent routes the conversation to a specialist, and that specialist becomes the active agent for the rest of the turn」。
  - 使い分け: agents-as-tools は「a specialist should help with a bounded subtask but should not take over the user-facing conversation」、handoffs は「routing itself is part of the workflow and you want the chosen specialist to own the remainder」。組み合わせ可（triage→handoff→その専門家がさらに他をtoolとして呼ぶ）。
  - 並列実行: 「Running multiple agents in parallel, e.g. via Python primitives like `asyncio.gather`. This is useful for speed when you have multiple tasks that don't depend on each other.」— **SDK 自体に専用の並列プリミティブはなく、素の `asyncio.gather` に委ねている**。
- トレーシング: `https://openai.github.io/openai-agents-python/tracing/`
  - 「a comprehensive record of events during an agent run: LLM generations, tool calls, handoffs, guardrails, and even custom events」。「Handoffs are wrapped in `handoff_span()`」。
  - 制約: **「Tracing is unavailable for organizations that use OpenAI's APIs under a Zero Data Retention (ZDR) policy.」** コスト/オーバーヘッドの記載なし（=無記載を無記載のまま報告）。

### 実態（gh, 未認証 REST API 実測 2026-09-27時点）

- `openai/openai-agents-python`: `pushed_at 2026-09-25T22:05:16Z`、★29,715、fork 4,812、open issues 24（= 直近2日以内にpush、活発にメンテされている）。
- issue/PR 検索 `repo:openai/openai-agents-python handoff parallel`（42件ヒット中の一部）:
  - open #4835 `fix(sessions): recover fresh streamed handoffs after session append failures`
  - closed #4405 `fix: align Responses parallel tool calls with converted tools`
  - closed #4326 `LiteLLM sends parallel_tool_calls without tools to Azure OpenAI`（**LiteLLM 経由運用で実際に踏まれた不具合** — このプロジェクトの LiteLLM 常用構成との関連で要注意）
  - closed #4153 `fix(run): honor falsey handoff input filters`
  - このように handoff・parallel_tool_calls 周りのバグは継続的に報告・修正されている＝機能自体は生きているが「素朴に動く」わけではない、という実態。

### 測定評価（研究寄り、コーディングタスクではない点に注意）

- **The Illusion of Multi-Agent Advantage** (arXiv 2606.13003, Jwalapuram, Lin, Li, Jiao, Wang, Ming, Ke, Qin, Carenini, Joty): 「automatic MAS consistently underperform CoT-SC despite being up to 10x more expensive」。評価対象は「Traditional reasoning datasets」「Interactive multi-step workflows (specifically BrowseComp-Plus)」「Synthetic diagnostic datasets」——**推論・検索タスクであり、コーディングタスクでの結果ではない**。専門家設計のマルチエージェントは自動生成アーキテクチャより上回るとも書かれている（＝「人手で設計すれば勝てる」ことを否定していない）。
- **OrchBench** (arXiv 2607.25656, Ren, He, Zhang, Qian, Han, Zheng, Li, Zhang): research/chat/coding の3領域でオーケストレーション方式（handoff・swarm型チーム構成含む）を決定論的シミュレーションで評価するベンチマーク。PDF が大きく具体的な数値表までは取得できず（**数値は未確認、フレームワークの存在のみ確認**）。
- Shopify Engineering（`https://shopify.engineering/building-production-ready-agentic-systems`、著者 Andrew McNamara: Director of Applied ML, Shopify、共同発表 Ben Lafferty / Michael Garner、ICML 2025）: 「Avoid multi-agent architectures early: Simple single-agent systems can handle more complexity than you might expect」。理由は「engineering economics, not ideology」で、ツール複雑性だけで単一エージェントの推論が難しいのに、エージェントを増やすとプロンプト・トレース・失敗面が価値より先に倍加する、という趣旨。**具体的なレイテンシ/コスト/エラー率の数値は本文になし**（評価指標としては Cohen's Kappa 0.02→0.61 等が別文脈で記載されているだけで、マルチエージェント判断とは直接紐づかない）。

---

## 3. Claude Code agent teams（teammateMode）

### ベンダー一次情報（2026-09-27 時点、`docs.claude.com` は `code.claude.com/docs/en/agent-teams` へ301リダイレクト済み）

- **既定で無効の実験的機能である**ことが冒頭に明記されている:
  > "Agent teams are experimental and disabled by default. Enable them by setting `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in your settings.json or environment. Without that variable, no team is set up at session start... Agent teams have known limitations around session resumption, task coordination, and shutdown behavior."
- 位置づけ: 「One session acts as the team lead... Teammates work independently, each in its own context window, and communicate directly with each other.」Subagent との対比表(引用):
  | | Subagents | Agent teams |
  |---|---|---|
  | Context | Own context window; results return to caller | Own context window; fully independent |
  | Communication | Return a result to the caller | Teammates message each other directly |
  | Coordination | Main agent manages all work | Self-coordination + shared task list |
  | Token cost | Lower | Higher |
- コスト: **「Agent teams add coordination overhead and use significantly more tokens than a single session.」** 「Token costs scale linearly: each teammate has its own context window and consumes tokens independently.」推奨チーム規模「Start with 3-5 teammates」。
- キャッシュ: in-process teammate のリクエストは main conversation の TTL バケット外になり、既定5分キャッシュ（`subagentPromptCacheTtl` を `1h` にすると延長可、ただし1時間キャッシュ書き込みは高い料金）。
- アーキテクチャ: mailbox は `~/.claude/teams/{team-name}/inboxes/{agent-name}.json`。**既知の過去バグとして明記**:
  > "Before v2.1.207, a single malformed mailbox entry caused a repeated error every second and blocked delivery for that mailbox until you deleted the file manually."
- タスクは `~/.claude/tasks/{team-name}/`（pending/in_progress/completed の3状態、依存関係、file locking で claim の競合回避）。
- 表示モード: in-process（既定）/ split panes（tmux または iTerm2 の `it2` CLI）。「VS Code's integrated terminal, Windows Terminal, or Ghostty」は split-pane 非対応と明記。
- モデル選択順（v2.1.257以降）: ①spawn プロンプト指名 ②subagent定義の`model` ③`CLAUDE_CODE_SUBAGENT_MODEL` ④lead のモデル。effort は lead から継承（split-pane は v2.1.186 以降のみ）。
- **Limitations（原文列挙）**:
  - No session resumption with in-process teammates（`/resume`/`/rewind` は in-process teammate を復元しない）
  - Task status can lag（完了マーク忘れが依存タスクを詰まらせる）
  - Shutdown can be slow
  - One team per session / No nested teams / Lead is fixed（リーダー交代不可）
  - No background subagents from in-process teammates
  - Permissions set at spawn（生成後にteammate単位で変更は可能だが生成時には不可）
  - Split panes require tmux or iTerm2
- Failure handling: 「Teammates may stop after encountering errors instead of recovering.」自動リトライ・自動再spawnの記載なし（人間かリーダーが気づいて対処）。
- Use case examples に「Investigate with competing hypotheses」（5 teammates に敵対的に仮説を潰し合わせる）というVWCの投稿記述（「対立仮説で議論」）と類似するパターンが公式に掲載されている——ただし出典として VWC への言及はない。

### 実践者（負の証拠を含む）

- **"Claude Agent Teams: Why I Stopped Using Them"**（Medium, publication "Vibe Coding"、2026-06、著者個人名は本文冒頭には出ず不明 — **名前が確認できないため「named notable practitioner」の基準は満たさない**、参考情報として記録）。Medium 本体は403、`r.jina.ai` 経由のプレビューで確認できた範囲:
  > "Multiple Claude instances talking to each other, splitting a feature across backend and frontend while watching them coordinate in parallel"
  > 「the tech was great」「the bill wasn't」→ turned it off。
  > 「a failure mode nobody likes to tell you about」への言及があるが、**本文はペイウォールの先で具体的な内容は取得できず**（[要確認: ペイウォール未到達]）。
- 上記以外に named な実践者（Simon Willison 等）による agent teams 特化の一次記事は WebSearch では発見できなかった（`simonwillison.net/tags/sub-agents/` はヒットしたが、agent teams 固有の記事かは未検証・未フェッチ）。**この点は「確認できなかったこと」に計上**。

---

## 4. pi-agent-teams（pi の拡張, tmustier/pi-agent-teams）

前回調査（2026-09-13, HEAD `2c1776d`, v0.5.6, 09-13 のセッションの調査報告）を読み込み済み。要旨は上のセクション1-9（タスクモデル/mailbox/スケジューリング/失敗処理/予算/resume/UI/結合度/設計の学び）に既に詳細化されている。**今回は差分のみ実測。**

### 差分確認（2026-09-27 時点、REST API 実測）

- **`main` ブランチへの新規コミットなし**: 直近10コミットの先頭は依然 `2c1776d`（2026-06-12T23:25:57Z マージ）。**前回読了時から3.5ヶ月半、mainへのpushが止まっている**。
- `pushed_at: 2026-06-20T06:18:53Z` はPRブランチへのpush（後述PR #46, dependabot依存更新）によるもので、mainの状況とは別。
- package.json の `version` は HEAD で `0.5.6` だが、**git tag は `v0.5.4`（2026-03-27, sha `df4b4bfebf`）が最新**——`v0.5.5`/`v0.5.6` のタグは存在しない。バージョン番号だけ先に上がってタグ付けが追いついていない状態（前回調査時点でも同じ状態だった可能性が高く、今回新たに確認しただけの事実）。
- open issues 18件・open PR 9件、star 108・fork 19（前回未計測のため差分不明、今回の絶対値として記録）。
- **新規かつ重大な未修正バグ（issue #50, 2026-09-10, open, コメント0）**:
  > "Leader polling timers touch the invalidated ctx after session replacement and kill the Pi process ... Pi throws on stale ctx access, and because Pi registers no `unhandledRejection` handler, Node re-raises the rejection as an `uncaughtException` and the whole Pi process exits."
  再現環境として `@tmustier/pi-agent-teams 0.5.5`, `@earendil-works/pi-coding-agent 0.85.1`, Node v24.15.0, Linux が明記——**pi プロセスそのものをクラッシュさせる不具合が未対応のまま3週間以上放置**（2026-09-27時点)。
- **issue #47（2026-07-16, open）**: 「Manual (non-RPC) workers... can silently drop queued mailbox messages / task prompts」。原因は worker 側の独自 `isStreaming` フラグが pi 本体の busy 状態（自動リトライ・自動圧縮リトライ等）を捕捉できないこと。plan-approved通知・タスク割当プロンプト・DM配送・自動claimプロンプトが**サイレントに欠落しうる**と明記。
- **issue #42（2026-06-01, open, 実践者アカウントの一次報告）**:
  > "I've been enjoying playing around with this teams extension, and I've been using it with local models exclusively... the full context is enough for 2-3 tasks worth of history, even when compaction happens, more and more compacted task history accumulates and starts slowing down agents"
  Qwen 3.5系ローカルモデル・256kコンテキストでの実測報告。ローカルモデル運用者からの「圧縮しても効かない、遅くなる」という一次証言（GitHubユーザー名のみで、named notable practitioner の基準は満たさないが、issue tracker 型の実測証言として記録）。
- **issue #9（2026-03-19, open, 未対応）**: ディスク肥大化の実測数値:
  > "On a machine with moderate daily usage over ~1 month: **1,195 session directories** under `~/.pi/agent/teams/`... One session with **10 active worktrees** still registered against the parent repo (~2.2 GB)... The parent repo's `git worktree list` showed 11 stale entries"
  対応する PR #40（`fix(teams): close remaining cleanup gaps for worktrees and session dirs`, 2026-04-03 open）は**5ヶ月以上マージされず放置**。
- 他の未マージ open PR: #49 (2026-09-05, "Report activity for teammates the leader did not spawn")・#48 (2026-08-12, Windows atomic rename retry)・#44 (2026-05-07, dynamic tmux spawn)・#41/#39/#38/#34（いずれも2026年3-4月提出、6ヶ月近く未マージ）。**issue自体はSept 10まで継続的に報告されているのに、マージ実績はJune 12以降ゼロ** — 「使われてはいるが手入れされていない」状態が前回調査時よりも進行している、というのが今回追加できる最大の差分情報。

---

## 比較表

| 対象 | 仕事の分け方 | 並列と待ち行列 | モデル割り当て | 表示 | 状態保存 | 失敗例（同じ重みで） |
|---|---|---|---|---|---|---|
| VWC の Swarm 投稿 | 確認できず | 確認できず | 確認できず | 「kubectl 風」と伝聞のみ、原文未確認 | 確認できず | 確認できず |
| OpenAI Agents SDK | agents-as-tools（manager保持）／handoffs（制御移譲）を明確に使い分け、併用も公式に推奨 | 専用プリミティブなし、素の `asyncio.gather` に委ねる（[vendor docs](https://openai.github.io/openai-agents-python/multi_agent/)） | Agent単位でmodel指定（コード側の明示指定、ドキュメント上は自動ルーティング機構の記載なし） | トレーシング（span毎、`handoff_span()`）。ZDR組織では利用不可 | 明記なし（セッション永続化はRunner外の話として別ドキュメント） | LiteLLM経由でparallel_tool_callsがAzure OpenAIに誤送信される等、handoff/parallel関連のfix PRが継続発生（[#4326](https://github.com/openai/openai-agents-python/issues/4326)ほか）。旧swarmは非推奨化・凍結（★22k、コミット29件のみ） |
| Claude Code agent teams | lead が task を作成、teammate が self-claim または lead 割当。3状態+依存関係、file locking | 明確な上限なし、推奨3-5体。トークンはteammate数に線形増（vendor明記） | spawn時指定 > subagent定義のmodel > `CLAUDE_CODE_SUBAGENT_MODEL` > lead継承 | in-process（既定）/ split panes（tmux・iTerm2のみ、VS Code/Windows Terminal/Ghostty不可） | team configはセッション終了で削除、taskはローカル永続（`cleanupPeriodDays`）だが**in-process teammateはresume/rewindで復元されない**とvendorが明記 | mailbox不正エントリでv2.1.207未満は配送全停止（vendor自認の過去バグ）。実践者ブログ「the bill wasn't」great→turned it off（Medium, 著者名不明、要ペイウォール突破） |
| pi-agent-teams | file-per-task（1タスク=1 JSON）、双方向依存エッジ、highwatermark採番 | worker 350-550ms・leader inbox 700ms・widget 1sの全面ポーリング、専用の並列上限なし（delegateのmaxTeammates既定4/最大16） | override > lead継承（sonnet-4系は継承拒否）> default | 常駐widget（1行+ステータスinline）／`/tw`モーダルパネル（overview/session/dm/tasks/reassign）。列レイアウトはハードコードでスタイルJSONは用語のみ変更可 | `~/.pi/agent/teams/<teamId>/`に全永続化、`/team attach`でセッション跨ぎ可、ロック付き。ただしworktree/セッションdirの自動GCが不十分 | **issue#50: leaderの3タイマーがstaleなctxに触れてpiプロセス全体をクラッシュさせる（2026-09-10, open, 未対応）**。issue#47: サイレントなメッセージ欠落。issue#9: 1ヶ月で1,195セッションディレクトリ・10 worktree(~2.2GB)が蓄積、対応PRが5ヶ月以上未マージ。**mainへのコミットは2026-06-12で停止、issueは9月まで継続報告** |

---

## 確認できなかったこと（明示リスト）

1. VWC (@voidwarriorchan) の Swarm 関連投稿そのもの。指定された起点URLの実体は無関係のツイートで、記述された一連の投稿（herdr/forked agent/headless化、kubectl風表示、Astra用Swarm）は WebSearch・fxtwitter のいずれでも特定できなかった。プロフィールの実在とbioは確認済みだが、タイムライン遡及の手段がこの環境では無い。
2. OrchBench (arXiv 2607.25656) の具体的な数値表（PDFが大きく圧縮され、フレームワークの存在と評価領域(research/chat/coding)のみ確認、handoff/swarm型構成の優劣数値は未確認）。
3. Medium記事「Claude Agent Teams: Why I Stopped Using Them」の「setup guides seem to ignore」とされる失敗モードの具体的な内容（ペイウォールの先、著者名も本文からは不明）。
4. Simon Willison など named practitioner による agent teams / OpenAI Agents SDK 特化の一次記事（検索でタグページはヒットしたが、該当記事の存在・内容は未フェッチ・未確認）。
5. `gh search code`（GitHubコード検索）による "voidwarriorchan" や関連スワームプロジェクトへの直接引用の網羅的確認 — この環境では認証必須のため未実施（`gh` CLI自体もTLS検証がサンドボックス内で失敗し使用不可、REST APIのみcurlで代替）。
6. Claude Code agent teams の「2026年2月、Opus 4.6と同時リリース」というWebSearch要約中の主張 — vendor一次情報（changelog）では未検証（[unverified]）。
