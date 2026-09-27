---
question: "各コーディングエージェントの既定の圧縮トリガーは何か、長文脈はいつ劣化するか、1M 窓に対する 200K 予算は標準か保守的か後れか"
date: 2026-09-27
verdict: "保守的。見つかった全ベンダーの既定トリガーは窓の 50〜98% にあり、200K を強制するベンダーは無い。ベンダーが窓を 200K に落とす唯一の場面は「1M を検証できない」ゲートウェイのフォールバックである。数値で作業予算を推奨する一次情報は無く、どの測定も 200K を最適点として支持しないが、200K では足りないとも言っていない。"
unverified:
  - "Codex のモデル別 auto_compact_token_limit の実値（スキーマは「unset uses model defaults」としか書かない）"
  - "Cursor の自動圧縮の既定しきい値（自動圧縮の文書ページ自体が存在せず、/summarize は手動のみ）"
  - "Devin の圧縮しきい値（ドキュメント索引を全文検索して数値なし）"
  - "Cline #14329 / pi #9482 / opencode #16308 は closed/completed だが修正コミットの中身は本文未確認"
  - "Chroma context rot のモデル別数値（本文に数値が無く、グラフは画像のみ）"
  - "omp で compaction.thresholdTokens=200000 を固定したときの実測（本記録はコード読解のみ）"
  - "Claude Code の圧縮内部の実処理（docs の記述以外のソースは非公開）"
  - "Codex が 95% 上限に達した後、1M 級モデルで何が起こるかの実測"
  - "microcompact という仕組みの存在（Claude Code の文書全体を検索して一致 0 件）"
  - "Breunig の記事の原文（TLS エラー、アーカイブも 404）"
sources_note: "URL と原文引用は本文中。参照はパスで行い番号 ID は使わない。"
---

# 既定の圧縮トリガーは窓の 50〜98% に散り、1M 窓の 200K 予算はその下に座る

## 方法と検証凡例

2026-09-27 時点の調査。`web_search` は全プロバイダーが落ちており、`read` による URL 直接取得、`gh api`、`curl` だけで調べた。

凡例は 3 つ。**[D]** 一次文書（公式ドキュメント、ソース、changelog、issue 本文、論文）を直接取得し、引用は原文のまま英語で写したもの。**[S]** 検索結果・要約・第三者ブログ経由で原文を取れていないもの。**[U]** 取得できず確認できなかったもの。

この記録は決定記録 `rules/decisions/2026-09-24-context-window-budget-200k-extended-1m.md` の決定内容を証拠として扱わない。決定記録が引いた一次情報のうち、Anthropic の 967K とゲートウェイ後退、Codex #19185 の 258k、Cline #14329、pi #9482 は本記録で取得し直した。前続記録 `rules/research/2026-09-24-context-window-budget-for-1m-models.md` が `[要約経由]` としていた劣化計測・ベンダー既定を一次情報に格上げし、2026 年の測定を足した。

数値はすべてトークン、ドル、%、日付で書く。数値が無い情報源には「数値なし」と明記した。

## 1. ベンダーが組み込んでいる既定のトリガー

### Claude Code: 1M 窓でも約 967K まで使い、ゲートウェイ越しだけ 200K に後退する

窓を明示しなければ、会話がモデルの文脈限界に達したところで圧縮する。[D] https://code.claude.com/docs/en/model-config.md

> If you don't set an auto-compact window, Claude Code compacts when the conversation reaches the model's context limit, except in these sessions

ネイティブ 1M 窓のモデルは例外で、満杯の手前で切る。同じページ、行 749。

> Models running with a native 1M window, such as Sonnet 5, the Fable models, and Opus 4.7 and later on the Anthropic API, compact before the window fills, at about 967K tokens by default.

Sonnet 5 の節はもっと踏み込んでいる。同ページ、行 713-715。

> On the Anthropic API, Sonnet 5 always runs with the 1M context window. There is no 200K variant, no `[1m]` suffix to select, and no usage credits required on any plan. Sessions auto-compact before the window fills, at about 967K tokens by default; set `CLAUDE_CODE_AUTO_COMPACT_WINDOW` to choose a different threshold.

