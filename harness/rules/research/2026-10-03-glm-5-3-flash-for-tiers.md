# GLM-5.3-Flash は jig の tier（main / complex）に入れる根拠があるか

確認日: 2026-10-03

前提: 2026-09-23 の knowledge（`../knowledge/main-tier-model-alternatives-evaluated.md`）は GLM-5.3 本体を DeepSeek Flash と比べ、「品質は上だがタスク当たり約 7.4 倍のコスト・速度 1/3.7」と結論し、廉価版 GLM-5.3-Flash の品質だけを未確認で残していた。この記録はその穴を埋める。

## 答え

GLM-5.3-Flash は GLM-5.3 本体の提供ティアではなく別のモデル（合計 320B・アクティブ 18B の MoE、MIT ライセンスで重み公開、1M コンテキスト・最大出力 128K、画像・動画入力あり、2026-08-26 公開）。独立測定（Artificial Analysis、以下 AA）の Intelligence Index は 41.8 で、現行 `main` の DeepSeek V4.1 Flash（39.5）とほぼ同等、GLM-5.3 本体（44.8）には届かない。トークン単価は DeepSeek Flash の約半分（$0.15 / $0.50 per 1M）だが、AA のタスク当たりコストは $0.253 対 $0.265 で差が無い。速度は 52.4 tok/s・TTFT 3.31 秒で、DeepSeek V4.1 Flash（213 tok/s・1.06 秒）に対して出力は約 1/4、タスク時間は 988 秒対 305 秒と約 3 倍遅い。

運用面の否定側証拠が 3 つある。(1) Z.ai の従量課金エンドポイントで `tools` を付けると毎リクエスト TTFT が約 3 秒増える現象が公式 issue で未解決。(2) 英語のみのエージェントセッションで中国語などの混入と、出力全体が無意味列に崩壊する報告が open。(3) LiteLLM の `zai` プロバイダが `response_format` を落とす issue が未解決。加えて thinking は無効化できず（`reasoning_effort` の low/high/max のみ）、reasoning 履歴の保持に `clear_thinking: false` が要る。

ベンダー主張の AA スコア「57、$0.045/タスク」は AA 自身の 41.8・$0.253 と食い違い、理由は不明。ベンダーのベンチ表の比較相手は GLM-5.3 本体ではなく GLM-5.2 で、Flash が本体にどれだけ劣るかはベンダー資料から読めない。

同一課題で GLM-5.3-Flash と DeepSeek Flash を比べた公開記録は X の 1 件（3 課題、GLM 2 勝 1 敗、投稿本体は未達）だけで、日本語の実測は無い。SWE-bench Verified・Aider polyglot・LiveCodeBench・τ²-bench の独立数値も見つからなかった。

結論として、`main` を置き換える根拠は無い（品質同等・実コスト同等・速度 1/3〜1/4・ツール呼び出しの遅延と言語混入の未解決 issue）。`complex` にも向かない（AA 指標では現行の DeepSeek V4 Pro 0813 の 36.0 を上回るが、AA 指標はコーディングエージェントの優劣を示す測定ではなく、escalation 先として本体より弱いモデルを選ぶ理由が無い）。カタログ（`harness/policy/models.json`）に入れるなら、この repo の bench（`home/shared/litellm/config/bench/`）で DeepSeek Flash と同一プロンプトを実測してからで、その測定は未実施。

副産物として、AA の Intelligence Index 上では現行 `complex` の DeepSeek V4 Pro 0813（36.0）が Flash 系二つ（41.8 / 39.5）より低い。`complex` の選定は別の問いとして残る。

## 根拠

### 独立測定（AA、各モデルページの SSR JSON、2026-10-03 取得）

