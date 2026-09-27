# Kimi Code の Swarm 実装 精読(第2版) — 09-13 版との差分更新

対象: `MoonshotAI/kimi-code`(TS monorepo)。今回 shallow clone した HEAD は **`be7d5f5f`(2026-09-24)**。
前回精読は commit `ee2cac10`(2026-09-12, 差分は前回レポート本文をそのまま参照: 09-13 のセッションの調査報告 に保存済み)。
12日分の差分と、前回見落とした重大な機能(Tower モード、モデルプール、fork)を今回追加で確認した。file:line は今回 clone (`be7d5f5f`)相対。

## リポジトリ状態(実態レンズ)

- `MoonshotAI/kimi-code`: **star 7,686 / fork 1,260 / open issues 1,482** / `pushed_at 2026-09-26T03:38:19Z` / `archived: false` / license `MIT`。(`curl https://api.github.com/repos/MoonshotAI/kimi-code`, 2026-09-27 取得)
- `MoonshotAI/kimi-cli`(旧 Python 版): **star 11,430 / open issues 797 / `archived: true`**(前回は「wind down 予定」の記述のみだったが、今回確認したら実際に archived 済み)。(`curl https://api.github.com/repos/MoonshotAI/kimi-cli`)
- README の「Swarm はコードに存在しない」という前回の確認(kimi-cli 側)は archived 化により裏付けが強まった。

## 1. Swarm ツール自体の差分 — 128体上限・タイムアウトは不変、`fork` と「モデルプール」が新規確認事項

前回レポートは `fork` パラメータの存在を報告していなかった。今回コードと changelog を突き合わせたところ、**`fork` は前回 clone 時点(09-12)で既に存在していた**(導入は 0.39.0, 2026-08-27)。前回の grep が拾い損ねていただけで、今回版での新規追加ではない。ただし現在も **実験フラグ `subagent_fork`(既定 false)の裏で無効化されている**(`packages/agent-core-v2/src/session/subagent/flag.ts:3-7`, `agentSwarmTool.ts:147` — `fork && !this.flags.enabled(SUBAGENT_FORK_FLAG_ID)` で拒否)。

- `AgentSwarmToolInputSchema` に `fork: boolean` フィールドがある(`packages/agent-core-v2/src/features/swarm/tools/agent-swarm/agent-swarm.ts:36-42`)。true にすると「呼び出し元エージェントの完了済み会話履歴のスナップショットで各 item サブエージェントを起動する」(同ファイル docstring)。`resume_agent_ids` と併用不可、`subagent_type`/`model` を渡す場合は呼び出し元自身のものと一致必須(`agent-swarm-fork.md`)。
- **モデルはサブエージェントごとに指定できる**(前回未確認事項への回答)。schema の `model` フィールド(`agent-swarm.ts:51-56`)は「ツール説明中の "Available models" に列挙されたエイリアスのいずれか、または呼び出し元と同じモデルを使う `"primary"`」を受け取る。このプールは `[secondary_model]` config セクションで定義し、各エイリアスは `[models]` テーブルの既存エントリを指す(`docs/en/configuration/config-files.md:191-244`)。**`[secondary_model]` は 0.42.0(2026-09-09)で experimental フラグが撤去され常時有効化**(changelog 0.42.0)。
- `MAX_AGENT_SWARM_SUBAGENTS = 128`(`agent-swarm.ts:7`)、`DEFAULT_SWARM_TIMEOUT_MS = 2h` / env `KIMI_CODE_SWARM_TIMEOUT_MS`(`packages/agent-core-v2/src/features/swarm/configSection.ts:19-21`)は前回報告のまま不変。
- ランプアップ既定(最初5体即時 → 700msごと1体、既定は同時実行数上限なし)も `docs/en/reference/tools.md` の `AgentSwarm` 節にほぼ同文で明記されており不変。

## 2. 「任意の OpenAI 互換エンドポイントで動くか」— ベンダー文書で明確に肯定(前回未調査点への回答)

`docs/en/configuration/providers.md`(vendor 一次情報)に明記:
> "`openai`: For connecting to the OpenAI Chat Completions protocol, **as well as any third-party service compatible with that protocol** (override `base_url` as needed)." (`docs/en/configuration/providers.md`, `openai` セクション)
> "Third-party reasoning models (DeepSeek, Qwen, One API, etc.) work out of the box"

