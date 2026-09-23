---
question: "モデル階層ルーティングを実装するとき、メインセッションのモデルを毎プロンプト切り替える（pi/ompの現行実装）のは業界で認められた慣行か。代替案(A)サブエージェント委譲 (B)ゲートウェイ側ルーティング (C)手動エスカレーションと比べてどう位置づけられるか"
date: 2026-09-23
scope: "domains/dev/llm/harness/rules/research/2026-09-22-paradigm-judgment-model.md が確立した「モデル階層ルーティングはRouteLLM/Hybrid-LLMで実証済み」を前提とし、その実証はモデル選定ロジックの正しさについてであって、実装形態(誰が・どこで・いつモデルを切り替えるか)については何も述べていない。本記録は実装形態だけを扱う。"
---

# メインセッションのモデルを毎プロンプト切り替えるのは業界で認められた慣行か

## 方法・検証凡例

- **直接取得**: WebFetch で一次ドキュメント/READMEを取得（要約バイアスに注意 — 取得エージェントが本文を要約しているため、引用符号内のみ逐語とみなす）
- **API直接**: `curl` で GitHub REST API を直接叩いた結果（gh CLI はこのセッションでTLS検証エラーのため使用不可、`gh auth token` で取得したトークンを curl に渡して代替）
- **未到達**: WebSearch はこのセッション開始前に既に200/200消費済みで、本タスクの検索は一件も実行できなかった。既知URLへの WebFetch のみで代替。到達できなかった箇所は都度明記する。
- 日本語本文、引用は原文（英語）のまま逐語。

---

## 1. ベンダー — セッション内でのモデル選択方式

