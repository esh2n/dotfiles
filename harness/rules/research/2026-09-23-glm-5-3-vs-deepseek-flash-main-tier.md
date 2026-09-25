---
title: "GLM-5.3 は DeepSeek Flash を main tier から置き換えるべきか"
date: 2026-09-23
---

## 対象の問い

`main` tier（pi / DSH / omp が LiteLLM プロキシ経由で叩く日常コーディングエージェント用モデル、現行 `deepseek/deepseek-flash`）を Zhipu/Z.ai の GLM-5.3 に置き換えるべきかを、価格・ベンチマーク・運用面・否定的証拠の四方向（ベンダー・実践者・測定・実態）で調べる。ツール呼び出し・長時間エージェントセッション・プレフィックスキャッシュの多用という運用形状を前提とする。

## 検証方法と凡例

- 「直接取得」= `curl` で生 HTML / Markdown（`docs.z.ai` は `.md` サフィックスで生 Markdown が取得できた）を取得し、タグ除去または `grep`/`python re` で本文を直接確認した箇所。
- 「直接取得（JSON埋め込み）」= サイトが Next.js の SSR JSON を HTML に埋め込んでおり（Artificial Analysis）、そのJSON文字列を正規表現で直接抜き出した箇所。要約モデルを経由していない。
- 「要約経由」= WebFetch（要約モデル経由）または WebSearch のスニペット要約のみで確認した箇所。数値の再確認ができていない場合は明記する。
- 「到達不能」= JS レンダリングのため生データが取れなかった箇所（`z.ai/subscribe` の月額 $ 表示、LMArena のリーダーボードなど）。
- `gh` CLI はこのサンドボックスで TLS 証明書検証エラー（`tls: failed to verify certificate: x509: OSStatus -26276`）が発生し使用不能だった。GitHub 情報は認証なし `curl https://api.github.com/...` で代替した（`search/code` は認証が必要なため使用不能、`search/repositories` と個別 issue/PR 取得のみ可能）。

---

## 1. 価格

### DeepSeek（ベンダー直接取得）

URL: https://api-docs.deepseek.com/quick_start/pricing （直接取得、生 HTML から抽出）

verbatim（タグ除去後の生テキスト、表構造を `|` で区切って再構成）:

> "MODEL|deepseek-flash|(1)|deepseek-v4-pro| ... MODEL VERSION|DeepSeek-V4.1-Flash|DeepSeek-V4-Pro-0813| ... PRICING|(2)|1M INPUT TOKENS|(CACHE HIT)|OFF-PEAK|$0.003|$0.022|PEAK|$0.006|$0.044|1M INPUT TOKENS|(CACHE MISS)|OFF-PEAK|$0.15|$0.66|PEAK|$0.3|$1.32|1M OUTPUT TOKENS|OFF-PEAK|$0.6|$1.98|PEAK|$1.2|$3.96|Concurrency Limit|(3)|2500|500"

> "(2) Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays. All other hours are off-peak, including weekends and Chinese public holidays in full."

正規化（USD / 1M トークン、`deepseek-flash` = `DeepSeek-V4.1-Flash`）:

| 項目 | Off-peak | Peak |
|---|---|---|
| Input（cache miss） | $0.15 | $0.30 |
| Input（cache hit） | $0.003 | $0.006 |
| Output | $0.60 | $1.20 |

Concurrency limit は 2500（`deepseek-v4-pro` は 500）。キャッシュは「自動プレフィックスキャッシュ」で、コード変更不要（この主張自体はベンダーページに明記はないが、LiteLLM 側のドキュメント記述と整合。下記2章参照）。

### GLM-5.3（ベンダー直接取得）

URL: https://docs.z.ai/guides/overview/pricing （`.md` サフィックスで直接取得、Mintlify の生 Markdown）

verbatim:

> "| Model          | Input  | Cached Input | Cached Input Storage | Output |"
> "| GLM-5.3-Flash  | \$0.15 | \$0.03       | Limited-time Free    | \$0.50 |"
> "| GLM-5.3-FlashX | \$0.37 | \$0.075      | Limited-time Free    | \$1.25 |"
> "| GLM-5.3        | \$1.4  | \$0.26       | Limited-time Free    | \$4.4  |"
> "| GLM-5.2        | \$1.4  | \$0.26       | Limited-time Free    | \$4.4  |"

