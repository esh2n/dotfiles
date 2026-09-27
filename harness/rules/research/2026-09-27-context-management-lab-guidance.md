---
question: "ラボとベンダーはエージェント内部の文脈管理（圧縮・ハンドオフ・サブエージェント隔離）をどう指示しているか、絶対トークン予算を数値で公表しているラボはあるか"
date: 2026-09-27
verdict: "絶対トークン予算を人間向けの言葉で公表しているのは Amp（Sourcegraph）だけで、答えは「200k tokens is plenty」—1M 窓でも 20%（20 万）で警告を出し、90% で自動圧縮する。Google は Gemini CLI の設定既定として 150,000 で切って 40,000 を残す絶対値を公表し、OpenAI は compaction ガイドの全 SDK 例で `compact_threshold: 200_000` をコーディングモデルに対して書く。Anthropic の絶対値は 100,000（ツール結果の自動削除トリガの既定）と 200,000（サブエージェント図の打ち切り参照）で、どちらも作業予算の推奨ではない。Cursor と Antigravity は圧縮の機構を文書化するが数値も指針も出さない。したがって omp の 200K 予算 / 170K 圧縮は『保守的』ではなく、機構レベルの指針が名指しする唯一の作業予算と一致し、OpenAI の例示値と同値である。"
unverified:
  - "OpenAI の compact_threshold にサーバ側の既定値があるか（文書は利用者が設定する値だけを示す）"
  - "Codex の自動圧縮の既定しきい値と保持内容（Manual は自動圧縮の存在しか書かない）"
  - "Gemini CLI の実験フラグ contextManagement（既定 false）の既定値が今後も同じか（保守側は PR #24157 / #24752 で文脈管理そのものを書き換え中）"
  - "Cursor の自動要約のトリガ（自動要約の文書ページが存在しない）"
  - "Antigravity に文脈管理の専用ページがあるか（llms.txt の索引に無く、索引自体が唯一の入口）"
  - "コーディングタスクでの長文脈劣化を測った研究は本スライスでは見つからず、Databricks と Lost in the Middle はいずれも QA / 検索タスク"
  - "The Complexity Trap は arXiv v1 のプレプリントで、査読通過を確認できず、コードは anonymous.4open.science 上"
  - "Cognition のブログは Devin を売るベンダー記事で数値を一切出さない"
  - "圧縮 1 回あたりのキャッシュ再構築コストを示す数値を出した一次情報は無い（前続記録も同じ [U] に到達）"
  - "Amp の『200k tokens is plenty』は Amp 社員の個人ノートで、『チーム全員がそうしている』という主張は監査されていない"
  - "Amp は非公開ソースで GitHub に本体リポジトリが無く（sourcegraph/amp は 404）、採用数や issue の野生データを取れない"
  - "sst/opencode の issue 検索は本トークンでは 404（リポジトリが検索索引に無い）"
sources_note: "URLs and quotes are inside the record; references by path, never by number."
---

# ラボとベンダーはエージェントの文脈管理をどう指示しているか — 機構と算術、絶対トークン予算の有無

**Research date:** 2026-09-27. **Slice:** ラボ／ベンダーの一次文書（four lenses の 1 と 4）と、計測エビデンス（3）のうち前続記録が扱っていないもの。著名人の運用（lens 2）は `2026-09-27-practitioner-agent-approval-practice.md` と並走の担当が持つ。

**重複させない範囲:** 窓の 50% 既定（Gemini CLI）、90% 台（Cline / Crush / OpenCode / pi）、Claude Code の約 967K とゲートウェイ 200K、Codex の 258K クランプ、RULER / NoLiMa / Chroma context rot / Breunig、Cline #14329 / pi #9482 / DeepSeek #5800 は `2026-09-27-compaction-defaults-across-harnesses.md` と `2026-09-24-context-window-budget-for-1m-models.md` が一次取得済み。本記録はそれらをパスで参照し、再導出しない。本記録が足すのは (a) ラボ／ベンダーが公表している**絶対トークン数**、(b) 圧縮・削除・記憶・サブエージェントという**機構の中身と代償**、(c) コーディングタスクでの機構比較測定、(d) 野生の issue にある実測値。

## 方法と検証凡例

- **DIRECT** — このセッションでこの調査連鎖が直接取得したページ（Markdown 版・ネイティブ HTML・GitHub API・arXiv のいずれか）。リーダーモード変換はページの飾りを落とすので、**語の不在は弱い証拠**、語の存在は強い証拠として扱う。
- **TRANSCRIBED** — 第三者が原文を再掲しているもの。本記録では該当なし（すべて DIRECT）。
- **UNREACHABLE** — 取得できなかったもの。「見つからない」は**到達不能**を意味し、不在の証明ではない。

発見の制約: `web_search` はこのセッションを通じて全プロバイダで失敗した。以下の URL はすべて `read` による直接取得である。`https://ampcode.com/docs/llms.txt` は HTTP 404（索引が無い）ため、Amp は `sitemap.xml` から辿った。

先に 2 つの限界を書く。第 1 に、ベンダー文書は**既定値**を書き、採用を望むベンダーは摩擦の少ない既定を書く誘因を持つ。第 2 に、商業利害を各有名どころに付す（Amp→Sourcegraph、Cognition→Devin、Databricks→RAG 商材、JetBrains→IDE、Anthropic/OpenAI/Google/Cursor→自社ハーネス）。

---

## 見出し表: 公表された機構・トリガ・測定効果