`ProtocolSchema = z.enum(['anthropic', 'openai', 'openai_responses', 'google-genai'])`(`packages/agent-core-v2/src/llm-adapter/protocol/protocol.ts:11`)、`ProviderConfig` に `baseUrl` / `apiKey` / `apiKeyEnv` フィールドあり(`packages/agent-core-v2/src/llm-adapter/provider/provider.ts:13-25`)。`Model` インターフェースにも `baseUrl?: string` あり(`packages/agent-core-v2/src/llm-adapter/model/catalog.ts:19-25`)。
→ 「子(サブエージェント/Swarm item)に別モデルを割り当てられるか」「任意の OpenAI 互換エンドポイントで動くか」の両方に、**ベンダー文書レベルで肯定できる**。LiteLLM をローカルプロキシとして立てている構成(手元の pi/omp 運用)は、`type = "openai"` + `base_url` で `[secondary_model.models]` プールに登録すれば Swarm/Agent の子に別モデル(tier)を割り当てられる、と読める。ただし **これは私が仕様から導いた組み合わせ確認であり、LiteLLM 経由での実運用報告は見つかっていない**[unverified、精読による推論]。

### 負の実例: モデル未エンタイトルで全滅・フォールバック無し
GitHub Issue #3748(open, 2026-09-13)は「`[secondary_model].default_model` が現在の契約でアクセス不能なモデルを指すと、**すべての Agent/AgentSwarm 起動が 401 で即死し、フォールバックも警告もなく、resume でも直せない**」と報告(Moonshot 管理の OAuth サブスクリプション環境での再現だが、モデル解決ロジック自体は provider 種別に依らない)。
https://github.com/MoonshotAI/kimi-code/issues/3748
> "Spawning with explicit `model: "primary"` (or a pool alias on an entitled model) worked, confirming entitlement, not connectivity." / "`resume_agent_ids` could not repair the failed agents: per the tool contract, resumed agents keep their original model, so resuming the 401-dead agents just re-failed with the same 401."
教訓: `[secondary_model]` に子用モデル(LiteLLM tier 等)を設定する場合、その解決失敗は「全滅・無警告・resume でも直らない」モードになり得る。手元の「fail-open ではなくフォールバック禁止」方針(2026-09-27 のモデルカタログ裁定)と相性は良いが、**エラーの出方がサイレントに近い**点は要注意。

### 負の実例: 自前 OpenAI 互換プロバイダ運用で swarm_mode がサイレントに無視される
Issue #3830(open, 2026-09-16)、報告者は明記:
> "Which open platform/subscription were you using? N/A — self-hosted OpenAI-compatible provider (custom `openai` provider in config.toml). Reproduces without any account login."
https://github.com/MoonshotAI/kimi-code/issues/3830
web サーバの `POST /api/v1/sessions/.../prompts` が `plan_mode`/`swarm_mode` フィールドを schema には持つがハンドラで読んでいない(`packages/kap-server/src/routes/prompts.ts` root-caused by 報告者本人)。**新規セッションの最初のターンで Swarm モードが有効化されない**バグ。これは自前 OpenAI 互換プロバイダを使う運用者からの実測報告であり、practitioner レンズと issue-tracker レンズが重なる一次情報。

## 3. TUI 表示 — 大枠不変、パフォーマンス起因の複数バグ修正が集中

- `apps/kimi-code/src/tui/components/messages/agent-swarm-progress.ts` は 1,757行→**2,024行**、`agent-swarm-progress-estimator.ts` は 436行→**455行**に増加(`wc -l`, 09-24 HEAD)。設計(点字バー・比例セグメントバー・兄弟タスクからの進捗推定・2段階レイアウト適応)は前回報告の記述と一致し、根本設計変更はない。
- ただし 09-15 リリース(0.43.1)で表示・安定性に関わる複数バグが同時に修正されている(vendor changelog, `docs/en/release-notes/changelog.md:79-97`):
  > "Fix pressing Ctrl+C while subagents are running exiting the whole CLI instead of just interrupting the subagents."
  > "Fix progressively slower rendering on each round of large agent swarm runs."
  > "Fix memory not being released when subagent scopes are disposed."
  > "Reduce event-loop stalls and GC churn in sessions with many concurrent subagents."
  前回レポートは「Ctrl-C は AbortSignal 連鎖で全タスクに正しく伝播する」と好意的に評価していたが、**前回 clone 時点(09-12)のコードは実際には「Ctrl+C で CLI 全体が落ちる」バグを抱えていた**可能性が高い(修正は3日後の 09-15)。対応 PR: https://github.com/MoonshotAI/kimi-code/pull/3779(`fix(agent-core-v2): keep swarm cancellation from crashing the CLI`)。「大規模 swarm を回すごとに描画が段々遅くなる」レンダリング劣化バグも同時期に存在していた(対応 PR https://github.com/MoonshotAI/kimi-code/pull/3777 `perf(tui): batch and cache agent swarm progress rendering`)。