| モデル（AA 表記） | 総/アクティブ | Intelligence Index | タスク当たりコスト | 時間/タスク | tok/s | TTFT |
|---|---|---|---|---|---|---|
| GLM-5.3-Flash (max) | 320B/18B | 41.8 | $0.253 | 988 秒 | 52.4 | 3.31 秒 |
| GLM-5.3 (Max) | 753B/40B | 44.8 | $2.006 | 769 秒 | 71.4 | 3.18 秒 |
| DeepSeek V4.1 Flash (Max) | 552B/16B | 39.5 | $0.265 | 305 秒 | 213.3 | 1.06 秒 |
| DeepSeek V4 Pro 0813 (Max) | 1600B/49B | 36.0 | $0.674 | 439 秒 | 109.2 | 1.69 秒 |
| MiMo-V2.6-Flash | 309B/15B | 37.9 | $0.062 | 1571 秒 | 48.2 | 5.53 秒 |
| Qwen3.8 27B (Xhigh) | 27B/- | 33.7 | $1.007 | 1142 秒 | 46.1 | 3.90 秒 |

| モデル | Terminal-Bench 2.1 | Terminal-Bench 4.0 | τ-banking | Omniscience 幻覚率 |
|---|---|---|---|---|
| GLM-5.3-Flash | 84.3% | 32.8% | 47.2% | 27.6% |
| GLM-5.3 | 83.9% | 41.9% | 50.3% | 29.6% |
| DeepSeek V4.1 Flash | null | 26.8% | null | 96.5% |
| DeepSeek V4 Pro 0813 | 78.7% | 14.1% | 39.6% | 94.8% |

- https://artificialanalysis.ai/models/glm-5-3-flash 、 https://artificialanalysis.ai/models/glm-5-3 、 https://artificialanalysis.ai/models/deepseek-v4-1-flash 、 https://artificialanalysis.ai/models/deepseek-v4-pro 、 https://artificialanalysis.ai/models/mimo-v2-6-flash 、 https://artificialanalysis.ai/models/qwen3-8-27b
- AA の速度値は時期で動く（GLM-5.3 本体は 09-23 の 60.69 tok/s から 71.4 へ）。Index 44.78 は一致。
- プロバイダ別では第三者ホスト（LithosAI FP4 で 717.5 tok/s）が Z.ai 自身の API より速い。品質差は未確認 — https://artificialanalysis.ai/models/glm-5-3-flash/providers
- AA の LiveCodeBench・τ²-bench は全モデル null、Coding Index の値は SSR JSON に無し。

### フロンティア帯との位置（AA、同日取得。「Mythos 級」という評判の検証）

| モデル（AA 表記） | Intelligence Index | タスク当たりコスト | Terminal-Bench 2.1 | Terminal-Bench 4.0 | τ-banking |
|---|---|---|---|---|---|
| GLM-5.3-Flash (max) | 41.8 | $0.253 | 84.3% | 32.8% | 47.2% |
| Claude Opus 5.5 (Max) | 57.6 | $5.98 | null | 59.6% | null |
| Claude Fable 5.1 (Max) | 53.4 | $7.63 | 91.4% | 52.0% | 47.2% |
| Claude Fable 5 (Max) | 49.6 | $8.75 | 84.6% | 42.4% | 38.1% |
| Claude Opus 4.8 (Max) | 41.8 | $4.08 | 84.6% | 21.7% | 34.2% |
| GPT-5.6 Sol (Max) | 47.0 | $1.99 | 88.0% | 39.9% | 44.3% |
| GPT-5.6 Terra (Max) | 42.1 | $1.40 | 88.0% | 35.4% | 40.2% |
| Gemini 3.7 Flash (High) | 39.1 | $0.925 | 85.8% | 13.6% | 32.8% |

- https://artificialanalysis.ai/models/{claude-opus-5-5,claude-fable-5-1,claude-fable-5,claude-opus-4-8,gpt-5-6-sol,gpt-5-6-terra,gemini-3-7-flash} 。Claude Mythos 5 と Gemini 3.7 Pro は AA の一覧に無い（NOT FOUND。存在の否定ではない）。
- Z.ai が比較相手にしているのは Claude Opus 4.8 のみ。HF README: "approaching Claude Opus 4.8 on coding and agentic benchmarks"。モデルカード: "at max effort nearly matches Claude Opus 4.8 (29.0 vs. 29.5)"（Z.ai Code Bench v1.0、自社ベンチ）。README とモデルカードを `Mythos|Fable` で grep しても言及無し — https://huggingface.co/zai-org/GLM-5.3-Flash/raw/main/README.md 、 https://docs.z.ai/guides/llm/glm-5.3-flash
- AA 上では Opus 4.8（2026-05 公開）と同点の 41.8 で、現行フロンティアの Opus 5.5 とは約 16 ポイント、Fable 5.1 とは約 12 ポイント差。Opus 4.8 と同じ帯を、コストは 1/16 で出している、というのが数字の読み方。