| 出典 | 機構 | 公表されたトリガ／予算 | 測定された効果 | 商業利害 |
| --- | --- | --- | --- | --- |
| Anthropic「Effective context engineering」[D] | 圧縮・ツール結果削除・構造化ノート・サブエージェント・JIT 検索 | 絶対値なし。「smallest possible set of high-signal tokens」 | 数値なし（原理の記述） | Claude を売る |
| Anthropic プラットフォームブログ [D] | 文脈編集＋メモリツール | 絶対値なし | **+39%**（メモリ併用）、**+29%**（編集のみ）、100 ターン検索評価でトークン **−84%** | 同上 |
| Anthropic context-editing ドキュメント [D] | `clear_tool_uses_20250919` / `clear_thinking_20251015` | `trigger` 既定 **100,000 input tokens**、`keep` 既定 **3 tool uses**、`clear_at_least` 既定なし | 数値なし。キャッシュ無効化のコストを明記 | 同上 |
| Anthropic memory tool ドキュメント [D] | クライアント側ファイル記憶 | 絶対値なし。1 ファイル **16,000 文字**で切り詰め | 数値なし | 同上 |
| Anthropic マルチエージェント研究 [D] | リード＋サブエージェント、外部記憶への計画保存 | 図の注記に **200,000 tokens**（超えると切り詰め） | **+90.2%**（社内研究評価）、トークン量が分散の **80%** を説明、**4×**（agent vs chat）/ **15×**（multi-agent vs chat） | 同上 |
| OpenAI compaction ガイド [D] | `context_management: [{type: "compaction", compact_threshold: …}]`、`/responses/compact` | 全 SDK 例で **`compact_threshold: 200_000`**（`gpt-5.3-codex`。既定値の記載なし） | 数値なし。圧縮項目は「opaque で人間可読でない」 | ChatGPT / API を売る |
| OpenAI Codex Manual [D] | `/compact`、自動圧縮、サブエージェント | 数値なし。自動圧縮の存在のみ | 数値なし | 同上 |
| Google Gemini CLI 設定 [D] | 圧縮＋実験的文脈管理（`/compress`） | **150,000** で発火、**40,000** を保持、1 ターン上限 **12,000**、ツール出力 **10,000** まで表示・**20,000** 超は要約、直近 **50,000** 保護 | 数値なし | Google のモデルを売る |
| Google Antigravity [D] | `GEMINI.md` / `AGENTS.md`、`/fork`、`/rewind`、ワークスペース単位の履歴 | 圧縮コマンドも数値も無し | 数値なし | 同上 |
| Cursor [D] | `/summarize`（別名 `/compress`） | 数値なし | 数値なし | 同上 |
| Amp（Sourcegraph）[D] | 自動圧縮、スレッド参照（`read_thread` サブエージェント）、ハンドオフ（廃止） | **「200k tokens is plenty」**、1M 窓でも **20%** で警告、**90%** で自動圧縮 | 最長スレッドは **68 回**圧縮、無圧縮なら **21M** トークン相当 | Amp を売る |
| Cognition（Walden Yan）[D] | 文脈の共有、単一スレッド、圧縮専用モデル | 数値なし | 数値なし | Devin を売る |
| The Complexity Trap（JetBrains Research）[D] | 観測マスキング vs LLM 要約 | 窓 **M=10**（マスキング）／ N=21, M=10（要約）、ターン上限 250 | SWE-bench Verified 500 件で **$0.61 vs $1.29**（−52.7%）、solve **54.8% vs 53.8%** | IDE ベンダー（推論は売らない） |
| Databricks [D] | RAG の文脈長 | 行動指針としての数値なし | 2,000+ 実験 / 13 モデル。**32k**（Llama-3.1-405b）/ **64k**（GPT-4-0125）から低下、飽和点 16k・8k・4k | RAG 商材を売る |
| Liu et al.「Lost in the Middle」[D] | 位置依存の劣化 | 推奨値なし | 文書数 20/30 で **20% 超**低下、**50 vs 20** 文書で **+1.5% / +1%** のみ | 学術（API クレジット提供あり） |

---

## 1. Anthropic: 絶対予算を出さず、機構と比率で語る

### 1.1 文脈工学の原理（DIRECT: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents 、2025-09-29）

context rot の定義はこの記事が一次情報である。

> as the number of tokens in the context window increases, the model's ability to accurately recall information from that context decreases

> While some models exhibit more gentle degradation than others, this characteristic emerges across all models.

指針は比率で、トークン数ではない。

> good context engineering means finding the smallest possible set of high-signal tokens that maximize the likelihood of some desired outcome.

圧縮の定義と、保持するものの例:

> takes a conversation nearing the context window limit, summarizing its contents, and reinitiating a new context window with the summary

> The agent can then continue with this compressed context plus the five most recently accessed files.

圧縮プロンプトの調整順序（再現率→精度）:

> Start by maximizing recall to ensure your compaction prompt captures every relevant piece of information from the trace, then iterate to improve precision by eliminating superfluous content.

最も軽い圧縮としてのツール結果削除:

> One of the safest lightest touch forms of compaction is tool result clearing, most recently launched as a feature on the Claude Developer Platform.

外部記憶（構造化ノート）:

> the agent regularly writes notes persisted to memory outside of the context window

Claude Plays Pokémon の例として引用されるノート: "for the last 1,234 steps I've been training my Pokémon in Route 1, Pikachu has gained 8 levels toward the target of 10."

サブエージェントの戻り値は要約で、これが唯一の「何トークンに収めるか」の目安である。

> Each subagent might explore extensively, using tens of thousands of tokens or more, but returns only a condensed, distilled summary of its work (often 1,000-2,000 tokens).

JIT 検索:

> agents built with the 'just in time' approach maintain lightweight identifiers (file paths, stored queries, web links, etc.) and use these references to dynamically load data into context at runtime using tools.

代償も明記する: "runtime exploration is slower than retrieving pre-computed data." **この記事に絶対トークン予算は 1 つも出てこない。**

### 1.2 測定値は platform ブログにある（DIRECT: https://claude.com/blog/context-management 、2025-09-29）

> combining the memory tool with context editing improved performance by 39% over baseline. Context editing alone delivered a 29% improvement.

> In a 100-turn web search evaluation, context editing enabled agents to complete workflows that would otherwise fail due to context exhaustion—while reducing token consumption by 84%.

機構の定義:

> automatically clears stale tool calls and results from within the context window when approaching token limits.

> enables Claude to store and consult information outside the context window through a file-based system

評価集合の記述は "an internal evaluation set for agentic search" のみで、**タスク種別はエージェント検索でありコーディングではない**。この 39% / 29% / 84% をコーディングの数字として読んではならない。