- 09-23 の PR #3970(`fix: restore swarm members from persisted lifecycle events`)は前回レポートの「未確認事項: CLI プロセス完全再起動後に resume できるか」に直接関わる負の実例:
  https://github.com/MoonshotAI/kimi-code/pull/3970
  > "After restarting the server with a foreground Swarm still in progress, reopening the conversation shows no members. The child conversations remain on disk, but their spawn and completion events were transient, so the cold transcript cannot reconstruct the member tasks or their parent tool calls."
  > "Existing conversations recorded before this fix do not contain the required association facts and cannot be reconstructed reliably."
  → **09-22 以前は「サーバ再起動をまたいだ swarm メンバー一覧の復元」が壊れていたことが公式に確定**。09-23 の修正以降のセッションでのみ改善され、それ以前の記録は直せない。

## 4. Tower モード — 前回レポートに存在しない、Swarm の弱点を埋める別機能(重要な見落としの訂正)

前回レポートは Swarm の弱点として「mailbox も共有タスクリストもクレームもない」「stall/暴走検出がタイムアウトのみ」を指摘していたが、**kimi-code には Swarm と並存する別の実験機能 `Tower`(`packages/agent-core-v2/src/features/tower/`, 計 4,865行)が既に存在し、まさにその欠落を埋める設計になっている**。前回精読(09-12版)はこの機能に一切言及しておらず、見落としだったと判断する。

- 導入は 0.39.0(2026-08-27, changelog)、前回 clone(09-12)時点で既に存在していたはずのコード。現在も **`KIMI_CODE_EXPERIMENTAL_TOWER=1` または `[experimental] tower = true` で有効化する実験機能、既定 false**(`packages/agent-core-v2/src/features/tower/flag.ts:6-16`)。専用の docs ページはまだ無く、`docs/en/guides/web.md:53` に一行 "(experimental)" と書かれているのみ。
- ツール一式: `TowerInit / TowerPlan / TowerSpawn / TowerMerge / TowerTeardown / TowerSend / TowerInbox / TowerFinding / TowerReview / TowerMission / TowerStatus`(`packages/agent-core-v2/src/features/tower/towerFeature.ts:44-54`)。
- **設計の中身**(各ツール `.md` を精読、`packages/agent-core-v2/src/features/tower/tools/*/*.md`):
  - `TowerInit`: `.tower/`(comms 状態・inbox・findings・reviews・missions・activity log・worktree slots)をリポジトリ直下に作る。ベースブランチを記録し、以後のミッション/マージはこれを基準にする。
  - `TowerPlan`: 目標をミッション(M1, M2, …)に分割し、各ミッションに固有ブランチ(`feat/<slug>`)と**隔離された git worktree**(`.tower/worktrees/wt-N`)を割り当てる。ミッションのスコープはペアワイズ disjoint 強制。
  - `TowerSpawn`: ミッションをバックグラウンドのサブエージェントとして起動し roster に登録。ベースチェックアウトに未コミット変更があればスナップショットコミットとして先頭に載せる(base の WIP を子ブランチへ取り込む工夫)。
  - `TowerSend`/`TowerInbox`: **エージェント間メッセージング(mailbox)**。ロースター名宛て・"tower" 宛て・"all" ブロードキャストが可能。Swarm には存在しなかった機構がここにある。
  - `TowerFinding`: 担当スコープ外の気付き(bug/improve/vuln/idea)を構造化して `.tower/comms/findings/` に投げ、tower がルーティング。
  - `TowerMerge`: **レビューゲート付きマージ**。「最新レビューが `clean`」「依存ミッションが全てマージ済み」「変更ファイルがミッションの宣言スコープ内」の3条件をストアが強制、満たさなければ拒否理由を返す。`--no-ff` マージ。
  - `TowerReview`: ブランチ tip にスタンプされたレビュー verdict。verdict が non-clean だと該当ミッションは自動的に completed→active に巻き戻る。
  - `TowerMission`: ミッションのステータス機械(planned → active → completed → merged、merged のみ final)、`task_done`/`task_drop`/`blocker` の更新。
  - `TowerStatus`: kubectl 風ではなくテキストダッシュボード(ミッション状態・roster・各未マージブランチのレビューゲート状態・inbox件数・activity log 末尾)。**専用のライブ TUI パネルは見つからなかった**(`apps/kimi-code/src/tui` 配下に tower 専用の描画コンポーネントは無く、`apps/kimi-code/src/tui/commands/tower.ts` というスラッシュコマンドハンドラのみ確認)。Swarm の `agent-swarm-progress.ts` に相当する常時可視化 UI は Tower には無く、状態確認は `TowerStatus` ツール呼び出しのテキスト応答に依存する、という対比になる。