正規化（USD / 1M トークン、pay-as-you-go・国際エンドポイント。**ピーク/オフピークの区別なし** — 下記の割引は API 従量課金ではなく GLM Coding Plan のクレジット消費にのみ適用される）:

| モデル | Input | Cached Input | Output |
|---|---|---|---|
| GLM-5.3-Flash | $0.15 | $0.03 | $0.50 |
| GLM-5.3-FlashX | $0.37 | $0.075 | $1.25 |
| GLM-5.3 | $1.40 | $0.26 | $4.40 |

「Cached Input Storage」が "Limited-time Free" と明記されており、キャッシュ保持自体に無期限の無料保証はない点は注意（[unverified] 期限は本ページに記載なし）。

bigmodel.cn（中国国内エンドポイント）側の価格ページは中国語かつ人民元建てで別途確認が必要であり、**今回は未確認**（下記5章）。国際エンドポイント（z.ai）の価格のみを扱う。

### GLM Coding Plan サブスクリプション（ベンダー直接取得）

URL: https://docs.z.ai/devpack/overview （`.md` 直接取得）

verbatim（クレジット配分表）:

> "| Plan Type | 5-Hour Credits | Weekly Credits |"
> "| Lite | 2,000 | 10,000 |"
> "| Pro | 12,000 | 60,000 |"
> "| Max | 28,000 | 140,000 |"

> "Model credit usage = (Input tokens × Input multiplier + Cached Input tokens × Cached Input multiplier + Output tokens × Output multiplier) / 10,000"

multiplier 表（同ページ）: GLM-5.3 は Input 6.9 / Cached Input 1.7 / Output 24。GLM-5.3-Flash は Input 2.3 / Cached Input 0.56 / Output 8。

> "During off-peak hours, model usage is charged at 50% of the standard credit rate."
> "Peak hours: Monday to Friday, 14:00–18:00 Singapore Standard Time (UTC+8)."

