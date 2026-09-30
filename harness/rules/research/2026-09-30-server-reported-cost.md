# LiteLLM のサーバー計算費用を pi / omp がそのまま表示できるか — 事実調査

調査日: 2026-09-30
固定版: LiteLLM `v1.103.0-rc.1` (commit `ccf5e8c93af3a70fb5e5b8bfc67321ba340eaabd`) / pi `v0.87.1` (commit `f07218c4d4bbc12bef056a7058c3dd49dfe41abe`) / omp `v18.3.4` (commit `dff728c572a8c4c29016549b6e407c4550fcdac6`)

推奨は書かない。事実のみ。

---

## 1. LiteLLM: ストリーミング応答への費用の入れ方

### 1-1. 設定フラグ `include_cost_in_streaming_usage`

- モジュール既定値: `litellm/__init__.py:369`
  ```
  include_cost_in_streaming_usage: bool = False
  ```
  既定は無効。URL: https://raw.githubusercontent.com/BerriAI/litellm/v1.103.0-rc.1/litellm/__init__.py (369行目)

- `litellm_settings:` 配下の任意キーは `litellm.<key> = value` に総称マッピングされる（`include_cost_in_streaming_usage` 専用の特別扱いは無い＝汎用の `else` 分岐を通る）:
  `litellm/proxy/proxy_server.py:6117-6128`
  ```python
  else:
      verbose_proxy_logger.debug(...)
      setattr(litellm, key, value)
  ```
  URL: https://raw.githubusercontent.com/BerriAI/litellm/v1.103.0-rc.1/litellm/proxy/proxy_server.py
  → つまり `config.yaml` に `litellm_settings: {include_cost_in_streaming_usage: true}` と書けば有効化できる（設定場所は `litellm_settings`、環境変数版は確認できなかった＝not found）。

- フラグの読み出し箇所（ストリーミング生成のホットパス判定）: `litellm/proxy/common_request_processing.py:3790-3792`
  ```python
  cost_injection_enabled: Final = bool(getattr(litellm, "include_cost_in_streaming_usage", False))
  fast_path = not caps.has_streaming_chunk_override and not caps.has_guardrail and not cost_injection_enabled
  ```

### 1-2. 入る場所とフィールド名: `usage.cost`（float）

- チャンクへの注入呼び出し: `litellm/proxy/common_request_processing.py:3826-3831`
  ```python
  model_name = request_data.get("model", "")
  chunk = ProxyBaseLLMRequestProcessing._process_chunk_with_cost_injection(
      chunk, model_name, request_data.get("litellm_logging_obj")
  )
  ```
- ゲート: `litellm/proxy/common_request_processing.py:3966-3968`
  ```python
  if not getattr(litellm, "include_cost_in_streaming_usage", False):
      return chunk
  ```
- 実際のフィールド注入: `litellm/proxy/common_request_processing.py:4121-4149` (`_inject_cost_into_usage_dict`)
  ```python
  usage: Final = obj.get("usage")
  if not isinstance(usage, dict):
      return None
  stream_usage: Final = ProxyBaseLLMRequestProcessing._stream_usage_for_event(obj, usage)
  ...
  cost_val: Final = ProxyBaseLLMRequestProcessing._streamed_usage_cost(...)
  if cost_val is None:
      return None
  return {**obj, "usage": {**usage, "cost": cost_val}}
  ```
  → フィールド名は **`usage.cost`**（`usage.response_cost` ではない）。OpenAI 互換の `chat.completion.chunk`（`stream_options.include_usage: true` で送られる最終 usage チャンク）と Anthropic `message_delta` の両方が対象（`_stream_usage_for_event`, `litellm/proxy/common_request_processing.py:4055-4062`）。

- v1.103.0-rc.1 で使えるか: 使える。上記コードは v1.103.0-rc.1 タグの実ファイルから直接確認した一次情報。

### 1-3. 非ストリーミングの `x-litellm-response-cost` ヘッダとストリーミングとの違い

- ベンダードキュメント（Docusaurus 静的HTML を直接取得・テキスト抽出）:
  https://docs.litellm.ai/docs/proxy/response_headers
  > "Header Type Description Available on Pass-Through Endpoints x-litellm-response-cost float Cost of the API call ... The component headers sum to the total: input + cache read + cache creation + output + tool usage = x-litellm-response-cost . ... the cache and reasoning headers appear only when those costs are nonzero, and component headers appear on non-streaming responses only"
  （直接取得したHTMLをスクリプトでテキスト化したもの。原文はHTML内のプレーンテキストで、要約サマライザは通していない。）