### 1.3 文脈編集 API の既定値と、キャッシュへの代償（DIRECT: https://platform.claude.com/docs/en/build-with-claude/context-editing.md ）

既定値は次のとおり（beta ヘッダ `context-management-2025-06-27`、戦略 `clear_tool_uses_20250919` / `clear_thinking_20251015`）。

- `trigger`: **100,000 input tokens**
- `keep`: **3 tool uses**
- `clear_at_least`: 既定なし
- `exclude_tools`: なし
- `clear_tool_inputs`: `false`

適用位置:

> Context editing is applied server-side before the prompt reaches Claude. Your client application maintains the full, unmodified conversation history.

キャッシュとの相互作用は、圧縮の隠れコストを明示する数少ないベンダー記述である。

> Tool result clearing: Invalidates cached prompt prefixes when content is cleared. To account for this, clear enough tokens to make the cache invalidation worthwhile.

> When thinking blocks are kept in context (not cleared), the prompt cache is preserved.

同ページは現在、サーバ側圧縮を "the primary strategy" とし、文脈編集は "specific scenarios where you need more fine-grained control" と位置づける。思考ブロックの保持既定はモデル級で変わる（Opus 4.5+ / Sonnet 4.6+ / Fable / Mythos は全保持、旧 Opus/Sonnet と全 Haiku は直近ターンのみ）。

### 1.4 メモリツールの実装上の縛り（DIRECT: https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool.md ）

> Memory supports just-in-time context retrieval.

> Claude automatically checks its memory directory before starting a task.

16,000 文字の切り詰めがあり、ベンダー自身が上限管理を求める。

> truncates the text view of files longer than 16,000 characters

> Track memory file sizes and cap how large a file can grow.

2 機構の役割分担も明記される。

> compaction keeps the active context small without client-side bookkeeping, and memory preserves the information that must survive summarization.

### 1.5 サブエージェントの実測と、図に残った唯一の絶対数（DIRECT: https://www.anthropic.com/engineering/multi-agent-research-system 、2025-06-13）

> a multi-agent system with Claude Opus 4 as the lead agent and Claude Sonnet 4 subagents outperformed single-agent Claude Opus 4 by 90.2% on our internal research eval.

> token usage by itself explains 80% of the variance

コスト:

> agents typically use about 4× more tokens than chat interactions, and multi-agent systems use about 15× more tokens than chats.

コーディングへの適用限界をベンダー自身が書いている。

> most coding tasks involve fewer truly parallelizable tasks than research, and LLM agents are not yet great at coordinating and delegating to other agents in real time.

絶対数が出るのはアーキテクチャ図の注記だけである。

> since if the context window exceeds 200,000 tokens it will be truncated and it is important to retain the plan.

長丁場の運用則:

> agents summarize completed work phases and store essential information in external memory before proceeding to new tasks. When context limits approach, agents can spawn fresh subagents with clean contexts while maintaining continuity through careful handoffs.

サブエージェントの出力はファイル側に置き、参照だけを戻す。

> Subagents call tools to store their work in external systems, then pass lightweight references back to the coordinator.

規模の指針は数値で書かれている（ただしエージェント数であってトークン数ではない）: "Simple fact-finding requires just 1 agent with 3-10 tool calls, direct comparisons might need 2-4 subagents with 10-15 calls each, and complex research might use more than 10 subagents"。失敗例として "spawning 50 subagents for simple queries" も挙げる。

---

## 2. OpenAI: 機構は文書化し、コーディングモデルの例では 200,000 で切る

### 2.1 compaction ガイドが唯一の一次記述（DIRECT: https://developers.openai.com/api/docs/guides/compaction ）

サーバ側圧縮はリクエストパラメータで有効化する。

> You can enable server-side compaction in a Responses create request (`POST /responses` or `client.responses.create`) by setting `context_management` with `compact_threshold`.

> When the rendered token count crosses the configured threshold, the server runs server-side compaction.

そして**この文書の全 SDK 例（JavaScript / Python / Go / Java / Ruby）が `compact_threshold: 200_000` を使い、モデルは `gpt-5.3-codex`（コーディングモデル）である。**

```javascript
context_management: [{ type: "compaction", compact_threshold: 200_000 }],
```

```python
context_management=[{"type": "compaction", "compact_threshold": 200000}],
```

**サーバ側既定値は記載されていない**（利用者が設定する値のみ）。圧縮の成果物の性質も明記される。

> The returned compaction item carries forward key prior state and reasoning into the next run using fewer tokens. It is opaque and not intended to be human-interpretable.

保持項目が残ることも書かれている。これは後述の野生 issue と一致する。

> the compacted window generally contains more than just the compaction item. It can also include retained items from the previous window.

レイテンシの助言:

> After appending output items to the previous input items, you can drop items that came before the most recent compaction item to keep requests smaller and reduce long-tail latency.

### 2.2 Codex 側は機構の存在しか書かない（DIRECT: https://learn.chatgpt.com/docs/codex-manual.md ）

> `/compact` when the chat is getting long and you want a summarized version of earlier context. Codex also compacts chats automatically

用語集の定義は 1 行である（DIRECT: https://learn.chatgpt.com/docs/glossary.md ）。

> **Compaction** — Summarizing older context so long-running work can continue.

`/compact` が何を保持するか、自動圧縮がいつ発火するか、しきい値が何トークンかは、Codex Manual（10,939 行）のどこにも書かれていない。加えて、用語集の `Compaction` のリンク先 `/codex/prompting#context` を実際に開くと（DIRECT: https://learn.chatgpt.com/docs/prompting.md ）、そこは「添付・画像・Web 検索・プロジェクト」の節で、**圧縮の記述は無い**。

文脈汚染と context rot の定義は Codex のサブエージェント節にある（同 Manual）。