月額の $ 額は `z.ai/subscribe` が JS レンダリングのため直接確認**できなかった**（到達不能）。複数の第三者アグリゲータ（すべて要約経由・非公式）を突き合わせると、Lite ≈ $18/月という点はほぼ一致するが、Pro/Max は $72〜$80 / $160〜$168 の間でサイトごとにばらついており（例: [aipricing.guru](https://www.aipricing.guru/z-ai-subscription-pricing/) は "Lite $18, Pro $72, Max $160"、別サイトは "Lite $18, Pro $80, Max $168"、さらに別サイトは "Lite $10, Pro $30, Max $80"）、**一次情報での金額確認は取れていない**。金額は [unverified] とする。

**サードパーティハーネスからの利用可否（重要）**: 同じ overview ページに明記された使用範囲:

> "The plan can be applied to coding tools such as Claude Code, Cline, and OpenCode"

利用規約ページでより明確に制限されている。URL: https://docs.z.ai/devpack/usage-policy （`.md` 直接取得）

> "**Use limited to supported tools**: GLM Coding Plan may only be used within [officially supported tools and products](https://docs.z.ai/devpack/tool/others#step-1-supported-tools). Use in unsupported tools may result in restricted benefits."

サポート対象ツール一覧（https://docs.z.ai/devpack/tool/others 、`.md` 直接取得）には **Pi が名指しで含まれる**（`<Card title="Pi" href="/devpack/tool/pi" icon="list">`）。一方 **DSH・omp はどちらのカテゴリ（Coding Agent Tool / General-purpose Agent Tool）にも一切登場しない**。つまり GLM Coding Plan のサブスクリプション料金（クレジット制、上記の割引後の実質価格）は pi では正規に使えるが、DSH/omp で使うと「使用制限」の対象になり得る（3回の違反でアカウント停止の可能性、後述4章）。**pay-as-you-go の API キー課金にはこのツール制限の記載はない**（この制限は Coding Plan サブスクリプションのみに紐づく）ため、LiteLLM 経由で pi/DSH/omp すべてに配る前提なら pay-as-you-go 価格（本節冒頭の表）で見るのが妥当。

### LiteLLM の組み込みコストマップ（直接取得: GitHub raw JSON, `BerriAI/litellm` main branch, 2026-09-23 時点）

`model_prices_and_context_window.json` の実エントリ（`https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`）:

```json
"zai/glm-5.3": {
  "input_cost_per_token": 1.4e-06, "output_cost_per_token": 4.4e-06,
  "cache_read_input_token_cost": 2.6e-07, "cache_creation_input_token_cost": 0,
  "max_input_tokens": 1000000, "max_output_tokens": 128000,
  "source": "https://docs.z.ai/guides/overview/pricing",
  "supports_prompt_caching": true, "supports_function_calling": true
}
"deepseek/deepseek-flash": {
  "input_cost_per_token": 3e-07, "output_cost_per_token": 1.2e-06,
  "input_cost_per_token_cache_hit": 6e-09, "cache_read_input_token_cost": 6e-09,
  "max_input_tokens": 1000000, "max_output_tokens": 393216,
  "off_peak_pricing": {"input_cost_per_token": 1.5e-07, "output_cost_per_token": 6e-07, "cache_read_input_token_cost": 3e-09, "windows": [...]},
  "source": "https://api-docs.deepseek.com/quick_start/pricing",
  "supports_prompt_caching": true, "supports_function_calling": true
}
```

両モデルとも一次情報の価格ページと数値が一致していた（直接取得で相互確認済み）。`deepseek/deepseek-flash` のみ `off_peak_pricing` フィールドと曜日/時間帯の `windows` を持ち、LiteLLM のコスト計算がオフピーク割引を自動適用する。`zai/glm-5.3` にはそのフィールドがなく、**LiteLLM のコスト追跡上も GLM-5.3 の pay-as-you-go 価格はピーク/オフピークの区別をしない**（Coding Plan のクレジット割引とは別物）。

---

## 2. ベンチマーク

### Artificial Analysis Intelligence Index（独立測定、直接取得: HTML に埋め込まれた SSR JSON を正規表現で直接抜き出し）

URL: https://artificialanalysis.ai/models/glm-5-3 / https://artificialanalysis.ai/models/deepseek-v4-1-flash

直接取得した生 JSON 文字列:

> `{"label":"GLM-5.3 (max)","artificialAnalysisIntelligenceIndex":44.777392385614,"detailsUrl":"/models/glm-5-3"}`
> `{"label":"DeepSeek V4.1 Flash (max)","artificialAnalysisIntelligenceIndex":39.456167472527,"detailsUrl":"/models/deepseek-v4-1-flash"}`

| 指標（すべて独立測定・Reasoning/Max Effort） | GLM-5.3 (max) | DeepSeek V4.1 Flash (max) |
|---|---|---|
| Intelligence Index | 44.78 | 39.46 |
| Median Output Speed (tok/s) | 60.69 | 226.56 |
| Cost per Intelligence Index task | $2.01 | $0.27 |
| TTFT | 3.41s | 1.08s |

TTFT の verbatim（直接取得、GLM-5.3 側ページ本文）:

> "GLM-5.3 (max) has a time to first token (TTFT) of 3.41s (based on Z AI's API), which is at the higher end compared to other open weight models of similar size (median: 2.32s)."

DeepSeek 側（直接取得、deepseek-v4-1-flash ページ本文）:

> "DeepSeek V4.1 Flash (Reasoning, Max Effort) has a time to first token (TTFT) of 1.08s (based on DeepSeek's API), which is very competitive compared to other open weight models of similar size (median: 2.32s)."

つまり品質指標（Intelligence Index）は GLM-5.3 が優位（44.78 対 39.46）だが、出力速度は DeepSeek Flash が約 3.7倍速く、TTFT は約 3.2倍速く、Intelligence Index タスクあたりのコストは DeepSeek Flash が約 1/7.4。エージェント実行における「待ち時間」と「1タスクあたりの実コスト」の両方で DeepSeek Flash が優位という独立測定結果である。なお [unverified] として、この Intelligence Index はコーディング専用の指標ではなく複数タスクの合成指数であること（SciCode 等のコーディング系タスクを含む混合指数）は明記しておく。

### コーディング/エージェント系ベンチマーク（ベンダー発表、Z.ai 公式）

URL: https://docs.z.ai/guides/llm/glm-5.3 （`.md` 直接取得）

verbatim:

> "GLM-5.3 improves from 4.6 to 28.3 on Terminal-Bench 3.0, from 46.2 to 66.9 on DeepSWE v1.1, and from 23.8 to 28.5 on Agents' Last Exam."

> "At Max effort, GLM-5.3 reaches 34.5% at roughly 75K output tokens per task, compared with 23.4% at 96K for GLM-5.2. ... At High effort, GLM-5.3 reaches 31.4% at around 50K output tokens, surpassing Claude Opus 4.8 at 29.5% with 120K. GLM-5.3 remains behind Claude Fable 5, which reaches 39.5% at Max effort."

この最後の一文はベンダー自身が「Claude Fable 5 にはまだ及ばない」と明記している点で重要（ベンダー発表の中の否定的自認）。また、この比較は Z.ai 独自の非公開ベンチマーク「Z.ai Code Bench」上の数値であり、外部で再現・検証されたものではない。

DeepSeek 側は本節で確認した一次資料の中に、`deepseek-flash`（V4.1-Flash）自体のコーディング/エージェント系ベンチマーク数値（SWE-bench・Terminal-Bench 等）を明記したベンダー公式ページを**発見できなかった**（API pricing ページはベンチマーク数値を含まない）。DeepSeek のモデルカード相当のベンチマーク公表は今回の直接取得の範囲外だった（下記5章に記載）。

### SWE-bench Verified / Aider polyglot / τ²-bench（未発見・欠測）

- SWE-bench Verified: GLM-5.3 単体のスコアを掲載した一次または準一次のリーダーボードは**見つからなかった**（要約経由の WebSearch で「GLM-5.3 has no SWE-bench Pro entry on either board」という記述のみ得られたが、これ自体要約経由であり数値の直接確認はできていない）。
- Aider polyglot leaderboard（https://aider.chat/docs/leaderboards/ 、直接取得）を文字列検索したが `"GLM-5.3"` `"GLM-5.2"` は本文中に**存在しなかった**（`grep` で `-1`、未掲載を直接確認）。DeepSeek は掲載あり（`"DeepSeek"` が本文中に見つかった）が、`deepseek-flash`（V4.1-Flash）個別の掲載行は本調査では特定できていない。
- τ²-bench / tool-calling: GLM-5.3 個別の公表スコアは**見つからなかった**。要約経由の検索で GLM-4.5 の TAU-Retail 79.7 / TAU-Airline 60.4 という数値が言及されたが、これは GLM-5.3 ではなく旧世代モデルの数値であり、GLM-5.3 のツール呼び出しベンチマークとしては使えない。

### 実践者による直接比較（実践者レンズ、名前の付いた個人）

Simon Willison（simonwillison.net）の記事検索: `GLM-5.3` は 0 件（直接取得で確認、"No results found"）。`deepseek flash` は 23 件ヒットし、うち関連する一次記事:

URL: https://simonwillison.net/2026/Apr/24/deepseek-v4/ （要約経由 WebFetch）

> "DeepSeek-V4-Flash is the cheapest of the small models, beating even OpenAI's GPT-5.4 Nano."（要約経由の引用のため verbatim の完全性は未保証）

この記事は 2026年4月のプレビュー版（`DeepSeek-V4-Flash`）についてのものであり、9月時点の `deepseek-flash`（V4.1-Flash、9月10日リブランド）と厳密には別モデルである点に注意。**GLM-5.3 について、名前の付いた著名な個人実践者（Simon Willison級）の直接比較記事は見つからなかった**。見つかった「レビュー」記事の大半は無名または法人名義のSEOアグリゲータ（daily.dev 掲載記事も著者名の記載なし）であり、実践者レンズの基準（「名前の付いた、著名な実践者」）を満たさない。

コミュニティ側の実測に近い情報として、daily.dev 掲載記事（著者不明、要約経由）が「Independent testing revealed... GLM-5.3 used fewer tokens than GLM-5.2 on 5 of the 8 tasks... but on 3 tasks it used substantially more, including more than 3x on the CSV-parsing task」と述べているが、著者が特定できないため実践者レンズの一次資料としては弱い（**参考情報**にとどめる）。

---

## 3. 運用面

### エンドポイント / LiteLLM 対応

| | DeepSeek Flash | GLM-5.3 |
|---|---|---|
| OpenAI互換エンドポイント | `https://api.deepseek.com` | `https://api.z.ai/api/paas/v4`（pay-as-you-go）/ `https://api.z.ai/api/coding/paas/v4`（Coding Plan 専用） |
| Anthropic互換エンドポイント | `https://api.deepseek.com/anthropic` | `https://api.z.ai/api/anthropic`（**Coding Plan 契約歴があると使えなくなる場合がある**、後述） |
| LiteLLM provider prefix | `deepseek/` | `zai/` |
| Context window | 1,000,000トークン（LiteLLM実測値） | 1,000,000トークン |
| Max output | 384K（384×1024=393,216、ベンダーページ表記 "MAXIMUM: 384K"） | 128,000トークン |
| Tool calling | ✓（`supports_function_calling: true`、`supports_parallel_function_calling: true`） | ✓（`supports_function_calling: true`） |
| JSON/構造化出力 | `supports_response_schema: true` | **下記「否定的証拠」参照 — LiteLLM側で response_format が実質使えないバグが未解決** |
| プロンプトキャッシュ | 自動（ディスクへの自動プレフィックスキャッシュ、コード変更不要）。LiteLLM上 `supports_prompt_caching: true` | 自動識別（Z.ai公式ドキュメント: "Automatic Cache Recognition: Implicit caching that intelligently identifies repeated context content without manual configuration"）。LiteLLM上 `supports_prompt_caching: true` |

出典: https://docs.litellm.ai/docs/providers/deepseek （直接取得）、https://docs.litellm.ai/docs/providers/zai （直接取得）、https://docs.z.ai/guides/capabilities/cache （`.md` 直接取得）。

**LiteLLM の zai provider ドキュメントページ自体は古い**: 直接取得した https://docs.litellm.ai/docs/providers/zai の「Supported Models」表には `glm-4.7` までしか載っておらず、`glm-5.x` 系は一覧にない。一方、実際にランタイムで使われる `model_prices_and_context_window.json`（GitHub `main` ブランチ）には `zai/glm-5.3` と `zai/glm-5.3-flash` が既に存在する（1章のJSON抜粋を参照）。つまり**動作は先行しているがドキュメントページが追いついていない状態**であり、ドキュメントだけを見て「GLM-5.3 は未対応」と誤判断するリスクがある。

### Coding Plan と pay-as-you-go のエンドポイント混在に関する注意（GLM-5.3固有）

GLM-5.3 のモデルカード（https://docs.z.ai/guides/llm/glm-5.3 、直接取得）に次の注記がある:

> "If you have previously subscribed to a GLM Coding Plan, including an expired subscription, you can currently access the model API only through the OpenAI Chat Completion-compatible protocol. We will continue to improve and optimize this in upcoming iterations."

つまり、同じ Z.ai アカウントで一度でも GLM Coding Plan に契約した(失効後も含む)場合、その API キーは Anthropic 互換プロトコルや OpenAI Responses プロトコルを使えなくなり、OpenAI Chat Completions のみに制限される。LiteLLM を pi/DSH/omp 共通の `main` tier として運用する場合、この副作用を踏まえてアカウント/キーを分離するかを事前に決めておく必要がある。

### レート制限・同時実行数

DeepSeek: Concurrency Limit `deepseek-flash` = 2500、`deepseek-v4-pro` = 500（1章の直接取得データ）。

GLM Coding Plan: 同時実行数の推奨はプラン依存（https://docs.z.ai/devpack/usage-policy 、直接取得）:

> "Lite: Recommended for developing a single project at a time" / "Pro: Recommended for developing 1–2 projects simultaneously" / "Max: Recommended for developing 2 or more projects simultaneously"

pay-as-you-go の GLM-5.3 API キー自体のレート制限数値は、今回直接取得したページには明記されていなかった（[unverified]）。

### データポリシー・リージョン

Z.ai（直接取得、プライバシーポリシー https://docs.z.ai/legal-agreement/privacy-policy.md ）:

> "The Services are provided and controlled by JINGSHENG HENGXING TECHNOLOGY PTE.LTD with its registered address in ... SINGAPORE"
> "We generally provide the Services from Singapore, and our group companies and their designated service providers are typically located in Singapore."
> "The Company do not store any of the content the Customer or its End Users provide or generate while using our Services. ... This information is processed in real-time to provide the ... API Service and is not saved on our servers."

同ポリシーには「学習に使う」旨の一般条項も別途あり:

> "Public Information. We may obtain publicly available information via the Internet sources in order to train our models and provide services."

（この条項は「公開情報」に関するものでAPI入力そのものの学習利用を明言してはいないが、モデル学習方針全体としての透明性は限定的）。

DeepSeek（要約経由 WebSearch、複数出典の合成のため verbatim 引用なし）: 運営主体は Hangzhou DeepSeek Artificial Intelligence Co., Ltd.（中国）、データは中国国内で処理・保管され、既定でモデル改善の学習に利用される（EUユーザーにはオプトアウトの権利がある、と要約されている）。

第三者による監査的指摘（実態レンズ、GitHub issue、直接取得）:

URL: https://github.com/anomalyco/opencode/issues/50357 （open, 作成 2026-09-21）

> "The official Go privacy table (`docs/go#privacy`) lists GLM-5.3-Flash / GLM-5.3 / GLM-5.2 / GLM-5.1 as **'Model training: Not used, Data retention: 0 days'** with no footnote or mechanism disclosure. However, the upstream vendor's (Zhipu AI / Z.ai) default API terms document that user data may be used for model training (anonymized channel, no opt-out for individual users)... Compare with the same table: DeepSeek V4.* → `Not used` / `0 days*`, with a footnote: *'ZDR agreement is renewed monthly. The current agreement is valid through September 30, 2026.'* — i.e., a documented, verifiable mechanism."

つまり同じ「opencode」プロジェクトの一次情報整理において、DeepSeek 側は検証可能な ZDR（Zero Data Retention）契約の期限付き裏付けがあるのに対し、GLM 側の「学習に使わない・保持0日」という主張は裏付けとなる契約文言が確認できていない、という第三者の指摘である。

---

## 4. 否定的証拠

### LiteLLM 側の未解決バグ: response_format が黒くドロップされる（直接取得、open issue）

URL: https://github.com/BerriAI/litellm/issues/37720 （open, 作成 2026-08-20）

> "The `zai` provider silently discards `response_format`, so any client asking a GLM model for JSON schema output gets free-form prose back while litellm reports success. With `drop_params: true` the parameter is dropped silently; with it off the call fails with `UnsupportedParamsError`... The quiet variant is the harmful one. The proxy returns HTTP 200 and the breakage only surfaces downstream when something tries to parse the body."

> "Calling `https://api.z.ai/api/coding/paas/v4/chat/completions` directly, with litellm entirely out of the path, shows Z.AI ignores `response_format: json_schema`: glm-4.7 returned prose, glm-5.2 and glm-5.3 returned markdown tables... Z.AI does however honour forced tool calls, returning schema-valid arguments on glm-5.3 and glm-5-turbo."

これは LiteLLM のバグであると同時に、報告者自身が litellm を経由せず Z.ai の API を直接叩いて再現したと明記しており、**Z.ai の API 自体が GLM-5.3 で `response_format: json_schema` を無視する**という一次的な弱点でもある。回避策は forced tool call を使うことで、Z.ai 側もそちらは仕様どおり機能すると報告されている。JSON mode を直接使う設計のツールは要注意。

### LiteLLM 側のモデル名不整合（直接取得、open issue）

URL: https://github.com/BerriAI/litellm/issues/32218 （open, 作成 2026-07-06）

> "Z.AI's Coding Plan docs say to use `glm-5.2[1m]` for 1M context on `https://api.z.ai/api/coding/paas/v4`. In practice, LiteLLM Proxy returns: `litellm.BadRequestError: ZaiException - Unknown Model...`"

Coding Plan のドキュメントに書かれたモデル名のサフィックスが LiteLLM プロキシ経由では通らない、というドキュメントと実装のズレ。GLM-5.3 系でも同種の命名不整合が起きる可能性は排除できない。

### GLM-5.2（前バージョン）での実際の大規模レート制限障害（直接取得、GitHub issue + 実コメント）

URL: https://github.com/zai-org/GLM-5/issues/83 （closed, 作成 2026-06-17、コメント15件）

> "GLM-5.2 API has been effectively **unavailable for large portions of the past 3 days** due to rate limiting. This is a production-blocking issue affecting paid users. ... 285 × HTTP 429 errors... Failure rate: ~50% of all requests... Error: `429 该模型当前访问量过大，请您稍后再试`"

> "Account type: Paid GLM Coding Plan (via ZhipuAI API)"

その後のコメント（複数の別ユーザー、直接取得）:

> "This is still really bad - 429's for most of the day every day. does anyone know if s.ai are working on this issue?  I paid for a Max plan but cannot use it" (JasonAiassist, 2026-06-23)
> "I went with a Pro plan, then upgraded to Max and it's the same issue... Rate Limits clearly says: GLM-5.2 concurrency 10 -- is it 10 for all the users ffs?" (iRonin, 2026-06-23)
> "Hitting 429 often with Hermes. Never had a problem with Claude Code. Z.ai say on their home page that general purpose agent systemts (like OpenClaw or Hermes) are more prone to 429 errors, especially during peak hours" (HakonJK, 2026-07-03)
> "I am having similar problems, always hitting the limits. Never had this problem before... I still have a few months before my plan expires, if it continues like this I don't think I am going to renew it." (vonpupp, 2026-09-14 — issue のクローズ後もなお発生している最新報告)

このissueは GLM-5.2 に対するものだが、（a）2026年9月14日という **本調査時点に近い日付でも同種の苦情が継続している**こと、（b）Z.ai 自身が「非公式・汎用エージェント経由（OpenClaw/Hermes等）は特にレート制限に弱い」と認めている（コメント中に引用されたリンク先: https://docs.z.ai/devpack/tool/others#step-1-supported-tools ）ことから、**サポート対象外のツール経由（DSH/omp相当）で GLM Coding Plan やその API を使う場合のレート制限リスクは、ベンダー自身も認める既知の弱点**である。

### GLM-5.3 は推論を無効化できない（直接取得、モデルカード）

URL: https://docs.z.ai/guides/llm/glm-5.3 （`.md` 直接取得）

> "GLM-5.3 always operates with reasoning enabled ... Disabling reasoning is no longer supported."
> "Migration Notice: If your application currently uses `thinking.type: 'disabled'`, please change it to `enabled` and set `reasoning_effort` to `low` before updating the model ID to `glm-5.3`. Otherwise, the request will fail."

`main` tier は「日常的なコーディング」用途であり、単純なファイル編集やリファクタリングのような低レイテンシが求められる呼び出しでも、GLM-5.3 は常に reasoning が有効になる（最小でも `low`）。Artificial Analysis の TTFT 3.41秒（2章）はこの制約と整合的であり、DeepSeek Flash（TTFT 1.08秒）と比べてエージェントループの1ターンあたりの遅延が構造的に大きくなる。

### DeepSeek 側のレート制限に関する過去の不満（要約経由 + 直接取得）

URL: https://github.com/deepseek-ai/DeepSeek-V3/issues/1374 （closed, 作成 2026-05-29）

> "I would like to submit a feature request regarding the excessively strict rate limits for the **deepseek-v4-pro** (and deepseek-v4-flash) models as of May 2026. I regularly encounter the error 'Rate limit exceeded' (or HTTP 429), which makes it impossible to work properly."

同issueは3件のコメントで closed（要約経由の検索では、opencode側の別issueでも「DeepSeek V4.1 Flash is down」「session throttles after ~13 minutes」といった報告が複数の日付で見られたが、これらは opencode 独自のサブスクリプション経路の問題である可能性が高く、DeepSeek の生API問題との区別が要約経由の情報だけでは切り分けられていない。**[unverified]**）。

### GLM Coding Plan のツール制限は DSH/omp を公式にカバーしない（3章・1章と同じ一次情報の再掲）

https://docs.z.ai/devpack/usage-policy （直接取得）が明記する「サポート対象ツール外での使用は利益制限の対象になり得る」というルールと、サポート対象ツール一覧（https://docs.z.ai/devpack/tool/others ）に DSH/omp が存在しないことを踏まえると、**GLM Coding Plan のサブスクリプション（割引後の実質価格）を根拠に GLM-5.3 のコストを評価するのは、DSH/omp では成立しない**。pay-as-you-go 価格（1章）で評価する必要がある。

### エマージェントなサイバー能力（ベンダー自身が明記する副作用、直接取得）

> "As the scale of post-training continues to expand, the model's cybersecurity capabilities have improved at a rate that exceeds expectations. GLM-5.3 achieves the best performance to date on the CyberGym vulnerability discovery benchmark. ... the model identified 2,436 vulnerabilities across 269 projects, including 1,097 medium-to-high severity issues."

これはコーディングエージェント適性そのものへの直接的な負の証拠ではないが、モデルの脆弱性発見・攻略能力が意図せず急伸したとベンダー自身が述べている点は、社内コードベースを扱わせる際のデータガバナンス上の検討材料として記録しておく。

---

## 5. 検証できなかったこと

- GLM-5.3 の SWE-bench Verified 個別スコア（一次・準一次リーダーボードいずれにも見当たらず、要約経由の情報のみ）。
- GLM-5.3 の τ²-bench / BFCL（tool-calling系ベンチマーク）個別スコア。
- LMArena WebDev/Coding リーダーボードでの両モデルの順位（`lmarena.ai/leaderboard/webdev` は 301 リダイレクト + JS レンダリングのため到達不能）。
- OpenRouter 上の使用量ランキング上の両モデルの相対順位（ページ自体は取得できたが、ランキング表の該当行を数値付きで抜き出す時間的余裕がなく未実施）。
- GLM Coding Plan の Lite/Pro/Max 月額 $ 金額の一次確認（`z.ai/subscribe` が JS レンダリングで到達不能、第三者アグリゲータ間で $18/$72/$160 〜 $18/$80/$168 〜 $10/$30/$80 まで不一致）。
- bigmodel.cn（中国国内エンドポイント）の価格・データポリシー（今回は z.ai 国際エンドポイントのみを調査対象とした）。
- DeepSeek 側の `deepseek-flash` 単体のベンダー公式ベンチマーク数値（SWE-bench/Terminal-Bench等）を明記した一次資料。
- GitHub 上のコード検索による実際の採用件数（`gh api search/code` は認証が必要で本サンドボックスでは不可、`gh` CLI 自体もTLS証明書エラーで使用不能だったため、"in the wild" の採用規模は星数・issue活性度の代理指標にとどまる）。
- 著名な個人実践者（Simon Willison級）による GLM-5.3 と DeepSeek Flash の直接的なエージェント使用比較記事（GLM-5.3 について該当なし。DeepSeek側もV4.1-Flash個別ではなく2026年4月のV4プレビュー記事のみ）。
- GLM-5.3 pay-as-you-go API キー単体（Coding Plan非契約）のレート制限の具体数値。

---

## 6. 結論の材料

### コスト比較（1M入力トークン、キャッシュヒット率80% + 出力10万トークンという想定セッション形状、pay-as-you-go・国際エンドポイント）

| モデル | Input miss (20万tok) | Input hit (80万tok) | Output (10万tok) | セッション合計 |
|---|---|---|---|---|
| DeepSeek Flash（オフピーク） | $0.030 | $0.0024 | $0.060 | **$0.0924** |
| DeepSeek Flash（ピーク） | $0.060 | $0.0048 | $0.120 | **$0.1848** |
| GLM-5.3-Flash | $0.030 | $0.024 | $0.050 | **$0.104** |
| GLM-5.3 | $0.280 | $0.208 | $0.440 | **$0.928** |

（内訳は1章の一次情報の単価をそのまま乗算。GLM側はピーク/オフピークの区別なし。）

同じ想定セッションで比べると、フラッグシップの GLM-5.3 は DeepSeek Flash の約5倍（ピーク比）〜10倍（オフピーク比）のコストになる。廉価版の GLM-5.3-Flash はほぼ同水準（DeepSeek Flashのピーク価格よりわずかに安いが、オフピーク価格より約13%高い）。

### 品質・速度比較（Artificial Analysis、独立測定、2章）

| 指標 | GLM-5.3 (max) | DeepSeek Flash (max) |
|---|---|---|
| Intelligence Index | 44.78（高い） | 39.46 |
| 出力速度 | 60.69 tok/s | 226.56 tok/s（約3.7倍速い） |
| TTFT | 3.41s | 1.08s（約3.2倍速い） |
| Intelligence Indexタスクあたりコスト | $2.01 | $0.27（約7.4倍安い） |

### 一段落の評価

数字だけを並べると、GLM-5.3 は合成知能指標では DeepSeek Flash に対して優位（44.78 対 39.46）だが、その優位性は独立測定上「タスクあたり約7.4倍のコスト」と「TTFT約3.2倍・出力速度約1/3.7」という代償を伴う。フラッグシップの GLM-5.3 はエージェントの日常呼び出し用としては割高で遅く、廉価版の GLM-5.3-Flash はコストではDeepSeek Flashとほぼ同水準まで下がるが、Z.ai自身のベンチマーク発表でもGLM-5.3（フラッグシップ）が「Claude Fable 5にはまだ届かない」と認めている水準であり、Flash版の相対的な知能指標は本調査では未確認。運用面では、LiteLLMの`zai`プロバイダに構造化出力(`response_format`)が事実上機能しないという未解決の公開issueがあり、Z.ai自身のAPIもJSON schema出力を無視するとその報告者が直接検証している。GLM Coding Plan（サブスクリプション）はpiでは公式サポート対象だがDSH/omp は対象外で、対象外ツールでの利用は過去に実際の大規模レート制限インシデント（GLM-5.2、2026年6月、9月14日時点でも継続報告あり）を招いている。以上を踏まえた採否判断は、価格・速度・構造化出力の要否・サブスクリプション対象範囲のどれを優先するかという設計判断であり、本記録はその材料を提示するのみで決定は行わない。