- ソースでの裏付け: **非ストリーミング**応答では、応答本体を受け取り終えた **後** に費用ヘッダを同期計算してセットしている。
  `litellm/proxy/common_request_processing.py:2818-2860`
  ```python
  recover_response_cost: Final = not response_cost and hidden_params.get("response_cost") is None
  computed_cost_for_headers: Final = (...)
  ...
  fastapi_response.headers.update(
      ProxyBaseLLMRequestProcessing.get_custom_headers(
          ...,
          response_cost=response_cost_for_headers,
          ...
      )
  )
  ```
  この行に到達するのは非ストリーミング分岐のみ（ストリーミング分岐は手前で `return StreamingResponse(...)` して抜けている、同ファイル 2573-2596行）。

- **ストリーミング**応答のヘッダは、応答生成器がまだ消費されていない時点（＝トークン数・費用が未確定な時点）で構築される。
  `litellm/proxy/common_request_processing.py:2586-2592`
  ```python
  custom_headers: Final = self._stream_response_headers(
      hidden_params=hidden_params,
      user_api_key_dict=user_api_key_dict,
      logging_obj=logging_obj,
      version=version,
      callback_headers=stream_callback_headers or MappingProxyType({}),
  )
  ```
  `_stream_response_headers` 自体（`litellm/proxy/common_request_processing.py:2281-2309`）は `hidden_params.get("response_cost") or ""` をそのまま渡す。この時点の `hidden_params` はストリーム開始直後のものなので、完了後の実費用は入っていない。
  → **`x-litellm-response-cost` ヘッダは非ストリーミング応答でのみ最終費用を持つ。ストリーミング応答のヘッダには最終費用は乗らない**（HTTPヘッダはボディより先に送出されるため、構造上不可能）。`response_headers` ドキュメントの「component headers appear on non-streaming responses only」という一文は、内訳ヘッダに限定した記述であり、主ヘッダ自体がストリーミングで空になる点はドキュメントに明記されていない＝[unverified: ドキュメント上の明示なし、ソースから推論]。

- `_hidden_params` との関係: `additional_headers` に `llm_provider-x-litellm-response-cost` として伝播されるのは **OpenRouter だけ**に限定されたプロバイダ報告コストの伝播経路であり、LiteLLM自身の価格表計算とは別系統。
  `litellm/litellm_core_utils/streaming_handler.py:58`
  ```python
  _USAGE_COST_HEADER_PROVIDERS: Final[frozenset[str]] = frozenset({LlmProviders.OPENROUTER.value})
  ```
  `litellm/litellm_core_utils/streaming_handler.py:1748-1759` (`_propagate_usage_cost_to_hidden_params`)
  ```python
  if custom_llm_provider not in _USAGE_COST_HEADER_PROVIDERS:
      return
  ...
  response._hidden_params["additional_headers"]["llm_provider-x-litellm-response-cost"] = _cost
  ```
  → これは「上流(OpenRouter)がusage.costとして返してきた額」をヘッダへ転記する経路であり、`include_cost_in_streaming_usage` によるLiteLLM自身の価格表計算（1-2節）とは別物。

### 結論（1について）

- ストリーミングで LiteLLM 自身の価格表による最終費用を受け取る唯一の経路は `litellm_settings.include_cost_in_streaming_usage: true` によって最終 usage チャンクの **`usage.cost`** に注入される値であり、v1.103.0-rc.1 のソースで直接確認できた。
- `x-litellm-response-cost` ヘッダはストリーミングでは実質使えない（非ストリーミング専用と読める）。

---

## 2. omp: `usage.cost` を読むか

### 2-1. ドキュメントの記述

`docs/models.md` (omp v18.3.4):
URL: https://raw.githubusercontent.com/can1357/oh-my-pi/v18.3.4/docs/models.md (235-251行目)
> "OMP estimates token costs from the selected provider/model's catalog pricing, preferring server-reported monetary costs when available. Completed messages retain their recorded costs: crossing a pricing boundary, switching models, or reopening a session does not reprice accumulated usage."