> Even with large context windows, models have limits. If you flood the main chat (where you're defining requirements, constraints, and decisions) with noisy intermediate output such as exploration notes, test logs, stack traces, and command output, the session can become less reliable over time.

> - **Context pollution**: useful information gets buried under noisy intermediate output.
> - **Context rot**: performance degrades as the chat fills up with less relevant details.

対処は隔離と要約:

> - Keep the **main agent** focused on requirements, decisions, and final outputs.
> - Run specialized **subagents** in parallel for exploration, tests, or log analysis.
> - Return **summaries** from subagents instead of raw intermediate output.

### 2.3 API 側の「文脈窓の管理」（DIRECT: https://developers.openai.com/api/docs/guides/conversation-state ）

> If you create a large prompt—often by including extra context, data, or examples for the model—you run the risk of exceeding the allocated context window for a model, which might result in truncated outputs.

> Tokens generated in excess of the context window limit may be truncated in API responses.

圧縮の詳細はガイドへ移され、`compact_threshold` と `/responses/compact` の 2 経路が案内される。ここにも推奨値は無い。

---

## 3. Google: Gemini CLI は絶対値の既定を持ち、Antigravity は何も出さない

### 3.1 Gemini CLI の `/compress` は「文脈全体を要約に置換」（DIRECT: https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/reference/commands.md ）

> `/compress` — Replace the entire chat context with a summary. This saves on tokens used for future tasks while retaining a high level summary of what has happened.

`/clear` は別物として定義される。

> Clear the agent conversation context (active conversation history) and start a new session

### 3.2 実験的文脈管理の算術（DIRECT: https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/reference/configuration.md ）

前続記録が `historyWindow.maxTokens` 150,000 / `retainedTokens` 40,000 を既に取っているので、ここでは残りを足す。`experimental.contextManagement` の既定は `false`（"Enable logic for context management."）。

- `contextManagement.historyWindow.maxTokens` = **150000**（"The number of tokens to allow before triggering compression."）
- `contextManagement.historyWindow.retainedTokens` = **40000**（"The number of tokens to always retain."）
- `contextManagement.messageLimits.normalMaxTokens` = **2500**（"The target number of tokens to budget for a normal conversation turn."）
- `contextManagement.messageLimits.retainedMaxTokens` = **12000**（"The maximum number of tokens a single conversation turn can consume before truncation."）
- `contextManagement.messageLimits.normalizationHeadRatio` = **0.25**
- `contextManagement.tools.distillation.maxOutputTokens` = **10000**（"Maximum tokens to show to the model when truncating large tool outputs."）
- `contextManagement.tools.distillation.summarizationThresholdTokens` = **20000**（"Threshold above which truncated tool outputs will be summarized by an LLM."）
- `contextManagement.tools.outputMasking.protectionThresholdTokens` = **50000**（"Minimum number of tokens to protect from masking (most recent tool outputs)."）
- `contextManagement.tools.outputMasking.minPrunableThresholdTokens` = **30000**（"Minimum prunable tokens required to trigger a masking pass."）
- `contextManagement.tools.outputMasking.protectLatestTurn` = **true**
- 圧縮専用のモデル定義として `chat-compression-default` と `agent-history-provider-summarizer`（`gemini-3-flash-preview`）がある

つまり Gemini の実装は「1 ターン 2,500 目標・12,000 上限、ツール出力は 10,000 まで表示・20,000 超は要約、直近 50,000 は保護、15 万で圧縮して 4 万残す」という**絶対値の束**である。窓の 50% という既定（`model.compressionThreshold` = 0.5）は前続記録が一次取得済み。ここに散文の指針は無く、数値は設定リファレンスにしか現れない。

### 3.3 Antigravity は圧縮を公開していない（DIRECT: https://antigravity.google/llms.txt 、`/docs/slash-commands.md`、`/docs/cli/conversations.md`、`/docs/cli/best-practices.md`）

公開スラッシュコマンドの全一覧は `/boost`、`/teamwork-preview`、`/goal`、`/plan`、`/grill-me`、`/learn`、`/schedule`、`/browser`、`/btw` で、**`/compact` も `/summarize` も無い**。docs 索引（llms.txt）にも文脈管理・圧縮のページが無い。

代わりに置いているのは履歴のスコープと巻き戻しである。

> To maintain context hygiene, Antigravity CLI scopes conversation histories directly to your current working directory. […] This prevents context pollution, ensuring that the agent's semantic memory and token limits remain focused solely on the relevant codebase.

> The `/fork` command clones your entire conversation history up to the current turn into a new, independent session.

best-practices ページは「検証ループ」「探索→計画→実行」「`esc` で早期に軌道修正」「`/rewind`（別名 `/undo`）で巻き戻し」「`/fork` で分岐」を挙げ、「Enrich your prompting context… minimize token overhead」と書くが、文脈長・圧縮・トークン数の指針は無い。

---

## 4. Cursor: 圧縮は手動コマンド 1 つだけで、数値も指針も無い

DIRECT: https://cursor.com/docs/cli/reference/slash-commands.md

> `/summarize` — Summarize the conversation to reduce context. `/compress` is an alias.

DIRECT: https://cursor.com/docs/agent/overview.md には tools / checkpoints / queued messages / side chats / conversation search / `/goal` の記述はあるが、圧縮・要約・文脈長の記述は無い。「There is no limit on the number of tool calls Agent can make during a task.」とは書くが、文脈の扱いには触れない。文書索引（`/llms.txt`）に圧縮のページが無いことは前続記録が確認済み。**Cursor が自動要約をどの窓占有率で発火するかは、ベンダーの一次文書からは分からない。**

---

## 5. Amp（Sourcegraph）: 「200k で十分」と書く唯一のベンダー

Amp は 1M 窓を提供しながら、人間向けの言葉で作業予算を名指しした唯一のベンダーである。

### 5.1 ガイド「Context Management in Amp」（DIRECT: https://ampcode.com/guides/context-management 、meta-article:modified_time 2026-07-27。本文は「Archived guide from November 2025」）

原理を 3 つに要約する。

> **It can only get so big**. Different language models have different limits for how much context they can run inference on, but all have one.

> **Everything's multiplied with everything else**. […] *everything in the context window has an influence on the output*.

> **Quality degrades: the more context, the worse the results.** Most models provide better results with *less* context.

機構の算術も書く。`@` メンションで取り込むファイルは「テキストファイルは切り詰められ、**最大 500 行・1 行あたり 2KB**」。編集（`e`）はそのメッセージより後を捨て、復元（`r`）は過去へ戻す。ハンドオフは「ある文脈窓の中身を、新しい空の文脈窓への 1 メッセージに蒸留する」。スレッド参照は別モデルに抽出させ、全文を入れない。

> When you reference a thread in a message, the agent in Amp can use the `read_thread` tool to extract relevant information from the referenced threads. It does this by tasking a second model to extract the information that's relevant to your prompt, which allows you to get to information from another thread, without having to include all of it.

### 5.2 「200k Tokens Is Plenty」（DIRECT: https://ampcode.com/notes/200k-tokens-is-plenty 、Lewis Metcalf、2025-12-09）

> Opus 4.5 came out a few weeks ago and quickly became not only Amp's main model, but also universally respected as the best model for coding — while having a context window of roughly 200k tokens. In the winter of 2025, that's not a lot. A lot of people view this as a downside. But here's the thing — 200k is enough for me, it's plenty. I love short threads. I do all my work with short threads.

実測として、出荷した機能 1 つのスレッド群を挙げる。

> Look at all those tiny threads! Look at the token counts, and the number of user messages sent. The biggest thread is 151k output tokens and four user messages. The average thread is around 80k tokens. Now think of the time when we had a 1 million token context window. I wouldn't run a thread that long…

コストの理由:

> **Long threads are not just worse, they also cost more.** […] Not only does every token get sent to the provider with every request, exponentially increasing the cost of new messages, but some providers like Anthropic also charge more for long-context requests for some models. Long threads are also more likely to have longer idle periods between user messages, and so are more likely to miss the cache window — a major contributor to expensive runaway threads.

### 5.3 1M 窓を出した当のベンダーが「全部は使うな、20% で警告」と書く（DIRECT: https://ampcode.com/news/1m-tokens 、2025-08-27）

> Amp can now use 1 million tokens of context with Claude Sonnet 4, up from 432,000 tokens two weeks ago.

> **You should not use the full context window for most tasks in Amp.** Instead, use small threads that are scoped to a single task. Amp is better, faster, and cheaper when used this way. **A notice will appear when you hit 20% of the context window to remind you of this.**

> requests with more than 200k tokens are roughly twice as expensive per token in Anthropic's API pricing.

> *Note: the screenshot shows 968k tokens because the context window is composed of 968k input tokens and 32k output tokens.*

つまり Amp にとって 1M 窓の「推奨作業量」は 20%（=200K）で、その先は警告領域である。432k の告知（DIRECT: https://ampcode.com/news/432k-tokens 、2025-08-13）にも同じ留保がある。

> It remains to be seen what those 400k tokens are made of. Quantity isn't quality, and we're not sure yet whether the model behaves the same at 360k tokens as it does at 60k.

### 5.4 圧縮の実運用と、廃止された機構（DIRECT: https://ampcode.com/news/neo 、2026-05-06）

> Compaction now runs automatically when the context window is 90% full.

> When the context window fills up, Amp now compacts the thread: it summarizes the current context, starts a fresh window with that summary, and keeps going.

> You don't have to watch context percentages anymore, or decide when to handoff, or extract information from a thread in a panic.

> **Handoff** is gone. As described above, compaction made it obsolete.

圧縮モデルは本体と分けている（DIRECT: https://ampcode.com/news/better-faster-cheaper-summaries 、2025-06-27）。

> Amp now uses a different model when compacting or summarizing threads. It's 4-6x faster, roughly 30x cheaper, and provides better summaries when you either compact a thread or create a new thread with a summary.

### 5.5 圧縮の副作用をベンダー自身が測っている（DIRECT: https://ampcode.com/news/read-bigger-threads 、2026-07-02）

> Our longest thread has been compacted over 68 times — without compaction, it would be over 21 million tokens long.

> even threads with 1 million tokens that fit gave bad answers: one giant prompt over-weights whatever the thread ended with or started with and ignores the information in the middle.

この 2 文目は、Lost in the Middle の U 字が 2026 年のコーディングエージェントでも観測されるというベンダー自身の証言である。Amp の対処は「圧縮を信じるな、原典を見ろ」という指示である。

> Use compactions for orientation, but inspect original messages when exact requirements, wording, code, commands, chronology, edits, or verification matter.

> It also works on the thread you're in. When the agent needs something from three weeks ago — a decision, an error, the original plan — it goes back and looks instead of trusting the compaction.

---

## 6. Cognition（独立ラボ）: 文脈は共有せよ、圧縮は難しい、並列サブエージェントは壊れやすい

DIRECT: https://cognition.ai/blog/dont-build-multi-agents （`meta-author: Walden Yan`、公開 2025-06-12。タスク指示は Scott Wu と書いていたが、ページの著者メタデータは Walden Yan なのでそちらを採る）

> Share context, and share full agent traces, not just individual messages

> Actions carry implicit decisions, and conflicting decisions carry bad results

> I would argue that Principles 1 & 2 are so critical, and so rarely worth violating, that you should by default rule out any agent architectures that don't abide by them.

圧縮の難しさについて、専用モデルを作った経験まで書く。

> we introduce a new LLM model whose key purpose is to compress a history of actions & conversation into key details, events, and decisions. This is *hard to get right.*

> Depending on the domain, you might even consider fine-tuning a smaller model (this is in fact something we've done at Cognition).

Claude Code のサブエージェントへの評価は条件付きである。

> if they were to run multiple parallel subagents, they might give conflicting responses

> all the subagent's investigative work does not need to remain in the history of the main agent, allowing for longer traces before running out of context.

> running multiple agents in collaboration only results in fragile systems.

商業利害: Devin を売り、記事末尾は Devin の登録導線である。数値は一つも出てこない。

---

## 7. 計測エビデンス: 前続記録が扱っていない 2 件と、コーディングタスクの 1 件

### 7.1 Liu et al.「Lost in the Middle」（DIRECT: https://arxiv.org/html/2307.03172v3 、arXiv 2307.03172v3、2023-11-20）

タスクは多文書 QA と合成 key-value 検索で、**コーディングではない**。

> performance is often highest when relevant information occurs at the beginning or end of the input context, and significantly degrades when models must access relevant information in the middle of long contexts, even for explicitly long-context models.

数値:

- GPT-3.5-Turbo の多文書 QA は「**20% 超**」落ちうる。最悪ケースは文書ゼロの closed-book（56.1%）より低い
- 「using 50 documents instead of 20 retrieved documents only marginally improves performance（**約 1.5%** for GPT-3.5-Turbo and **約 1%** for claude-1.3）」
- Flan-UL2 は訓練長 2,048 以内なら best/worst 差 **1.9%**
- key-value 検索は query-aware 文脈化なしの最悪値 **45.6%**
- 評価モデルは MPT-30B-Instruct、LongChat-13B(16K)、GPT-3.5-Turbo(16K)、Claude-1.3(100K)。**2023 年のモデルであり、2026 年のフロンティアモデルにそのまま移せない**

### 7.2 Databricks RAG 計測（DIRECT: https://www.databricks.com/blog/long-context-rag-performance-llms 、2024-08-12、2026-05-13 更新）

> We ran over 2,000 experiments on 13 popular open source and commercial LLMs

> Llama-3.1-405b performance starts to decrease after 32k tokens, GPT-4-0125-preview starts to decrease after 64k tokens, and only a few models can maintain consistent long context RAG performance on all datasets.

> for most models, there is a saturation point after which performance decreases, for example: 16k for gpt-4-turbo and claude-3-sonnet, 4k for mixtral-instruct and 8k for dbrx-instruct.

> recent models, such as gpt-4o, claude-3.5-sonnet and gpt-4o-mini, have improved long context behavior that shows little to no performance deterioration as context length increases.

失敗モードは数値で書かれている。

> Claude-3-sonnet's copyright failure increases from 3.7% at 16k to 21% at 32k to 49.5% at 64k context length; DBRX failure to follow instruction increases from 5.2% at 8k context length to 17.6% at 16k to 50.4% at 32k.

想起の飽和点: NQ は **8k**、DocsQA と HotPotQA は **96k**、FinanceBench は **128k**。実験条件はチャンク 512 トークン / ストライド 256、出力 1k と 512 のバッファを引いて 125k まで使う。著者自身の留保:

> the failure patterns on this dataset may not be representative of other datasets

商業利害: Databricks は RAG 商材（Agent Bricks / Mosaic）を売るので、「長文脈は RAG を置換しない」方向に読める結論には誘因がある。タスクは RAG QA でコーディングではない。**行動指針としてのトークン数は書かれていない**（"a developer must be mindful in the selection of the number of documents" のみ）。

### 7.3 The Complexity Trap: コーディングタスクで機構を比較した唯一の測定（DIRECT: https://arxiv.org/abs/2508.21433 、arXiv 2508.21433v1 [cs.SE]、2025-08-29）

SWE-agent × SWE-bench Verified 500 件。**観測がトークンの 84% を占める**ため、狙いを絞る先が明確になる。

> observation tokens make up around 84% of an average SWE-agent turn

結果:

- Qwen3-Coder 480B: Observation Masking **$0.61/instance**、Raw Agent $1.29、LLM-Summary $0.64 → masking は raw 比 **52.7% 削減**、summary 比で **$15 / 500 件**の差
- 同モデルの solve rate: masking **54.8%** vs LLM-Summary **53.8%**（raw 53.8%）
- Qwen3-32B: Raw 17.0% / $1.12 → masking 15.0%（−11.8%）/ $0.55
- OpenHands 予備実験（Gemini 2.5 Flash、50 件）: Raw 40.0% / $2.39 → masking 30.0%（−25%）/ $1.14（−52.3%）。つまり**別スキャフォールドでは性能が落ちる**ので、結論は普遍的ではない

> Without any context management strategy targeting cost-efficiency, we find that agent costs can more than double

> In three of our five setups, the most efficient strategy also achieved a higher solve rate than the Raw Agent baseline. This demonstrates that beyond a certain point, more context becomes a liability rather than an asset

機構の副作用として「trajectory elongation」を発見する。

> LLM-Summary consistently leads to longer trajectories, suggesting they mask failure signals that would otherwise prompt earlier termination.

> The implication is clear: the most recent context is often sufficient for code-generating agents.

パラメータ: マスキングの窓は **M=10** が最適（"We find that M=10 yields optimal performance"）、要約は N=21 / M=10、ターン上限 250、ハイブリッドでさらに **7% / 11%** 削減。査読状況と帰属: JetBrains Research ＋ TUM の著者、arXiv v1（査読通過は未確認）、コードは anonymous.4open.science。IDE ベンダーの研究で、推論トークンの販売とは利害が一致しない。

---

## 8. 野生での観測: 圧縮は実際に何を残すか

**Codex #45296**（DIRECT: https://github.com/openai/codex/issues/45296 、OPEN、2026-09-13 起票）— 圧縮がほぼ効かない実測値:

> In very long-running Codex Goals, context compaction does not significantly reduce the active working set. Using the default Codex configuration, I observed a compaction event that retained 192 historical user messages alongside the generated compaction checkpoint. The checkpoint itself was only ~41.9K serialized characters, while the retained user messages occupied ~1.95M characters. Immediately after compaction, the next model request still contained 187,306 input tokens.

これは OpenAI のガイドの "the compacted window generally contains more than just the compaction item. It can also include retained items from the previous window." の実害形である。**圧縮後も 187K が残る**という数字は、200K 予算を「圧縮すれば空く」と読む設計への警告になる。

**Codex #43855**（OPEN、2026-09-08）"Codex stops after compaction"、**#42393**（OPEN、2026-09-03）"Remote compaction v2 fails"、**#21777**（OPEN、2026-05-08）"auto compaction - expose compaction to agent"。

**claude-code #89831**（DIRECT: https://github.com/anthropics/claude-code/issues/89831 、OPEN）— 圧縮の不可視性:

> Auto-compaction is silent until after the fact: the "[Context compacted. Continuing from summary...]" notice arrives only once the loss has already happened, and there is no visible record of *what*

（同リポジトリに #91952「context management/compaction improvement」、#95709「Compaction summary renders above the last message pre-compaction」も OPEN。）

**gemini-cli #22877**（DIRECT: https://github.com/google-gemini/gemini-cli/issues/22877 、CLOSED、15 コメント）— 外部提案が保守の書き換えに吸収された例。「flat summarization」の痛点を提案者が数値付きで書く。

> 1. **Blocking UX**: Compression triggers a 20-30s spinner while the LLM summarizes + verifies
> 2. **Lost details**: A single summary snapshot drops specific technical values under compression pressure
> 3. **Cliff edge**: Everything older than 70% gets compressed at once, all-or-nothing

保守側（`joshualitt`）は自作の別実装を出しながらこう書く。

> I'm building an alternative context management pipeline([pr](https://github.com/google-gemini/gemini-cli/pull/24157)), that tries to strike a better balance between efficiency, user control, and thread performance, and the intent is to move off of the old compression implementation.

> we're currently in the middle of a large rewrite of the context management logic([PR](https://github.com/google-gemini/gemini-cli/pull/24752))

つまり Google 側の文脈管理は 2026-09 時点で書き換え中であり、§3.2 で読んだ既定値は動く前提で扱うべきである。

**リポジトリの状態**: Gemini CLI は `archived:false`、`pushed_at:2026-09-26`、`stargazers_count:107164`（前続記録が取得済み）。Amp は**読み取り可能な本体リポジトリを持たない**（`https://api.github.com/repos/sourcegraph/amp` は 404）。Amp を名乗る公開リポジトリは第三者製のみ（例: `tao12345666333/amp-acp` 95 stars、`pasky/pi-amplike` 224 stars、いずれも本記録で DIRECT 取得）。

---

## 9. 絶対トークン予算を公表している主体はあるか

**「窓の何割か」ではなく「何トークンで切るか／何トークンを予算とするか」を公表している主体は 3 つある。作業予算として人間向けの言葉で書いたのは 1 つだけである。**

| 主体 | 絶対値 | それが何の数か | 一次情報 |
| --- | --- | --- | --- |
| Amp | **200,000** | 推奨作業量。1M 窓でも 20% で警告、90% で自動圧縮 | ampcode.com/news/1m-tokens、/notes/200k-tokens-is-plenty、/news/neo |
| OpenAI | **200,000** | compaction ガイドの全 SDK 例の `compact_threshold`（`gpt-5.3-codex`）。既定値ではない | developers.openai.com/api/docs/guides/compaction |
| Google（Gemini CLI） | **150,000 / 40,000** | 実験的な履歴管理の既定（発火点と保持量） | gemini-cli docs/reference/configuration.md |
| Anthropic | **100,000** / **200,000** | 前者はツール結果自動削除の `trigger` 既定、後者は multi-agent 図の打ち切り参照。**どちらも作業予算の推奨ではない** | platform.claude.com context-editing、anthropic.com multi-agent-research-system |

**「作業予算を X トークンにせよ」という文が、Amp 以外のどこにも無い。** Anthropic の指針は "smallest possible set of high-signal tokens"（比率すら無い）、OpenAI は機構だけ、Google は設定既定だけ、Cursor と Antigravity は何も出さない、Cognition は数値を出さない。前続記録の「数値で作業予算を推奨する一次情報は無い」は、**Amp の 1 件だけが例外**である（前続記録は Amp を扱っていない）。

---

## 10. 2026-09-24 の記録と決定との関係

- **決定記録 `2026-09-24-context-window-budget-200k-extended-1m.md` の rule（`contextWindow` = 200,000、`maxContextWindow` = 1,000,000）は、本記録の機構レベルの証拠と矛盾しない。** むしろ補強される: OpenAI の compaction ガイドがコーディングモデルに対して 200,000 を例示し、Amp が 1M 窓の推奨作業量を 20%（=200,000）と書き、Gemini CLI の絶対既定が 150,000 / 40,000 である。
- **ただし前続記録の verdict の「保守的」という枠取りとは強調点がずれる。** 「保守的」は「窓の 50〜98% というベンダー既定より下に置いている」という比較だが、**200K は機構レベルの指針が名指しする唯一の作業予算であり、Amp の警告点そのもの**である。つまり 200K は「控えめ」というより「指針の上限側」にあたる。証拠は同じで、読み方が一段強くなる。これは前続記録の測定や既定の列挙を否定するものではなく、同じ数値を指針文書側から見たときの位置づけの違いである。
- **170,000 という圧縮点**には外部に対応する絶対値が無い（Google の 150,000、Anthropic の削除トリガ 100,000 の上、OpenAI の例示 200,000 の下）。前続記録が確認した omp の予備 15% の設計と合わせて、**家の外に同値を名指しした例は無い**。
- **Cognition の「文脈を共有せよ・並列サブエージェントは壊れやすい」は、単一スレッド＋圧縮という決定記録の形と整合する**（サブエージェント隔離へ舵を切る根拠にはならない）。一方 Codex Manual は逆に、サブエージェントで本流を汚さない運用を勧める。両方とも一次情報であり、**どちらが優位かを示す測定は見つかっていない**。
- 決定記録の「1M をそのまま予算にする」に対する反証は、本記録でも独立に増えた: Amp が 1M 窓を出した当の告知で「You should not use the full context window for most tasks in Amp」と書き、20% で警告を出す。

---

## 11. 明示的な否定（探して見つからなかったもの）

- **「作業予算は X トークン」と数値で書いた文書は、Amp のノート 1 件を除いて存在しない。** 確認した範囲: Anthropic 2 記事＋API 2 ページ、OpenAI compaction ガイド＋Codex Manual（10,939 行）＋用語集＋conversation-state、Gemini CLI commands/configuration、Antigravity llms.txt＋slash-commands＋conversations＋best-practices、Cursor agent/overview＋slash-commands、Amp guides/context-management ほか 6 記事、Cognition 1 記事、The Complexity Trap、Databricks、Lost in the Middle。
- **OpenAI は Codex の自動圧縮のしきい値も、`/compact` が保持する内容も公表していない。** Manual の該当は 1 行（"Codex also compacts chats automatically"）。用語集の `Compaction` のリンク先 `/codex/prompting#context` の節には圧縮の記述が無い。
- **OpenAI の `compact_threshold` にサーバ側既定値の記載は無い**（ガイドは利用者が設定する例のみ）。
- **Cursor の文書に文脈管理のページが無い**（docs 索引に圧縮・要約・文脈長のページなし。あるのは `/summarize` の 1 行）。自動要約の発火条件は非公開。
- **Antigravity は圧縮コマンドを公開していない**（公開スラッシュコマンド 9 個に `/compact` も `/summarize` も無い）。文脈に関する記述はワークスペース単位の履歴スコープと `/fork`、`/rewind` のみ。
- **Anthropic の文脈工学記事に絶対トークン数が 1 つも無い**（絶対値は別ページの API 既定 100,000 と、別記事の図注 200,000 のみ）。
- **コーディングタスクでの長文脈劣化曲線を測った研究は本スライスでは見つからず**、Databricks と Lost in the Middle はいずれも QA / 検索。機構比較でコーディングを測ったのは The Complexity Trap だけである。
- **Amp に機械可読の文書索引が無い**（`https://ampcode.com/docs/llms.txt` は HTTP 404）。**UNREACHABLE**。
- `web_search` は全プロバイダで失敗。**UNREACHABLE**。
- `gh search issues --repo sst/opencode` は 404（リポジトリが検索索引に無い）。

---

## 12. 未検証・前例なし（no precedent found）

- **前例なし**: 200K 予算（ないし 170K の圧縮点）を名指しした規範文書。最も近いのは Amp の「200k tokens is plenty」と OpenAI の `compact_threshold: 200_000` で、いずれも「その値で切る」という例示であって「その値を上限に運用せよ」という規範ではない。
- **前例なし**: 圧縮の前に何を残すかを契約として公表したハーネス。OpenAI は「retained items が入りうる」としか書かず、実際に何が残るかは野生の issue（#45296 の 187K）でしか分からない。
- **前例なし**: 圧縮 1 回あたりのキャッシュ再構築コストの数値（Anthropic は「キャッシュ接頭辞が無効化される」とだけ書き、Amp は「キャッシュ窓を外すと高い」と書くが、金額は無い）。前続記録も同じ [U] に到達した。
- 未検証: OpenAI の `compact_threshold` のサーバ側既定値、Codex の自動圧縮のしきい値と保持内容。
- 未検証: Gemini CLI の実験フラグ `contextManagement`（既定 false）の既定値は、保守側が PR #24157 / #24752 で書き換え中のため動く。
- 未検証: Cursor の自動要約トリガ。Antigravity の文脈管理ページの有無（llms.txt が唯一の索引なので、索引に無いページの不在は証明できない）。
- 未検証: Databricks と Lost in the Middle はコーディングタスクではない。The Complexity Trap は arXiv v1 のプレプリント（査読通過を確認できず）。Amp のブログはベンダー自身の主張で、外部監査は無い。
- 未検証: Amp の「200k tokens is plenty」は Amp 社員個人のノートで、チーム全員の運用を裏付ける一次データは無い。
- 未検証: `sst/opencode` の issue は本トークンの検索索引から引けない（404）。

---

## 出典（すべて 2026-09-27 に DIRECT 取得）

1. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
2. https://claude.com/blog/context-management
3. https://platform.claude.com/docs/en/build-with-claude/context-editing.md
4. https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool.md
5. https://www.anthropic.com/engineering/multi-agent-research-system
6. https://developers.openai.com/api/docs/guides/compaction （`.md` 版を取得）
7. https://developers.openai.com/api/docs/guides/conversation-state （`.md` 版を取得）
8. https://learn.chatgpt.com/docs/codex-manual.md
9. https://learn.chatgpt.com/docs/glossary.md
10. https://learn.chatgpt.com/docs/prompting.md
11. https://learn.chatgpt.com/docs/long-running-work.md
12. https://github.com/openai/codex/issues/45296 （本文の引用は冒頭約 1,200 文字までを取得。以降は未読）
13. https://github.com/openai/codex/issues/43855 ／ https://github.com/openai/codex/issues/42393 ／ https://github.com/openai/codex/issues/21777
14. https://github.com/anthropics/claude-code/issues/89831 （本文は冒頭約 900 文字までを取得）／ #91952 ／ #95709
15. https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/reference/commands.md
16. https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/reference/configuration.md
17. https://github.com/google-gemini/gemini-cli/issues/22877 （PR #24157 / #24752 は本文中のリンク。本記録では未取得）
18. https://antigravity.google/llms.txt ／ https://antigravity.google/docs/slash-commands.md ／ https://antigravity.google/docs/cli/conversations.md ／ https://antigravity.google/docs/cli/best-practices.md
19. https://cursor.com/docs/cli/reference/slash-commands.md ／ https://cursor.com/docs/agent/overview.md
20. https://ampcode.com/guides/context-management
21. https://ampcode.com/notes/200k-tokens-is-plenty
22. https://ampcode.com/news/1m-tokens
23. https://ampcode.com/news/432k-tokens
24. https://ampcode.com/news/neo
25. https://ampcode.com/news/better-faster-cheaper-summaries
26. https://ampcode.com/news/read-bigger-threads
27. https://ampcode.com/sitemap.xml （Amp のページ発見用）
28. https://cognition.ai/blog/dont-build-multi-agents
29. https://arxiv.org/abs/2508.21433 （The Complexity Trap。表は https://arxiv.org/html/2508.21433v1 ）
30. https://www.databricks.com/blog/long-context-rag-performance-llms
31. https://arxiv.org/html/2307.03172v3 （Lost in the Middle）
32. `gh api repos/sourcegraph/amp`（404）／`gh search repos ampcode`