**Claude Code — メインセッションは自動切替しない。** [直接取得, https://code.claude.com/docs/en/sub-agents]
> "The main session **does not automatically switch models** based on task difficulty. It maintains a single model for the entire session, selected at launch with the `--model` flag or the `model` setting in `.claude/settings.json`. Only subagents can use different models than the main conversation."

サブエージェントのモデルは静的な優先順位チェーンで解決される:
> "1. The per-invocation `model` parameter / 2. The subagent definition's `model` frontmatter... `inherit` selects the main conversation's model / 3. `CLAUDE_CODE_SUBAGENT_MODEL`... / 4. The main conversation's model"

全サブエージェントを一つのモデルに強制する専用スイッチまである:
> "To apply one model to every subagent... also set `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` to `1`."

**Codex CLI — プロファイル切替も静的、ターン単位の自動切替なし。** [直接取得（要約経由）, https://learn.chatgpt.com/docs/config-file/config-advanced]
> "Profiles let you save named configuration layers and switch between them from the CLI." 例: `model = "gpt-6-sol"` / `model_reasoning_effort = "medium"`。`codex --profile profile-name` で起動時に切替。
> 「Automatic Model Switching: No... The documentation contains no mention of any automatic per-turn model selection mechanism.」（取得エージェントの要約、本文に自動切替の記述なしという事実確認）

**opencode — `small_model` は補助タスク専用、メインは自動切替しない。** [直接取得（要約経由）, https://opencode.ai/docs/config/]
> "The `small_model` option configures a separate model for lightweight tasks like title generation. By default, OpenCode tries to use a cheaper model if one is available from your provider, otherwise it falls back to your main model."
メインエージェントのターンごとの自動切替への言及なし。

**Roo Code — モードごとに Sticky Model、切替は手動かオーケストレータ経由。** [直接取得, https://roocodeinc.github.io/Roo-Code/features/custom-modes]
> "Each mode—including custom ones—features **Sticky Models**. This means Roo Code automatically remembers and selects the last model you used with a particular mode."
自動モード切替は Orchestrator（Boomerang）モードの `switch_mode` ツール経由に限定される、つまり「タスクの難易度を見て毎プロンプト判定」ではなく、明示的なオーケストレーション構造の中でのサブタスク委譲。

**Cline — Plan/Act で別モデル、切替は手動トグルに連動した自動反映。** [直接取得（要約経由）, https://docs.cline.bot/features/plan-and-act]
> "When enabled, switching between Plan and Act mode automatically switches to the configured model for that mode."
ここでの「automatic」はモード切替（ユーザーの明示操作）に付随する結果であり、判定モデルによる毎プロンプト自動切替ではない。

**Aider — architect/editor は静的な二モデル構成、ベンチマーク数値あり。** [直接取得（要約経由）, https://aider.chat/docs/usage/modes.html, https://aider.chat/2024/09/26/architect.html]
> "When you are in architect mode, aider sends your requests to two models: First, it sends your request to the main model which will act as an architect... Aider then sends another request to an 'editor model'..."
ベンチマーク（要約経由の数値、原文未確認 — [unverified]）: o1-preview+o1-mini/deepseek で 85.0%、o1-preview+claude-3-5-sonnet で 82.7%。単体ベースラインは o1-preview 79.7%、Claude 3.5 Sonnet 77.4%、GPT-4o 71.4%、o1-mini 61.1%。**毎ターン切替ではなく固定ペア**であることが数値の前提。

**pi / oh-my-pi — 唯一、メインセッションのモデルを実際に切り替える一級機能を持つ。** [API直接, github.com/earendil-works/pi, github.com/can1357/oh-my-pi]
pi 本体には `/model` によるユーザー主導切替、`/switch`、MRU切替、モデルロール/プロファイル機能があり、拡張機構（`before_agent_start` 等のフック）を通じて外部ロジックがモデルを切替えられる `setModel` API面が存在する（コード検索 "setModel" は earendil-works/pi 上で35件ヒット、oh-my-pi 上で124件ヒット、拡張機構の型定義ファイル含む）。owner の pi/omp 実装（判定サービスが `before_agent_start` でメインモデルを切替える）は、この一級 API 面の上に構築されている点で技術的には「サポートされた使い方」だが、**以下§4で見るように pi/omp 自身の課題管理は、この機能が壊れやすいことを継続的に記録している**。

**確認できなかったこと（ベンダー節）**: Cursor は本タスクでは一次資料に到達できず [未到達 — WebSearch枯渇、URL推測もこのラウンドでは試行せず]。opencode のメインモデル自動切替が本当に皆無かは公式ドキュメントの沈黙からの推論であり [unverified]。

---

## 2. ゲートウェイ側ルーティング（LiteLLM / RouteLLM / OpenRouter / Not Diamond / Martian）

**LiteLLM Router — 本体は負荷分散/フェイルオーバーが主目的、タスク難易度判定はスコープ外。** [直接取得（要約経由）, https://docs.litellm.ai/docs/routing, https://docs.litellm.ai/docs/proxy/reliability]
サポートするルーティング戦略: simple-shuffle（既定）、latency-based、usage-based、least-busy、cost-based、custom。
> "Fallbacks are how LiteLLM does automatic **failover**. If a call fails after num_retries, LiteLLM falls back to another model group..."
取得エージェントの要約: 「no mention of capability-tier assessment or task-complexity judgment routing... routing decisions are reactive... or based on predefined rules... not on analyzing incoming requests to determine their computational needs.」— つまり LiteLLM 自体は RouteLLM 型の「難易度で強い/弱いモデルを選ぶ」判定はしない。タグベースルーティングも同様に明示的/ヘッダーマッチであり、内容解析ではない。
> "Use `tag_regex` on a deployment to match incoming requests by their headers (e.g. `User-Agent`) without requiring the client to send explicit tags."

**マルチターン会話に対する明示的な指針: Session Affinity（Sticky Sessions）。** [直接取得, https://docs.litellm.ai/docs/routing]
> "Pin[s] every request of a conversation to the deployment that served its first request."
> "Use it when the deployments behind a model group do not share state, for example provider-side prompt caching, or when a conversation has to stay in one region."
これは LiteLLM 自身が「会話の途中でデプロイメントを変えるとプロバイダ側プロンプトキャッシュが壊れる」ことを設計上の既知の懸念として扱っている直接証拠であり、**ゲートウェイの標準的な立場は「会話単位で固定、単発リクエスト単位では変えてよい」**という区別を示している。

**RouteLLM（論文＋リポジトリ）— シングルターン専用、マルチターンは非対象、リポジトリは2年停滞。** [直接取得, https://ar5iv.labs.arxiv.org/html/2406.18665]
> ベンチマークは MT Bench（160問、LLM-as-a-judge）、MMLU（14,042問）、GSM8K（1,000+問）。取得エージェントの要約: 「RouteLLM focuses on **single-turn queries**, not multi-turn conversations... routing function operates once per query (q→decision), with no provision for maintaining context across model boundaries or handling sequential exchanges.」
> 論文の限界の節: "although we evaluate on a diverse set of benchmarks, real-world applications may have distributions that differ substantially from these benchmarks."
**マルチターン内での切替の是非について論文は何も述べていない** — 09-22 の先行記録が既に指摘した通り、この実証は「難易度を見て強弱モデルを選ぶ」ことの正しさについてであり、「会話の途中で選び直す」ことの安全性については無評価。
リポジトリ状態 [API直接]: `lm-sys/RouteLLM`、★5,536、`pushed_at: 2024-08-10T19:10:15Z`。本調査時点(2026-09-23)で**約2年更新なし**。研究成果として広く引用されるが、本番ゲートウェイ部品としては保守されていない。

**OpenRouter `auto` router — ターンごとに再評価するが、セッション粘着性(sticky)を持つ。** [直接取得, https://openrouter.ai/docs/features/model-routing]
> "automatically selects the best model for your prompt" — 直近7日間の匿名化支出統計から約30タスク種を分類。
> "remembers the model a conversation landed on and prefers it on later turns" — ただし "When the conversation shifts to a different kind of task, a better-suited model can win instead."
> "You pay the standard rate for whichever model is selected. There is no additional fee for using the Auto Router."
品質劣化への明示的警告は見当たらない。**「ターンごとに毎回ゼロから候補を再ランク付けする」("still ranks candidates from scratch on each turn")** ため、原理的には pi/omp と同じ「毎プロンプト再判定」だが、粘着性ロジックで頻繁な切替を抑制している点が異なる。

**Not Diamond — 到達できず。** [未到達 — WebSearch枯渇のため会社の現況（縮小/停止報道の有無）を確認できなかった]

**Martian (withmartian.com) — トップページはモデルルーター製品ではなく研究組織としての体裁、ルーター機能の記載なし。** [直接取得, https://withmartian.com/]
取得エージェント要約: 「cannot find any information about a Martian model router product... does not describe a model router product or discuss routing capabilities across conversations.」— 過去に想定されていたモデルルーター事業の現在の公開面での位置づけが不明瞭であることの間接証拠 [unverified、企業の事業転換の有無は未確認]。

**確認できなかったこと（ゲートウェイ節）**: Not Diamond の現況、Martian のルーター製品の実在有無、両社の会話単位ルーティングに関する明示的な立場。

---

## 3. 測定された証拠 — 切替のコスト

**プロンプトキャッシュ破棄 + コンテキストウィンドウ超過、実測値つき。** [API直接, github.com/davila7/claude-code-templates issue #972]
davila7/claude-code-templates（★31,281、`pushed_at: 2026-09-23`、活発）上の `jev-model-router` mod（Claude Code の `before_agent_start` 相当のフックでメイン処理ループのモデル/effortを毎ターン判定してルーティングする、owner の pi/omp 実装と同型の設計）の Issue #972 本文（作者 meesp123 名義のPR、内容は実測ログを伴う）:

> "**Effort.** Claude Code's prompt-caching page: on Opus 5.5 and Fable 5.1 (API key or subscription) an effort change keeps the cache; on other models each effort level has its own cache. Measured with a test mod... (Claude Code 2.1.280, a ~27k-token conversation): the first turn at a new level read 9.7k from cache instead of 26.7k on Sonnet 5, and 1.4k instead of 21.0k on Opus 5. Opus 5.5 read 20.2k either way. A Sonnet 5 session routed low → high → low paid that on every flip."

> "**Model.** A context larger than the new model's window is not refused, it is compacted: a 283k-token Opus 5.5 [1m] session sent to Haiku 4.5 got `prompt is too long: 216737 tokens > 200000 maximum`, and Claude Code's reactive compaction summarised the session down to its last 2 messages. The next Opus turn read 7k tokens."

これは「毎プロンプトでメインループのモデル/effortを切替える」実装が実際に運用され、実測値つきで壊れた/損をした具体例。修正方向は「安全なモデル群だけ effort 切替でキャッシュ維持、それ以外は effort をリスクが上がる/モデルも変わる場合以外は固定する」("effort held: changing it on this model drops the prompt cache")。

**サブエージェントのeffort/モデル決定は別経路として扱われている。** [API直接, github.com/davila7/claude-code-templates issue #971]
> "the Agent tool takes no effort, so a subagent's effort was not its to set. A subagent therefore runs at the session's configured effort, not the main loop's routed one"
→ 修正として、サブエージェント生成時点でその決定を明示的に紐付ける専用機構 (`routeSubagentEffort`) を追加している。つまりこのプロジェクトの実装者自身が、メインループの動的切替とサブエージェントの切替を**別のバグクラス**として扱っている。

**クロスモデルの thinking/reasoning ブロック処理不良（複数の独立報告、修正まで数週間かかった実例）。** [API直接, github.com/earendil-works/pi issue #6167]
> "when the user switches models, `transformMessages` will normalize non-redacted/plain-text thinking content by inlining it into the assistant message content... strips the reasoning content from the assistant message block before it arrives at the checks around `requiresReasoningContentOnAssistantMessages`... it does make the model a wee bit confused about what's going on (or at least it makes `glm-5.2-fp8` via vLLM a little confused)."
コメント欄で独立に4名（maximilize, nolanchic, Acters, Semidia）が同一クラスの不具合を別モデルペア（Claude→DeepSeek系、k2.7→k3）で再現・確認し、それぞれ独自のワークアラウンドやパッチを提案:
> nolanchic: "ran into this same issue when switching from Claude over to a DeepSeek-style model with `requiresReasoningContentOnAssistantMessages: true` enabled. The `reasoning_content` field ends up empty, and all the reasoning text gets duplicated straight into the main `content` field instead."
> Acters: "Appending dummy tags like `<reformatted-pre-switch-reasoning>` may work. I had been experiencing this when I switch between k2.7 to k3. Adding the dummy tag stops the issue. It is a strange problem to have."

**無制限サイズのクロスモデル思考テキストがコンテキストウィンドウを溢れさせる。** [API直接, github.com/earendil-works/pi issue #9433]
> "Switching models mid-session replays the previous model's reasoning as plain assistant text **with no size bound**, which can push the request past the destination model's context window... a 445,888-char / 131,072-token thinking block with `glm5.3-flash`... After `--model nan/qwen3.6`, the outgoing... payload contained an assistant message with `content` = 445,888 chars."
（この issue は新規投稿者の自動クローズ対象になっており、メンテナのレビュー待ちのまま — 品質そのものより issue トリアージの運用状況を示す）

**プロンプトキャッシュの偽陽性ミス分類。** [API直接, github.com/earendil-works/pi issue #9013]
> "`showCacheMissNotices` emits **false-positive** `Cache miss: 59k tokens re-billed` on a **local vLLM / openai-completions** model that never reports `cacheRead`/`cacheWrite`, after the same session briefly used a cloud model that *does* report cache."
モデル切替の直接コストではないが、切替を経由したセッションでキャッシュ会計が壊れる形の周辺不具合。

**Aider architect/editor のベンチマーク数値は§1に記載済み** — ただしこれは固定ペアの評価であり、動的切替のコストではなく静的分業の効果を示す数値。動的切替のコストを直接測った公開ベンチマークは今回到達できなかった。 [確認できなかったこと]

---

## 4. 実践者と公開リポジトリ — 実際にやっている人、何が壊れたか

**pi-model-router（ssccio、個人開発、実質未採用）。** [API直接, github.com/ssccio/pi-model-router]
★0、`pushed_at: 2026-05-01`（本調査時点で約4.5ヶ月更新なし）。README の設計は owner の pi/omp 実装と同型:
> "Pi Agent extension that routes each request to the right model tier — local, cloud, or premium — based on task complexity. A small local model scores the prompt 1–10; that score decides which model actually answers it."
重要な設計選択: **対話的な長時間タスク（ブレインストーミング、実装計画）は毎プロンプト切替の対象から外し、`delegate_to_cli` ツールで別プロセス(tmux内のClaude Code)にサブエージェント委譲する**:
> "For long interactive tasks (brainstorming, implementation planning), the `delegate_to_cli` tool spawns a Claude Code session in tmux, runs the full workflow autonomously, and returns the output file to Pi."
つまりこの実践者は「短い単発質問は毎プロンプトのゲートウェイ的切替」「長い対話的作業はサブエージェント委譲」というハイブリッドに自然に収束しており、**メインセッションのモデルを長時間タスクの途中で切替える設計を自ら避けている**。ただし採用（★0）と更新停止から、この設計自体が広く検証されたとは言えない。

**jev-model-router（davila7/claude-code-templates 内、活発なプロジェクト内の一機能）。** §3で詳述。実測ベースで「メインループの動的切替は損をしうる」ことを開発者自身が発見し、安全なモデル群を限定するガードを追加した実例。これは「試してから戻した」の一種（完全に撤回ではなく、適用範囲を絞る形の後退）。

**pi / oh-my-pi のIssueトラッカー全体像。** [API直接]
`earendil-works/pi` で "model switch" 関連の未クローズ・クローズ issue が338件ヒット（検索語 "model switch" のtitle/body一致）。抜粋: `#9902 fix(coding-agent): preserve thinking levels across model switches`（open）、`#9243 Session resume restores the model from the last assistant message's echoed name, not from model_change`（open）、`#8788 /switch and /model do not work with subagents`（can1357/oh-my-pi 側、open — メインの切替とサブエージェントの切替が別経路で、片方の変更がもう片方に伝播しないバグ）。件数の多さ自体は「よく使われている機能だから issue も多い」というバイアスもあるが、**切替まわりの相互作用バグが継続的に発生し続けている**ことは一貫している。

**名前つき個人ブログでの言及は見つからなかった。** Simon Willison のブログ（OpenRouter タグ）を確認したが [直接取得（要約経由）, https://simonwillison.net/tags/openrouter/]、取得エージェントの要約:
> 「Simon Willison does not discuss using OpenRouter's auto-router or per-prompt model switching in his own coding agent workflow... His posts focus on testing various models individually... rather than documenting his own agentic routing preferences or workflows.」
これは「試して失敗した」でも「使っている」でもなく、**言及そのものがない**ことの確認。

**確認できなかったこと（実践者節）**: Cursor/Windsurf 等、商用ハーネスのユーザーコミュニティでの同種の報告。gh search はこのセッションで WebSearch 枯渇のため GitHub API 直接検索に限定しており、issue 本文全文検索のカバレッジはツールの検索インデックス精度に依存する。

---

## 5. 否定側の証拠（同等の労力で収集）

- **RouteLLM リポジトリ自体が2年間更新停止**（§2）— 学術的な実証の最有力ソースが、本番運用コンポーネントとしては保守されていない。
- **jev-model-router が実測で「ルーティングで節約した額より切替コストの方が高くつきうる」ことを発見し、適用範囲を絞る修正を入れた**（§3, #972）— 「毎回動的に切替える」設計から「安全なモデル群のみ・リスクが上がる時だけ切替える」設計への後退。
- **pi-model-router（個人実践者の実装）が長時間タスクをメインモデル切替の対象から明示的に除外し、サブエージェント委譲に切り替えている**（§4）— 実践者が「毎プロンプト切替」を万能とは見なしていない直接証拠。
- **LiteLLM 自身が「会話の途中でデプロイメントを変えるとプロバイダ側プロンプトキャッシュが壊れる」ことを Session Affinity 機能の存在理由として明記**（§2）— ゲートウェイベンダー自身が「会話単位固定」をデフォルト推奨とする根拠。
- **pi/oh-my-pi のクロスモデル thinking ブロック処理不良が複数の独立した名前つきユーザーから報告され、修正に至るまで数週間の議論を要した**（§3, #6167）— 実装が成熟したツールでも切替特有のバグが再発し続けている。
- **Claude Code・Codex・opencode・Aiderのいずれも、メインセッションの自動per-turn切替という機能自体を持たない**（§1）— これは「持っているが誰も使わない」という否定ではなく「主要ベンダーが最初からその機能を作っていない」という、より強い形の否定側シグナル。

否定側バイアスの注記: pi/oh-my-pi の issue トラッカーは、うまく動いている大多数のセッションについては何も語らない（issue trackerは失敗側に偏る）。davila7/claude-code-templates の #972 は「発見して直した」記録であり「使うのをやめた」記録ではない——完全な撤回ではなく範囲限定という穏当な後退である。

---

## まとめ表

| 方式 | 誰が使っているか | 測定された結果 | named failure mode |
|---|---|---|---|
| メインモデルを毎プロンプト自動切替（判定モデル駆動） | pi/oh-my-pi の一級API面上に owner が構築、davila7/claude-code-templates の jev-model-router mod、ssccio/pi-model-router（短い単発質問のみ） | jev-model-router: Sonnet 5で26.7k→9.7kキャッシュ読込、Opus 5で21.0k→1.4kキャッシュ読込（effort切替時）。283k→Haiku 4.5切替でコンテキスト超過しコンパクションで直近2メッセージまで圧縮 | プロンプトキャッシュ破棄(#972)、コンテキストウィンドウ超過(#9433)、クロスモデルthinking混入(#6167、4名の独立報告)、effort/thinkingレベルのリセット(#9902)、サブエージェントへの伝播不良(#8788) |
| サブエージェントへ強いモデルを委譲、メインは固定 | Claude Code（`model:` frontmatter + 優先順位チェーン）、pi-model-router の`delegate_to_cli`（長時間タスクのみ） | ベンチマーク数値なし（Claude Code docs自体に定量比較なし）。jev-model-router #971で「サブエージェントのeffortはメインの判定と別経路」であることが実測(11–23ms先行)で確認済み | メイン↔サブエージェント間の切替が伝播しない設計上のギャップ（#8788、#971で修正対象） |
| ゲートウェイ側ルーティング（LiteLLM/RouteLLM/OpenRouter auto） | LiteLLM Router（負荷分散/フェイルオーバー中心、難易度判定はスコープ外）、RouteLLM（研究成果、★5,536だが2年停滞）、OpenRouter auto（商用、粘着性つき） | RouteLLM論文: MT Bench/MMLU/GSM8Kで強モデル同等品質を「over 2倍」安く（09-22記録の引用、シングルターン限定） | RouteLLMはマルチターンを一度も評価していない[unverified扱いされていた既知ギャップの再確認]。LiteLLMはセッション途中の切替がプロバイダ側キャッシュを壊すと明記しSession Affinityで対処を推奨 |
| 静的な二モデル構成（architect/editor、Plan/Act） | Aider（architect/editor）、Cline（Plan/Act、手動トグル連動） | Aider: o1-preview+o1-mini/deepseek 85.0% vs o1-preview単体 79.7%（[unverified、要約経由の数値、原文page未再確認]） | 該当報告なし（静的なので切替特有の不具合クラスが構造的に発生しない） |
| 手動エスカレーションコマンド | Roo Code Orchestrator の`switch_mode`ツール、pi/ompの`/model`・`/switch`（ユーザー主導） | 定量データなし | UI操作性の不具合のみ（例: oh-my-pi #12310「fast /model selection does not switch the model」）、切替の意味論的な不具合報告は無し |

---

## 平易な結論

主要ベンダー（Claude Code、Codex CLI、opencode、Aider）は、いずれも「メインセッションのモデルを毎プロンプト自動で切り替える」機能を最初から実装していない。代わりに全社が採用しているのは、静的な設定（起動時のモデル選択、プロファイル切替、architect/editor のような固定二モデル構成）か、サブエージェント/モード単位での別モデル割り当て（Claude Code の `model:` frontmatter、Roo Code の Sticky Model + Orchestrator、Cline の Plan/Act）のどちらかであり、しかもいずれも判定モデルがメインの推論ループそのものを乗っ取る形ではない。ゲートウェイ側（LiteLLM、RouteLLM、OpenRouter auto）は判定に基づくルーティングを商用/研究レベルで実装しているが、LiteLLM 自身が「会話の途中でデプロイメントを変えるとプロバイダ側プロンプトキャッシュが壊れる」ことを理由に会話単位の固定（Session Affinity）を推奨しており、RouteLLM の実証はシングルターンのクエリに限定されていてマルチターンの安全性には触れていない。一方、owner の pi/omp と同型の「メインループを毎プロンプト動的に切替える」実装は少なくとも2つの独立した公開リポジトリ（pi/oh-my-pi 本体の issue 群、davila7/claude-code-templates の jev-model-router mod）で実際に動いており、後者は実測値つきで「プロンプトキャッシュの大半を失う」「コンテキストウィンドウ超過でコンパクションが暴発する」という具体的コストを発見して安全策を追加している。pi/oh-my-pi 側では、モデル切替に起因するクロスモデル思考ブロックの混入バグが複数の独立した実践者から報告され、修正まで数週間を要した。要するに、**メインモデルの毎プロンプト自動切替は「動く」が「無傷では動かない」実装形態であり、業界の既定選択ではなく、既定選択（静的構成、またはサブエージェント委譲、またはゲートウェイの会話単位固定）からの逸脱として存在している**。この逸脱を選んだ数少ない公開実装は、いずれもキャッシュ破棄とコンテキスト境界越えという同じ2種類の失敗モードに行き着き、そのどちらも「範囲を絞る」形で後退することで対処している——完全な撤回ではないが、無条件の毎プロンプト切替からは後退している。

## 確認できなかったこと

- Cursor の一次ドキュメント（モデル選択機構）— このセッションでは未到達
- Not Diamond の現況（事業継続の有無）— WebSearch枯渇のため未確認
- Martian の現行製品にルーター機能が実在するか — トップページからは判別不能
- Aider architect/editorベンチマーク数値の一次ページでの逐語確認（要約経由の数値のみ）
- モデル切替の遅延（追加レイテンシ）を定量測定した公開データ — 今回の収集では見つからなかった
- Cline/Roo Code/opencode ユーザーコミュニティでの、動的切替を試して撤回した／継続している一次報告
- RouteLLM/Hybrid-LLMの論文がマルチターン設定でも追試された形跡（今回は見つからなかった）