> "Discovered proxy and gateway models are the opposite case: their pricing is provider-specific and rarely matches the bundled catalog, so discovery keeps them at a local-unknown zero cost and no tariff applies to them."

### 2-2. ソースでの実装 — 決定的な制約

`packages/ai/src/providers/openai-completions.ts:2052-2056`
```ts
const usage: AssistantMessage["usage"] = {
    ...accounting,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...(premiumRequests !== undefined ? { premiumRequests } : {}),
};
calculateCost(model, usage, timestamp);
applyProviderReportedCost(model, usage, rawUsage);
return usage;
```
（この関数は `parseChunkUsage`、ストリーミングチャンクの usage をパースするたびに呼ばれる。`packages/ai/src/providers/openai-completions.ts:2008`）

`applyProviderReportedCost` の実体: `packages/ai/src/providers/openai-shared.ts:405-425`
```ts
export function applyProviderReportedCost(model: Pick<Model, "provider">, usage: Usage, rawUsage: unknown): void {
	if (
		(model.provider !== "openrouter" && model.provider !== "cline-pass") ||
		typeof rawUsage !== "object" ||
		rawUsage === null
	)
		return;
	const reportedCost = Reflect.get(rawUsage, "cost");
	if (typeof reportedCost !== "number" || !Number.isFinite(reportedCost) || reportedCost < 0) return;
	...
	usage.cost.total = reportedCost;
}
```
URL: https://raw.githubusercontent.com/can1357/oh-my-pi/v18.3.4/packages/ai/src/providers/openai-shared.ts

**この関数は `model.provider` が文字列として厳密に `"openrouter"` または `"cline-pass"` のときにしか `rawUsage` の `cost` フィールドを読まない。それ以外の provider 名（本件の LiteLLM カスタムプロバイダ `"proxy"` を含む）では、関数の先頭で即 return し、`rawUsage.cost`（＝LiteLLM が `include_cost_in_streaming_usage` で注入した `usage.cost`）は一切参照されない。**

Responses API 経路でも同じ関数が同じ制約で呼ばれている: `packages/ai/src/providers/openai-shared.ts:3501`
```ts
applyProviderReportedCost(model, output.usage, response?.usage);
```

### 結論（2について）

- omp のドキュメントは「サーバー報告コストを優先する」と一般的に書いているが、実装は provider 識別子のホワイトリスト（`openrouter`, `cline-pass` の2つのみ）でゲートされており、カスタム LiteLLM プロキシ provider（例: `"proxy"`）はこの経路の対象外。ドキュメントの一般的な記述と実装の限定が食い違っている。
- 加えてドキュメント自身が「discovered proxy and gateway models」は catalog 側でも `local-unknown zero cost` になると明記している（2-1節引用）ため、現状のコードのままでは `include_cost_in_streaming_usage` を有効にしても omp 側の費用表示は 0 のままになる、とソースから読み取れる。

---

## 3. pi: `usage.cost` を読むか／`message_end` フックで差し替えられるか

### 3-1. pi の `openai-completions.ts` に費用のサーバー報告読み取りは無い

`packages/ai/src/api/openai-completions.ts` 全文を `cost` でグレップした結果:
```
14:import { calculateCost, clampThinkingLevel } from "../models.ts";
320:				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
1548:		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
1550:	calculateCost(model, usage);
```
URL: https://raw.githubusercontent.com/earendil-works/pi/v0.87.1/packages/ai/src/api/openai-completions.ts

`calculateCost` の実装（`rawUsage` 相当の引数を受け取らない＝サーバー報告コストを読む経路が存在しない）:
`packages/ai/src/models.ts:900-920`
```ts
export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"] {
	const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	let rates: ModelCostRates = model.cost;
	...
	usage.cost.input = (rates.input / 1000000) * usage.input;
	usage.cost.output = (rates.output / 1000000) * usage.output;
	usage.cost.cacheRead = (rates.cacheRead / 1000000) * usage.cacheRead;
	usage.cost.cacheWrite = (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1000000;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}
```
URL: https://raw.githubusercontent.com/earendil-works/pi/v0.87.1/packages/ai/src/models.ts