- **Tower と Swarm は排他**: PR #3976(`feat(tower): enforce protocol invariants and deny AgentSwarm`, 2026-09-23)が Tower モード中の `AgentSwarm` 呼び出しを拒否するよう変更している。 https://github.com/MoonshotAI/kimi-code/pull/3976 (title のみ確認、本文は未取得)
- Issue #3897(`feat: add usage telemetry for swarm, tower, external hooks, and remote control`, 2026-09-18)により、swarm と tower の使用量テレメトリが追加された(Moonshot 側のテレメトリであり、ユーザー向けのコスト上限機構ではない点は Swarm と同じ)。

**この Tower モードは前回レポートの「反面教師」評第1〜3項(mailbox不在・コスト上限不在・stall検出なし)のうち mailbox 不在の指摘に対する、ベンダー自身の別解と見なせる。** ただしコスト上限不在は Tower にも見当たらない([unverified、`.tower` 関連コードに budget/maxCost 系の grep ヒットなし、確認は簡易]。

## 5. 実践者レンズ — マーケティング系二次情報が大半、名指し実践者は乏しい

WebSearch で見つかった記事の大半(zentor.ai, o-mega.ai, codeagentswarm.com, mayhemcode.com, nxcode.io, lorphic.com, Verdent, DataCamp)は**SEOコンテンツ寄りの二次情報で、著者個人の実運用記録ではない**。うち複数が「Kimi K2.6/K3 Agent Swarm(300サブエージェント、BrowseComp 78.4%)」を **kimi-code CLI の AgentSwarm ツール(上限128)と混同・並記**している。実際には Kimi.ai チャット製品自身の "Agent Swarm"(`https://www.kimi.ai/blog/agent-swarm`)と kimi-code CLI の `AgentSwarm` ツールは**別の実装**であることをベンダーブログ直読で確認した:
> "Agent Swarm is part of the core Kimi AI platform, available to 'top tier subscribers.'" / "up to 100 sub-agents working in parallel" / "an early research preview... future improvements planned for direct sub-agent communication" (kimi.ai/blog/agent-swarm, WebFetch 経由の要約 — summarizer 越し、原文未確認[要約経由])
→ チャット製品側の Agent Swarm も **この時点(投稿時)ではエージェント間直接通信を欠く**とベンダー自身が認めている。CLI 側の mailbox 不在という前回の指摘と平仄が合う。

唯一の実質的な「他ハーネスへの移植」実例: **`wweir/tower-do`**(pi コーディングエージェント向け拡張、"Kimi Tower style orchestration")。
https://github.com/wweir/tower-do — **star 0**、`created_at 2026-09-06`、`pushed_at 2026-09-23`(直近3週間以内、活発に更新中だが採用実績ゼロ)。license MPL-2.0。README(WebFetch 要約、原文未確認[要約経由]):
> "tower-do is a Pi extension that enables multiple coding agents to coordinate work through a shared task board." / 状態は `~/.pi/tower-do/<project>/board.jsonl` の単一 append-only JSONL。 / "advisory warnings you resolve by messaging, never gates that block you"
Kimi の Tower との違い: **git worktree 隔離やレビューゲート付きマージは見当たらず**、"advisory" (助言のみ、ブロックしない) という軽量版の移植。ユーザーの pi ハーネス移植を検討する際の直接の先行事例だが、**利用実績ゼロ**であり、動作実績としての裏付けにはならない。

Hacker News(`news.ycombinator.com/item?id=46778695` 等)は kimi-code 発表時のスレッドで、Swarm/Tower に特化した突っ込んだ運用談は見当たらず、機能紹介レベルのコメントに留まる[要約経由、個別コメント本文は未読]。

## 6. 測定レンズ — Swarm/Tower 固有のベンチマークは無い。ある数字は Kimi.ai チャット製品側のもの

- kimi.ai ブログの "1,500 tool calls" "4.5x faster than sequential" は上記の通りチャット製品の Agent Swarm(research preview)の数字であり、**kimi-code CLI の AgentSwarm/Tower の測定ではない**。
- alphasignalai.substack.com の "BrowseComp 78.4%" もモデル(K2.6)自身のエージェント能力の話で、CLI のオーケストレーション実装の性能測定ではない[要約経由、一次論文/リーダーボードへの遡り未実施]。
- kimi-code 自身のコスト・トークン計測はサブエージェント単位の `TokenUsage` 記録(前回報告どおり)のみで、公開ベンチマークは見当たらない。「no numbers」。

## 7. ライセンス

`MIT License, Copyright (c) 2026 Moonshot AI`(`LICENSE` 直読、`be7d5f5f` HEAD)。前回と変わらず寛容なライセンス。

## まとめ表

| 観点 | 前回(09-12, ee2cac10) | 今回(09-24, be7d5f5f) | 出典 |
| --- | --- | --- | --- |
| Swarm上限/タイムアウト | 128体、既定2h | 不変 | `agent-swarm.ts:7`, `configSection.ts:19` |
| 子へのモデル割当 | 未調査 | 可能。`[secondary_model.models]` エイリアス経由、`model:"primary"` も可 | `agent-swarm.ts:51-56`, `docs/.../config-files.md:191-244` |
| 任意OpenAI互換エンドポイント | 未調査 | ベンダー文書で明記(`type="openai"` + `base_url`) | `docs/en/configuration/providers.md` |
| Ctrl+C安全性 | 「正しく伝播する」と報告 | 実際は09-15まで「CLI全体が落ちる」バグがあった | changelog 0.43.1, PR #3779 |
| 再起動後resume | 未確認と明記 | 09-22以前は壊れていたと公式確認、09-23修正、旧セッションは復旧不可のまま | PR #3970 |
| mailbox/共有掲示板 | 「無い」と結論 | Swarmには無いが、別機能Tower(experimental)にはある | `features/tower/tools/{send,inbox}` |
| stall検出 | タイムアウトのみ | 変化なし(Towerにも見当たらず) | 精読 |
| 他ハーネスへの移植実績 | 未調査 | pi向け `wweir/tower-do` が唯一、star 0 | GitHub API |

## 確認できなかったこと

- LiteLLM を `type = "openai"` プロバイダとして kimi-code の `[secondary_model]` プールに接続し、実際に Swarm/Agent の子を別 tier で走らせた一次報告(practitioner/issue いずれにも見当たらず)。仕様上は可能と読めるだけ[unverified]。
- kimi.ai ブログおよび `wweir/tower-do` README は WebFetch の要約経由であり、原文ページを直接読んでいない[要約経由]。
- PR #3976(Tower が AgentSwarm を拒否する変更)の本文詳細は未取得(title のみ)。
- Tower モードのコスト上限・予算機構の有無は簡易 grep のみで判断しており、深い精読はしていない[unverified]。
- kimi.ai チャット製品の Agent Swarm(300体/BrowseComp 78.4%)の一次ベンチマーク論文・公式リーダーボードへの遡及はしていない(二次記事止まり)。
- Hacker News スレッドの個別コメント本文は読んでおらず、タイトル一覧のみ確認。
- `apps/vis`(web UI)側の Swarm/Tower カード実装の詳細(前回からの持ち越し未確認事項)は今回も未着手。