### ベンダー主張（Z.ai 自身、割り引いて読む）

| ベンチマーク | GLM-5.3-Flash | GLM-5.2 | DeepSeek-V4-Vision-Exp | Claude Opus 4.8 | GPT-5.6 Terra |
|---|---|---|---|---|---|
| Terminal Bench 2.1 | 84.3 | 81.0 | 83.9 | 85.0 | 87.4 |
| DeepSWE v1.1 | 63.4 | 46.2 | 59.3 | 58.0 | 69.6 |
| Agents' Last Exam | 26.3 | 20.4 | 27.3 | 27.0 | 28.0 |
| HLE w/ Tools | 55.3 | 54.7 | 55.1 | 57.9 | - |

- 図 https://raw.githubusercontent.com/zai-org/GLM-5/refs/heads/main/resources/bench_53.png 、README https://huggingface.co/zai-org/GLM-5.3-Flash/raw/main/README.md（"approaching Claude Opus 4.8 on coding and agentic benchmarks"）
- 比較相手は GLM-5.3 本体でなく GLM-5.2。Terminal-Bench 2.1 は Claude Code 2.1.207・6 時間タイムアウト、DeepSWE は mini-swe-agent（README 脚注）。
- 「AA Intelligence Index v4.1.1 で 57、$0.045/タスク（割引時）」 — https://docs.z.ai/guides/llm/glm-5.3-flash 。AA 自身の値と食い違う。

### モデルの正体・API 仕様

- 320B/18B、ハイブリッド注意、本体より注意計算 3.01 倍・KV キャッシュ 4.44 倍小さいという主張 — https://docs.z.ai/guides/llm/glm-5.3-flash
- MIT、アーキテクチャ `glm5_next`、作成 2026-08-25 — https://huggingface.co/zai-org/GLM-5.3-Flash
- thinking 無効化不可: "`thinking.type` only supports `enabled`"（同モデルカード）、"GLM-5.3 and GLM-5.3-FLASH use forced thinking and cannot be disabled" — https://docs.z.ai/guides/capabilities/thinking-mode
- `reasoning_effort` は low/high/max、既定 max（HF README）。`clear_thinking: false` を推奨、ストリーミングは `stream: true` + `tool_stream: true`（公式ドキュメント）。
- 価格 $0.15 / キャッシュ $0.03 / $0.50、FlashX は $0.37 / $1.25 — https://docs.z.ai/guides/overview/pricing 。発売時 50% 割引は 2026-09-09 終了 — https://github.com/can1357/oh-my-pi/pull/9835
- 従量課金エンドポイントは `https://api.z.ai/api/paas/v4`、Coding Plan 用は `/api/coding/paas/v4`（omp の catalog seed は後者） — https://github.com/zai-org/GLM-5/issues/144 、omp `packages/catalog/src/compat/rules/providers/zai.kdl`

### ハーネス・プロキシ適合

- LiteLLM 価格表に `zai/glm-5.3-flash`（1.5e-07 / 5e-07 / キャッシュ 3e-08、入力 1,048,576、出力 128,000、function_calling / reasoning / vision true、`supports_response_schema` 未設定）。この repo が pin する LiteLLM（2026-09-20 ビルド、`home/shared/litellm/config/litellm-up.sh`）のコンテナ内 `litellm.model_cost` で同じ値を確認。openrouter / together_ai / nebius / fireworks など 10 件超の第三者ホスト版も登録済み。
- `zai` が `response_format` を落とす #37720 は OPEN（最終更新 2026-08-20、コメント 0） — https://github.com/BerriAI/litellm/issues/37720
- Responses→Chat 変換が空の text パートを出し Z.ai が 400/code 1210 で拒否（Codex CLI 経由、Flash 固有ではない） — https://github.com/BerriAI/litellm/issues/43848
- Anthropic 互換経路で code 1210 の間欠 400 — https://github.com/decolua/9router/issues/4409 、503 — https://github.com/anomalyco/opencode/issues/51120
- pi で reasoning が保持されない、`clear_thinking: false` で解消 — https://github.com/aliou/pi-synthetic/issues/119
- omp は 18.0.9 で GLM flash 系を「reasoning する flash SKU」と扱うよう修正 — https://github.com/can1357/oh-my-pi/pull/9835 、https://github.com/can1357/oh-my-pi/issues/10046