→ pi はトークン数 × カタログ単価の計算しかせず、omp にある `applyProviderReportedCost` 相当の関数自体が存在しない（同名・類似名の関数は `openai-completions.ts` 全体にも `models.ts` にも見つからなかった）。単価がカタログに無いモデル（本件の LiteLLM `proxy` カスタムプロバイダ）では `model.cost` のレート自体が定義されない/ゼロになる可能性が高いが、その値をどう決めているかまでは追えていない（[unverified]、モデル定義ファイル側の調査は本調査の範囲外）。

### 3-2. 拡張から `usage.cost` を差し替える手段: `message_end` フックは存在する

`packages/coding-agent/src/core/extensions/types.ts`:
URL: https://raw.githubusercontent.com/earendil-works/pi/v0.87.1/packages/coding-agent/src/core/extensions/types.ts

イベント定義（876-878行目）:
```ts
/** Fired when a message ends */
export interface MessageEndEvent {
	type: "message_end";
	message: AgentMessage;
}
```

ハンドラ登録シグネチャ（1410行目）:
```ts
on(event: "message_end", handler: ExtensionHandler<MessageEndEvent, MessageEndEventResult>): () => void;
```

戻り値の型（1248-1251行目）:
```ts
export interface MessageEndEventResult {
	/** Replace the finalized message. The replacement must keep the original message role. */
	message?: AgentMessage;
}
```

→ `message_end` フックは存在し、ハンドラが確定済みメッセージ（`AgentMessage`、`usage.cost` を含む）を丸ごと差し替えて返せる（"Replace the finalized message"）。**ただし** これは pi が内部的に保持している `AgentMessage.usage` を上書きする手段であって、その拡張自身がサーバーの生の `usage.cost`（LiteLLM が注入した値）をどこから取得するかは別問題。`openai-completions.ts` のストリーミング処理は生の `usage` オブジェクトを `calculateCost` に渡す前に自前の `Usage` 型へ変換しており、`message_end` イベントの `AgentMessage` にサーバー生値が保持されている保証はソースから確認できなかった（[unverified]、拡張が独自にレスポンスを覗き見る経路が別途必要になる可能性がある）。

### 結論（3について）

- pi の `openai-completions.ts` はサーバー報告コストを読まない（コードに該当ロジックが無い、確認済み）。
- `message_end` フックはあり、確定メッセージの差し替えは可能（型定義で確認済み）。ただし「LiteLLM が注入した `usage.cost` を拡張が読める」保証はソース上で確認できていない＝追加検証が必要。

---

## 4. キャッシュ割引・DeepSeek 時間帯割引が LiteLLM の計算にどう入るか

### 4-1. ストリーミング注入コストは「ロギングコールバックと同じ計算」を再利用する

`litellm/proxy/common_request_processing.py:4114-4119` (`_streamed_usage_cost` のコメント)
```python
# Pricing via the logging object inherits the deployment's custom pricing, so the
# streamed cost matches what the logging callback records instead of sticker price
cost_from_logging_obj: Final = (
    ProxyBaseLLMRequestProcessing._logging_obj_cost_or_none(model_response, litellm_logging_obj)
    if litellm_logging_obj is not None
    else None
)
```
`_logging_obj_cost_or_none` は `litellm_logging_obj._response_cost_calculator(result=model_response)` を呼ぶ（同ファイル 4097行）。これは非ストリーミング応答・スペンドログ記録で使われているのと同じ計算器。

### 4-2. プロンプトキャッシュ割引は価格表に反映される

`model_prices_and_context_window.json` の `deepseek/deepseek-chat` エントリ:
URL: https://raw.githubusercontent.com/BerriAI/litellm/v1.103.0-rc.1/model_prices_and_context_window.json
```json
"deepseek/deepseek-chat": {
  "cache_read_input_token_cost": 2.8e-08,
  "input_cost_per_token": 2.8e-07,
  "input_cost_per_token_cache_hit": 2.8e-08,
  ...
}
```
DeepSeek 専用の cost calculator は汎用のキャッシュ対応計算器を呼んでいる:
`litellm/llms/deepseek/cost_calculator.py`
```python
def cost_per_token(model: str, usage: Usage) -> tuple[float, float]:
    return generic_cost_per_token(model=model, usage=usage, custom_llm_provider="deepseek")
```
URL: https://raw.githubusercontent.com/BerriAI/litellm/v1.103.0-rc.1/litellm/llms/deepseek/cost_calculator.py
→ キャッシュ読み取り分の単価差（`input_cost_per_token` の1/10）は価格表の静的フィールドとして反映されており、注入経路（4-1）でも同じ計算器を通るため反映される。