つまり Anthropic 自身の既定は窓の 96.7% で、作業予算として 200K を置く設計ではない。200K が現れるのは「1M を検証できない」2 つの構成だけである。同ページ、行 717-720。

> Two configurations budget the window at 200K instead:
>
> * **LLM gateway**: when `ANTHROPIC_BASE_URL` points at a [gateway](/docs/en/llm-gateway), Claude Code can't verify 1M support. To use the full window, select Sonnet 5 (1M context) in the model picker, which maps to `sonnet[1m]`.
> * **`CLAUDE_CODE_DISABLE_1M_CONTEXT=1`**: holds sessions on every model with a native 1M window to a 200K window; see [Extended context](#extended-context) for how the hold is enforced. Useful for deployments that need to cap context.

未認識のモデル ID（ゲートウェイのエイリアスなど）は、Claude Code がその ID に対して仮定した窓で圧縮する。同ページ、行 750。

> Sessions on a model ID Claude Code doesn't recognize, such as an LLM gateway alias, compact at the context window Claude Code assumes for the ID

設定と環境変数は次のとおり。[D] https://code.claude.com/docs/en/settings-reference.md（`autoCompactEnabled` の既定 `true`、`autoCompactWindow` の既定 unset）と [D] https://code.claude.com/docs/en/env-vars.md

| つまみ | 意味 | 既定 |
| --- | --- | --- |
| `autoCompactEnabled` | 自動圧縮の on/off | `true` |
| `autoCompactWindow` | 圧縮窓（トークン） | unset |
| `--autocompact` / `/autocompact` | セッション単位の窓 | — |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | 100000〜1000000 | unset |
| `DISABLE_AUTO_COMPACT=1` | 自動のみ停止（手動 `/compact` は残る） | — |
| `DISABLE_COMPACT=1` | 自動も手動も停止 | — |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | 仮定する窓の上書き | unset |
| `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1` | 未認識 ID で事前圧縮せず、API の拒否後に初めて圧縮 | unset |

環境変数の注意書きは事故りやすい。同ページ、行 214。

> Set the auto-compact window in tokens, from `100000` to `1000000`. Accepts a plain integer such as `500000` only: a value like `500k` reads as `500` and clamps to the 100K minimum. The effective window is also capped at the model's context window. Takes precedence over the `/autocompact` command, the `--autocompact` flag, and the `autoCompactWindow` setting.

`500k` と書くと 500 トークンとして読まれ、最小値 100000 に張り付く。桁を間違えた書き方が静かに別の値になる例である。

圧縮の中身と副作用は別ページにある。[D] https://code.claude.com/docs/en/how-claude-code-works.md は「古いツール出力を先に消し、次に要約する」と説明し、`Autocompact is thrashing` という状態を定義する。[D] https://code.claude.com/docs/en/troubleshooting.md

> If you see `Autocompact is thrashing: the context refilled to the limit...`, automatic compaction succeeded but a file or tool output immediately refilled the context window several times in a row. Claude Code stops retrying to avoid wasting API calls on a loop that isn't making progress.

圧縮はキャッシュの再構築を伴う。[D] https://code.claude.com/docs/en/prompt-caching.md は、圧縮のたびにキャッシュ済みプレフィックスが作り直されると説明している。API 側にも圧縮がある（ベータヘッダ `compact-2026-09-04`、トップレベルの `compaction` パラメータ。[D] https://platform.claude.com/docs/en/build-with-claude/compaction.md）。これはハーネスの既定とは別の層なので混同しない。

### Codex CLI: 窓の 95% をハード上限にし、モデル別の自動圧縮値は公開していない

ソースが数値を決めている。[D] `codex-rs/models-manager/src/model_info.rs` のフォールバックは `context_window: Some(272_000)`、`max_context_window: Some(272_000)`、`auto_compact_token_limit: None`、そして `effective_context_window_percent: 95`。[D] `codex-rs/core/src/session/context_window.rs` は

> The model's full context window is a hard cap, independent of the auto-compaction scope.

として `full_context_window_limit = context_window * effective_context_window_percent / 100` を計算する。272,000 × 95% = 258,400 トークン。`token_limit_reached` は自動圧縮スコープの上限か、この硬い上限のどちらかで発火する。

つまみは設定スキーマにある。[D] https://learn.chatgpt.com/docs/config-file/config-reference.md と [D] `codex-rs/core/config.schema.json`。

| キー | 説明 | 既定 |
| --- | --- | --- |
| `model_auto_compact_token_limit` | 自動圧縮のトークン上限 | 「unset uses model defaults」 |
| `model_auto_compact_token_limit_scope` | `total`（既定）または `body_after_prefix` | `total` |
| `model_post_turn_compact_threshold_percent` | 最終応答後に圧縮する閾値（0〜100） | 数値の記載なし |
| `auto_compact_fallback_buffer_tokens` | フォールバックの緩衝 | 数値の記載なし |
| `compact_prompt` / `experimental_compact_prompt_file` | 要約プロンプト | — |

つまり「既定は 95%」までしか言えない。モデル別の `auto_compact_token_limit` はスキーマにも文書にも数値が出ておらず、[U] である。利用者向け文書 [D] https://learn.chatgpt.com/docs/codex-manual.md の唯一の数値はコメントアウトされた例 `# model_auto_compact_token_limit = 64000` である。

> `/compact` when the chat is getting long… Codex also compacts chats automatically

フックの `PreCompact` / `PostCompact` があり、自動圧縮の前後に介入できる。ベンダーの公式説明は圧縮を売り文句にしている。[D] https://openai.com/index/gpt-5-1-codex-max/（2025-11-19）

> It's our first model natively trained to operate across multiple context windows through a process called *compaction*, coherently working over millions of tokens in a single task.

> automatically compacts its session when it approaches its context window limit… repeats this process until the task is completed

### Gemini CLI: 既定は窓の 50%、実験的な履歴管理は 150K で切る

[D] https://raw.githubusercontent.com/google-gemini/gemini-cli/main/schemas/settings.schema.json に `"compressionThreshold"` があり、説明は "The fraction of context usage at which to trigger context compression (e.g. 0.2, 0.3)."、既定は `0.5`。[D] https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/reference/configuration.md も `model.compressionThreshold`「Default: `0.5`」「Requires restart: Yes」と一致する。

実験フラグ `experimental.contextManagement`（既定 `false`）には `contextManagement.historyWindow.maxTokens` の既定 `150000` と `retainedTokens` の既定 `40000` がある。つまり 1M 窓でも既定の圧縮点は 50 万、実験機能では 15 万である。

なお 2026-06-18 から、無料枠と Google One の利用者には Antigravity CLI への移行バナーが全ドキュメントページに出る。[D] `gh api repos/google-gemini/gemini-cli` は `archived:false`、`pushed_at:2026-09-26`、`stargazers_count:107164` で、リポジトリは生きている。

### Cline: 使える入力の 9 割で圧縮し、文書には数値を書いていない

[D] `sdk/packages/core/src/extensions/context/compaction-shared.ts`

```ts
export const DEFAULT_MAX_INPUT_TOKENS = 128_000;
export const CONTEXT_WINDOW_INPUT_RATIO = 0.9;
export const COMPACTION_TRIGGER_RATIO = 0.9;
export const DEFAULT_TARGET_RATIO = 0.7;
export const DEFAULT_PRESERVE_RECENT_TOKENS = 20_000;
export const DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS = 8_192;
```

`resolveEffectiveMaxInputTokens()` は `min(maxInputTokens, contextWindow)`、どちらも無ければ `contextWindow * 0.9` を返す。圧縮はその 0.9 を超えたら発火する。入力上限を公表しているモデルなら 90%、窓しか分からないモデルなら窓の 81% である。

UI には利用者が動かせる "Auto Condense Threshold" がある（[D] `ContextWindowSummary.tsx` が `${(autoCompactThreshold*100).toFixed(0)}%` を表示）。ドキュメントページには数値が無い（[D] `docs` 配下を検索して該当なし）。手動圧縮は `{ mode: "manual" }` を渡し `compaction.enabled` を強制 on にする（[D] `apps/vscode/src/sdk/sdk-compaction.test.ts`）。

### Aider: 自動圧縮が無い。上限は報告するだけで強制しない

[D] https://aider.chat/docs/troubleshooting/token-limits.html

> Aider never *enforces* token limits, it only *reports* token limit errors from the API provider.

リポジトリマップ用の予算は別で、[D] https://aider.chat/docs/repomap.html

> The token budget is influenced by the `--map-tokens` switch, which defaults to 1k tokens.

### OpenCode: 窓から出力予備 20K を引いたところで圧縮する

[D] `packages/opencode/src/session/overflow.ts`（リポジトリ `anomalyco/opencode`、ブランチ `dev`）

```ts
const COMPACTION_BUFFER = 20_000;
```

予備は `cfg.compaction?.reserved ?? Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(model, outputTokenMax))`。窓が入力上限を持つ場合は `input - 予備`、そうでなければ `context - maxOutputTokens`。発火は

```ts
if (cfg.compaction?.auto === false) return false;
if (model.limit.context === 0) return false;
count >= usable(input)
```

設定は [D] https://opencode.ai/docs/config.md の `"compaction": { "auto": true, "prune": false, "reserved": 10000 }`。`packages/opencode/src/session/compaction.ts` には `PRUNE_MINIMUM = 20_000`、`PRUNE_PROTECT = 40_000`、`MIN_PRESERVE_RECENT_TOKENS = 2_000`、`MAX_PRESERVE_RECENT_TOKENS = 15_000` がある。1M 窓なら発火点は 98% 前後になる。

### Crush: 200K を境に予備の持ち方を変える

[D] `internal/agent/agent.go`

```go
largeContextWindowThreshold = 200_000
largeContextWindowBuffer    = 20_000
smallContextWindowRatio     = 0.2
```

`shouldSummarize` は残りが閾値を下回ったら真を返す。閾値は窓が 200,000 超なら 20,000、以下なら窓の 20%。したがって 200K 以下の窓では 80%、200K 超では残り 20,000 で切る（1M なら 98%）。`disableAutoSummarize` で止められる。

### OpenHands: ソースの既定と文書の既定が食い違う

[D] `openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py`

```python
max_size: int = Field(default=240, gt=0)
keep_first: int = Field(default=2, ge=0)
```

一方 [D] https://docs.openhands.dev/sdk/arch/condenser.md は "default: 120" / "default: 4" と書く。**ソースが正**で、文書が古い。発火条件は 2 種類あり、`max_tokens` 超過は `Reason.TOKENS` としてハード、`max_size` イベント数超過は `Reason.EVENTS` としてソフト。`agent.py` の警告文自身が `max_size=240, keep_first=2` と表示する。

### Devin: 圧縮しきい値は公開されていない（否定的証拠）

ドキュメント索引 [D] `https://docs.devin.ai/llms.txt` の全体、`release-notes/2026.md`、`work-with-devin/devin-handoff.md`、`devin-session-tools.md`、`advanced-capabilities.md`、`cli/sandbox.md` を検索して、圧縮の閾値は見つからなかった。機構は ACU による従量課金と `/handoff`（子セッションへの引き継ぎ）で、`devin-handoff.md` にある唯一の数値は `git diff HEAD` の "(truncated to 100KB)" である。[U]

### Cursor: 手動の `/summarize` だけが文書化されている

[D] https://cursor.com/docs/cli/reference/slash-commands.md に `/summarize`（別名 `/compress`）がある。`docs/llms.txt` の索引全体に圧縮のページは無く、`docs/cli/reference/configuration.md` のスキーマにも文脈関連のキーが無い。既定値は [U]。

## 2. この家の予算: omp の 200K / 1M と pi の 1M 例

### omp は窓の 15% を予備として確保し、1M では 850K で圧縮する

[D] https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/agent/src/compaction/compaction.ts

```ts
export const DEFAULT_RESERVE_TOKENS = 16384;                       // 行 212

export function effectiveReserveTokens(contextWindow, settings) {   // 行 333-335
	return Math.max(Math.floor(contextWindow * 0.15), settings.reserveTokens ?? DEFAULT_RESERVE_TOKENS);
}
```

`resolveBudgetReserveTokens()`（行 349-358）が予備を確定し、`shouldCompact()`（行 363-367）は `contextTokens > resolveThresholdTokens(...)`、`resolveThresholdTokens()`（行 388-412）はこう決める。

```ts
// Fixed token limit takes priority over percentage      // 行 389
if (typeof thresholdTokens === "number" && ... thresholdTokens > 0)
	return Math.min(contextWindow - 1, Math.max(1, thresholdTokens));   // 行 393
...
Math.min(contextWindow - 1, contextWindow - resolveBudgetReserveTokens(contextWindow, settings))  // 行 407
```

つまり既定のしきい値は `窓 − max(floor(窓 × 0.15), 16384)` である。200,000 なら 200,000 − 30,000 = **170,000**、1,000,000 なら 1,000,000 − 150,000 = **850,000**（窓の 85%）。`compaction.thresholdTokens` を正の数で置くと割合より優先され、[1, 窓−1] に丸められる。`DEFAULT_COMPACTION_SETTINGS`（行 229-236）は `thresholdPercent: -1`、`thresholdTokens: -1`、`midTurnEnabled: true`、`keepRecentTokens: 20000`、`autoContinue: true`。決定記録が書いた 200K→170K / 1M→850K はこのコードで確認できる。

予備に 15% の下限がある理由は、ソースのコメント自身が書いている。行 217-220。

> The summary budget is `floor(0.8 * reserveTokens)`, and the effective reserve is at least 15% of the declared context window, so a 1M-token window authorizes a ~120k-token summary. At that size the model copies rather than compresses, and output is the slowest and most expensive token class.

1M 窓では要約の出力予算が約 12 万トークンになり、「その大きさではモデルは圧縮せずに写す」という設計上の理由である。決定記録の「1M 窓に比例した圧縮点は実運用で発火しなくなる」という主張の、ハーネス側の根拠がここにある。

窓の二段構えは [D] https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/models.md 行 90-96。

> Set `contextWindow` to the normal prompt window and `maxContextWindow` to the larger prompt window accepted by the provider. `/extended-context on` selects the larger window; `off` restores the normal one. … This changes OMP's local context budget, not the provider's server-side limit; verify the endpoint accepts requests of the configured size.

### pi は窓 − 16384 で発火し、1M モデルには自文書で 400K 予備（60 万発火）の例を示す

[D] https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/compaction.md

> Auto-compaction triggers when: `contextTokens > contextWindow - reserveTokens`
>
> By default, `reserveTokens` is 16384 tokens (configurable in `~/.pi/agent/settings.json` or `<project-dir>/.pi/settings.json`). This leaves room for the LLM's response.

同ページの `modelOverrides` の例が 1M 窓の扱いを示す。

> For a model with a 1M context window, this override triggers compaction above 600K tokens and keeps the ordinary 20000 recent tokens. Other models retain the ordinary 16384-token reserve.

pi の既定は窓−16K（1M なら 98.4%）だが、pi 自身が 1M モデルの例として 60% 発火を書いている。**家の外に「1M 窓なら 60 万で切る」という一次情報の前例がある**ことは、200K 予算を引き上げるときの最も近い参照点である。`reserveTokens` は要約出力の上限にも効き、しきい値専用ではないと同ページが断っている。

## 3. 測定エビデンス: 長文脈はどこから崩れるか

### 合成課題では 32K で半数が失速する

[D] RULER https://arxiv.org/abs/2404.06654

> only half of them can maintain satisfactory performance at the length of 32K

[D] NoLiMa https://arxiv.org/abs/2502.05167（潜在連想検索）

> At 32K, for instance, 11 models drop below 50% of their strong short-length baselines. Even GPT-4o… 99.3% to 69.7%

### 入力長だけを伸ばす統制実験では単調に劣化する

[D] Chroma "Context Rot" https://trychroma.com/research/context-rot

> Across all experiments, model performance consistently degrades with increasing input length.

同研究は課題の複雑さを固定し、入力長だけを変えている（"our experiments hold task complexity constant while varying only the input length"）。構造の一貫性が逆に効く場合があること、LongMemEval が全 113k トークンと焦点化した約 300 トークンで差が出ることも書く。ただし**モデル別の数値は本文に無く、グラフ画像のみ**（[U]）。

### 100K を超えたあたりから自己申告でも劣化が見える

[S] https://www.dbreunig.com/2025/06/22/how-contexts-fail-and-how-to-fix-them.html は 4 つの失敗モード（distraction、confusion、context clash、poisoning）を挙げ、Gemini 2.5 が「文脈が 100k トークンを大きく超えると…」と述べたこと、Databricks の計測で Llama 3.1 405b が 32k 付近で落ちること、プロンプトを分割すると「平均 39% 低下」したこと、o3 が 98.1 から 64.1 に落ちたことを引く。**[S]** である理由は `breunig.com` が TLS エラーで取得できず、アーカイブも 404 だったため。原文の数値は未取得。

### ベンダー自身が「長い文脈は劣化する」と書く

[D] https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents（2025-09-29）

> context rot… this characteristic emerges across all models

> smallest possible set of high-signal tokens

[D] https://claude.com/blog/using-claude-code-session-management-and-1m-context（2026-04-15、Thariq Shihipar）

> the model is at its least intelligent point when compacting

> when you start a new task, you should also start a new session

> will I need this tool output again, or just the conclusion?

注目すべきは、**1M 窓を売る文書が作業予算の数値を勧めず、代わりにタスク境界とセッション分割を勧めている**ことである。ベンダーの推奨が数値ではなく単位（セッション）で語られている。

### コーディングエージェント固有の 2026 年の測定がある

[D] https://arxiv.org/abs/2605.12366（Classifier Context Rot、2026-05-12）

> miss these actions 2× to 30× more often when they occur after 800K tokens of benign activity than when they occur on their own

エージェントの転写が "often exceed 500K tokens" になることも書く。**800K という数字は、1M 窓のハーネスにとって実務上の警報である**。

### 圧縮そのものが新しい失敗点になる

[D] https://alignment.openai.com/misalignment-reports/self-generated-prompt-injections-in-compaction-summaries/（事象 2026-07-18、更新 2026-09-16）は、圧縮の要約に混入した指示が後続セッションに持ち越された事例を報告する。再生成では 0% 再現（"0% reproduction when regenerating the entire summary"）で、対象は "only 27 summaries"、後継セッションの 1 つは "returned a 23-word refusal (which was graded as incorrect)"。要約は決定論的でなく、圧縮が品質の不確実性を導入することをベンダー自身が認めた文書である。

## 4. 実践者と実地

### 実地の事故はすべて「圧縮が発火しない」側で起きている

[D] https://github.com/cline/cline/issues/14329（2026-09-20 起票、現在 closed / state_reason `completed`、コメント 4）タイトルは "Auto-compact threshold scales with context window, so 1M-context models never compact in practice — no way to configure it"。本文の実測表は 1M 窓・$2/$10 のモデルで

```
| Context window used | 294.9k / 1.0m (29.5%) |
| Cache writes        | 32.8k   |
| Cache reads         | 3.3m    |
| Reported cost       | $49.63  |
Cache hit rate: 3.3m / (24.1m + 3.3m) = **12%**.
No compaction ever fired, because 294.9k is nowhere near the 1M trigger.
```

比較用の小さい実行では "Cache hit rate ~98%. Caching itself is clearly working correctly" と書かれており、**98% は前後比較ではなく対照実験の値**である。1 タスク $49.63、キャッシュヒット 12% という同じモデルで桁が違う結果が出ている。決定記録の「cache hit 98% → 12%」はこの意味で正確には「対照の 98% に対し 12%」と読むべきである。

[D] https://github.com/openai/codex/issues/19185（2026-04-23 起票、現在 closed / `not_planned`、コメント 24）

> model_context_window = 960000

> After setting a large context window, for example around `1M`, Codex still automatically reports/uses about `258k` instead. This makes it impossible to control the effective context window from the config file.

> The configured value is silently reduced/ignored. For example, setting approximately `1M` results in Codex automatically changing/using about `258k`.

[D] https://github.com/earendil-works/pi/issues/9482（2026-09-11 起票、現在 closed / `completed`、コメント 2）タイトルは "Empty-body 400 from OpenAI-compatible gateways … misclassified as context overflow → destructive auto-compaction destroys up to ~400k tokens"。つまり長文脈そのものではなく、誤分類された 400 が破壊的な圧縮を起動した事故である。

[D] https://github.com/anomalyco/opencode/issues/16308（2026-03-06 起票、現在 closed / `completed`） "How to enable 1M context in OpenCode for GPT-5.4? Compaction triggers at 272k, not 1M"。

3 件とも closed になったが、修正コミットの中身は読んでいない（[U]）。いずれも「窓を大きく取ると圧縮が発火しない／設定が効かない」という同じ形の失敗である。

### 実践者の一次発言

- [S] Simon Willison の記事 https://simonwillison.net/2026/Sep/17/compaction-prompt-injection/ と https://simonwillison.net/2025/Nov/19/gpt-5-1-codex-max/ を当人のサイト内検索経由で読んだ。前者は上記 OpenAI の圧縮要約インシデント、後者は GPT-5.1-Codex-Max の圧縮説明を話題にしている。ブログ本文の直接取得はしていないため [S] とする。
- 実践者の「試して戻した」記録は Cline #14329 と Codex #19185 の形で issue に残っている。issue トラッカーは否定的な事例に偏る媒体である（肯定的に動いている構成は起票されない）。

## まとめ表

| 情報源 | 種別 | タスク種別 | 結果 | コスト数値 | 名指しの失敗モード |
| --- | --- | --- | --- | --- | --- |
| code.claude.com model-config [D] | ベンダー文書 | — | 1M 窓で約 967K 発火、ゲートウェイ越しは 200K 予算 | 数値なし | `Autocompact is thrashing` |
| claude.com 2026-04-15 [D] | ベンダー文書 | 実務ガイド | 数値ではなくセッション境界を推奨 | 数値なし | 「圧縮時が最も賢くない」 |
| codex model_info.rs / context_window.rs [D] | ソース | — | 窓の 95% がハード上限（272,000→258,400） | 数値なし | モデル別自動圧縮値は非公開 |
| gemini-cli settings.schema.json [D] | ソース | — | `compressionThreshold` 既定 `0.5` | 数値なし | 実験機能は 150,000 |
| Cline compaction-shared.ts [D] | ソース | — | 入力の 0.9 で発火（窓のみ既知なら 0.81） | 数値なし | 文書に数値が無い |
| aider.chat token-limits [D] | ベンダー文書 | — | 自動圧縮なし | `--map-tokens` 既定 1k | 上限は報告のみ |
| opencode overflow.ts [D] | ソース | — | 窓−予備（20K） | 数値なし | #16308 が 272K で発火 |
| crush agent.go [D] | ソース | — | >200K は 20K 残し、≤200K は 80% | 数値なし | — |
| OpenHands condenser.py [D] | ソース | — | 240 イベント / トークン上限 | 数値なし | 文書が 120 と書く乖離 |
| omp compaction.ts [D] | ソース | — | 窓−max(15%, 16,384)：200K→170K、1M→850K | 数値なし | 1M で要約が ~120K になり「写す」 |
| pi compaction.md [D] | ベンダー文書 | — | 既定は窓−16,384。1M 例は 60 万発火 | 数値なし | — |
| RULER [D] | 論文 | 合成長文脈 | 32K で半数が失速 | 数値なし | — |
| NoLiMa [D] | 論文 | 潜在連想検索 | 32K で 11 モデルが 50% 未満、GPT-4o 99.3→69.7 | 数値なし | — |
| Chroma context rot [D] | ベンチ | 入力長のみ変化 | 単調劣化 | 数値なし | モデル別数値は画像のみ |
| arXiv 2605.12366 [D] | 論文 | エージェント監視 | 800K 後で 2〜30 倍の見落とし | 数値なし | 転写 500K 超 |
| OpenAI alignment report [D] | インシデント報告 | エージェント | 27 要約、再生成で 0% 再現 | 数値なし | 要約経由のプロンプト注入 |
| Cline #14329 [D] | issue | 実タスク | 294.9k / 1.0m | $49.63、cache 12%（対照 98%） | 圧縮が発火しない |
| Codex #19185 [D] | issue | 実タスク | 960K 設定 → 258k | 数値なし | 設定の黙殺（not_planned） |
| pi #9482 [D] | issue | 実タスク | ~400k 破壊 | 数値なし | 400 誤分類 → 破壊的圧縮 |

## 結論

1M 窓に対する 200K 予算は**保守的**で、標準でも後れでもない。

根拠は 3 つ。第 1 に、見つかった全ベンダーの既定トリガーは窓の 50%（Gemini CLI）から 98% 台（Crush・OpenCode・pi 既定）に散らばり、**1M 窓に対して 20% を強制するベンダーは 1 つも無い**。200K が現れるのは Claude Code のゲートウェイ・フォールバック（1M を検証できないとき）だけで、これは「保守側に倒す既定」ではなく「確認できないので小さく仮定する」という別の理由である。第 2 に、**数値で作業予算を推奨する一次情報は無い**。より短い方が良いという測定（RULER 32K、NoLiMa 32K、Chroma の単調劣化、800K 後で 2〜30 倍の見落とし）は「200K より長くするな」としか言っておらず、200K を最適点として支持する測定も、200K では足りないという測定も無い。第 3 に、1M 窓を売るベンダー自身の運用ガイドが、数値ではなくタスク境界と新セッションを勧めている。つまり「窓を予算として小さく置く」という発想自体が、この家の設計判断であって業界の既定ではない。

反面、200K には代償がある。圧縮は毎回キャッシュの再構築を伴い（Claude Code prompt-caching [D]）、圧縮の要約自体が品質の不確実性と注入の舞台になる（OpenAI alignment report [D]、Anthropic「圧縮時が最も賢くない」[D]）。窓を小さく取れば劣化事象は減るが圧縮回数は増える。この取引を数値で示す一次情報は見つからなかった（[U]）。

引き上げるなら、家の外の最も近い前例は pi が自文書に書いた 1M の例、`reserveTokens: 400000`（60 万発火、窓の 60%）である [D]。200K の 3 倍に当たるが、Cline の 294.9k / $49.63 事故や 800K 後の見落としを踏まえると、60 万は根拠ある上限側の候補で、850K（omp の 1M 既定）は測定が警告する領域に入る。omp の `/extended-context on` はこの引き上げ先をセッション単位で試せる逃げ道として設計に残っている。

## 確認できなかったこと

- **Codex のモデル別 `auto_compact_token_limit` の実値**。スキーマは "unset uses model defaults" としか書かず、文書の唯一の数値はコメントアウトされた例 `# model_auto_compact_token_limit = 64000`。[U]
- **Cursor の自動圧縮の既定**。`/summarize` の存在は確認したが、自動発火のページもキーも見つからなかった。[U]
- **Devin の圧縮しきい値**。`llms.txt` 索引の全体と関連ページを検索して数値なし。[U]
- **`microcompact` という仕組みの存在**。Claude Code のドキュメント全体を検索して一致 0 件。名前だけが流布している。[U]
- **Cline #14329 / pi #9482 / opencode #16308 の修正内容**。状態は closed / `completed` だが差分は読んでいない。[U]
- **Chroma のモデル別数値**。本文に数値が無く、グラフが画像のみ。[U]
- **Breunig の記事の原文**。`breunig.com` が TLS で落ち、アーカイブも 404。引用は検索結果経由 [S]。
- **omp で `compaction.thresholdTokens` を 200000 に固定した運用の実測**。本記録はコード読解のみ。[U]
- **Codex が 95% 上限に達した後、1M 級モデルで何が起こるかの実測**。設定の切り詰めは issue にあるが、上限到達後の挙動の記録は見つからなかった。[U]
- **`deterministic` の LM Studio 実ロード値**。決定記録の前提で、本記録の対象外。[U]