### 実践者・issue の報告（否定側）

- `tools` を付けると TTFT が毎回約 3.4 秒増（tools なし 0.76 秒、1 個で 3.76 秒。ツール数・`tool_choice: "none"`・キャッシュ率に無関係。10-02 の追試でも間欠的に残る。メンテナ調査中） — https://github.com/zai-org/GLM-5/issues/144
- 英語のみの利用で中国語・独語の混入、"it happens after tool calls. Saying 'reply in english' works for a turn or two" — https://github.com/zai-org/GLM-5/issues/142 ；ハーネス側が全メッセージに "Reply in English" を注入する回避策 — https://github.com/CodebuffAI/freebuff/issues/1152
- 出力全体が多言語の無意味列に崩壊しエラー無く完了扱い（Ollama cloud 経由、100K トークン付近から） — https://github.com/zai-org/GLM-5/issues/163 ；長時間 workload で reasoning が反復に崩壊（vLLM、私的量子化版） — https://github.com/vllm-project/vllm/issues/56868
- 公式 `chat_template.jinja` が文字列形式の `tool_calls[].function.arguments` で例外（自前配信のみ） — https://github.com/zai-org/GLM-5/issues/158
- ツール引数生成中は回線がゼロバイト、完了後に 1 イベント（第三者プロキシ経路） — https://github.com/shuzuan-org/sub2api/issues/3

### ライフサイクル・データ・ToS

- Flash 系の廃止告知は無し。リリースノートに GLM-4.7-Flash / GLM-4.5-Air の廃止記述は見つからず、価格ページでは GLM-4.7-Flash と GLM-4.5-Flash が無料で並ぶ — https://docs.z.ai/release-notes/new-released 、 https://docs.z.ai/guides/overview/pricing 。2026-09-30 の記録にある「Z AI 自身が非推奨」は一次ソースで再確認できていない。
- "The Company do not store any of the content the Customer or its End Users provide or generate" — https://docs.z.ai/legal-agreement/privacy-policy （学習への不使用の契約文言は未確認）
- Coding Plan は公式サポートツール限定 — https://docs.z.ai/devpack/usage-policy 。従量課金 API キーでの第三者エージェント利用については記述が無い。

### 同一課題の比較

- X の 1 件（自作ハーネス、3 課題、GLM 2 勝 1 敗。コードレビューで GLM が 27 分・ファイル読み 35 回、DeepSeek が 45 分・シェル 55 回。投稿本体は HTTP 402 で未達） — https://x.com/MiaAI_lab/status/2101316031666876614
- GLM-5.3 本体対 DeepSeek V4.1 Flash の記事はあるが Flash の比較ではない — https://www.yottalabs.ai/post/glm-5-3-vs-deepseek-v4-1-flash-2026
- 日本語: Qiita の日本語性能比較は GLM-5.2 まで — https://qiita.com/nabe2030/items/7ae4a739bf45ecae3236

## 注意点

- AA の Coding Index は取得できず。OpenRouter 比較ページ要約の "71.5 / 50.9" は定義未確認。
- ベンダーの「57 / $0.045」と AA の「41.8 / $0.253」の食い違いは未解明（指標バージョンか割引か）。
- レート制限・同時接続数は未達（旧 URL 404、新 URL は JS 描画）。
- DeepSeek Flash の AA コスト $0.265 は時間帯・地域で変わる料金の下での値で、条件を揃えた比較ではない。
- pi の `thinkingFormat` と GLM-5.3-Flash の対応は未確認。
- LiteLLM 経由の Z.ai 直結で `glm-5.3-flash` が動く検証記録は無く、この repo の bench でも未測定。
- 日本語出力品質・長文脈での挙動の独立実測は無い。報告は英語セッション中の言語混入のみ。
- Z.ai のプライバシー・ToS・リリースノートは要約経由で、原文の全文は読めていない。