### 4-3. DeepSeek の「時間帯割引」は LiteLLM の価格表に存在しない

`model_prices_and_context_window.json` の `deepseek-chat` / `deepseek/deepseek-chat` エントリには時間帯・ピーク/オフピークを表すフィールドが無い（`cache_read_input_token_cost`, `input_cost_per_token`, `input_cost_per_token_cache_hit`, `output_cost_per_token` のみ、上記JSON引用参照）。`cost_calculator.py` にも時刻を参照するコードは無い（全文引用済み、4行のみの薄いラッパー）。
→ **DeepSeek の稼働時間帯による割引（UTC基準の半額時間帯）は LiteLLM の価格表・計算器のどちらにも実装が見当たらない**。LiteLLM が注入する `usage.cost` は常に固定単価（キャッシュ割引のみ反映）であり、DeepSeek 自身が実際に請求する時間帯割引後の金額とは一致しない可能性が高い（[推論: 価格表とコードにその機構が存在しないことから]）。

参考として、omp 自身は自前のカタログに時間帯価格を持っている（LiteLLM側とは独立、比較のための参考情報）:
`docs/models.md` (235-251行目)
> "Peak hours are Monday–Friday, 01:00–04:00 and 06:00–10:00 UTC (start inclusive, end exclusive). All other times, including weekends, cost 50% of peak rates."
→ この時間帯・料率は omp 独自のカタログ記述であり、LiteLLM側の計算とは別系統。両者が同じ時間帯割引ルールを共有している保証はない（比較していない、[not found: LiteLLM側にDeepSeek時間帯割引の一次情報なし]）。

---

## 確認できなかったこと

- `include_cost_in_streaming_usage` を環境変数から設定する方法（`os.environ/...` 形式の対応可否）は確認できなかった。`litellm_settings` 配下のYAML設定としての適用経路のみ確認した。
- LiteLLM の GitHub Code Search (`api.github.com/search/code`) は認証必須のため、`gh` 経由・`curl` 経由のいずれも到達不可（`gh` は TLS 検証エラー、`curl` は 401 Requires authentication）。そのため「他に `include_cost_in_streaming_usage` や `usage.cost` を参照している箇所が repo 全体に無いか」の網羅的検索はできておらず、今回引用したファイル群（`streaming_handler.py`, `common_request_processing.py`, `proxy_server.py`, `__init__.py`, `deepseek/cost_calculator.py`, `model_prices_and_context_window.json`）に限定した確認である。
- `docs.litellm.ai` に `include_cost_in_streaming_usage` を明示的に説明したページが見つからなかった（`docs/proxy/cost_tracking`, `docs/proxy/response_headers`, `docs/completion/usage`, `docs/completion/stream`, `docs/providers/openrouter` のテキストをすべて検索したが本文中にこの語は出現しない）。ソースコードでのみ確認できた設定であり、ドキュメント化されているかは不明。
- BerriAI/litellm リポジトリの `v1.103.0-rc.1` タグには `docs/my-website` ディレクトリが存在しなかった（トップレベルディレクトリ一覧で確認）。ドキュメントサイトのMarkdownソースは別リポジトリ/別ブランチで管理されている可能性があり、`docs.litellm.ai` のHTML経由でのみ確認した。
- pi の `calculateCost` がカタログに単価定義の無いモデル（LiteLLM `proxy` カスタムプロバイダ相当）に対してどう振る舞うか（0円になるのか、例外になるのか）はモデル定義ファイル群を追っておらず未確認。
- pi の `message_end` イベントの `AgentMessage.usage` に、サーバーが返した生の `usage.cost` 値がどこかの時点で保持されているかどうかは未確認（`openai-completions.ts` は生 `usage` を自前の `Usage` 型に変換する処理しか確認できなかった）。
- omp の `model.provider` が LiteLLM カスタムプロキシ設定でどの文字列値になるか（`"proxy"` と厳密に一致するか等）は omp 側の設定ドキュメント・実運用設定を直接確認しておらず、背景説明の記述をそのまま前提にしている。
