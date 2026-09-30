# エイリアス名モデルの「費用」をコピー価格表なしにどう出すか — 事実調査

調査日: 2026-09-30。前提となる既存記録（再調査していない）:
- [2026-09-30-server-reported-cost.md](2026-09-30-server-reported-cost.md) — LiteLLM `include_cost_in_streaming_usage` と `usage.cost`、omp の provider 名ゲート（`openrouter`/`cline-pass` のみ）、pi は読まない、`message_end` フックの存在、DeepSeek 時間帯割引が LiteLLM に無いこと。
- [2026-09-30-agent-table-conventions.md](2026-09-30-agent-table-conventions.md) — omp Agent Hub の COST 列（`$0.0000` 表示、`—` にしない）、Claude Code の costs ページ（ローカル単価表からの推定値と明記）。

固定版（今回追加で読んだリポジトリ）: LiteLLM `04fa760bf2a0`（2026-09-30 main）/ pi `e7a9bf7e9423`（2026-09-30 main）/ omp `2b023d1b8013`（2026-09-30 main）/ cline `3435f72fcf4c`（2026-09-30 main）/ aider `5dc9490bb35f`（2026-05-22、main）/ LibreChat はコミット SHA 取得が GitHub API のレート制限で失敗、2026-09-30 に `main` ブランチの raw ファイルを直読（コミット固定不能、日付のみで識別）。

方法の凡例: 「ソース直読」= `raw.githubusercontent.com` を `curl` で直接取得。「API 直読」= `api.github.com` を `curl` で直接取得（`gh` はこのセッションで keyring 認証エラーのため不可、`api.github.com` への無認証アクセスに切り替えた。`search/code` は無認証だと `401 Requires authentication` で不可、`search/issues` と repo 系エンドポイントは無認証で可、ただし core 60回/時・search 10回/分の制限に複数回到達した）。「要約フェッチ」= WebFetch（要約モデル経由）。今回は WebSearch がセッション予算を使い切っていたため（"used its web search budget (200 of 200)"）使えず、DuckDuckGo HTML 検索も CAPTCHA チャレンジで到達不能だった。grep.app は Vercel のチャレンジ画面で到達不能（前回記録と同じ症状の再確認）。sourcegraph.com のストリーム検索 API は到達できたが今回のクエリでは 0 件（対象コードが未インデックスの可能性、"届かなかった"に分類）。

---

## 結論（要約）

1. **ベンダー側の一致した設計原則は「費用はサーバー側で計算し、配線で運ぶ」であり、「クライアントが価格表を持つ」は推奨されていない。** LiteLLM の Python ライブラリ自体、`completion_cost()`/`cost_per_token()` は既定で `api.litellm.ai` から**価格表をライブ取得**する（要約フェッチ、[litellm.ai](https://docs.litellm.ai/docs/completion/token_usage)）。ファイアウォール環境向けの `LITELLM_LOCAL_MODEL_COST_MAP=True` はあくまで代替経路として案内され、「新しいモデルの価格を得るにはパッケージのアップグレードが要る」と明記される（同ページ）。つまり**ベンダー自身が「コピーした静的表」を劣化パスとして扱っている**。
2. **プロキシ越しのエイリアスモデルで実際に費用を配線で受け取る唯一の同期経路は、ストリーミング最終チャンクの `usage.cost`（`include_cost_in_streaming_usage`、既定オフ）であり、非ストリーミングの本文には未だ乗らない。** これを埋める Issue #41486・PR #41532 は 2026-09-17 提出、2026-09-30 時点でまだ **open**（未マージ）。Issue 本文は Langfuse（LLM-as-a-Judge/Playground、Vercel AI SDK 経由）を名指しし、「SDK 抽象を通すクライアントはヘッダーを捨てるので、ゲートウェイが計算済みの費用があっても毎回 $0 として記録される」と述べる。**これは pi/omp のような、AI SDK 的な抽象の上に立つハーネス全般に当てはまる構造的制約**（[BerriAI/litellm#41486](https://github.com/BerriAI/litellm/issues/41486)、API 直読）。
3. **プロキシの spend ログ（`/spend/logs`, `/user/daily/activity`, タグ）は正確だが同期ではない。** `LiteLLM_SpendLogs` への書き込みは `PROXY_BATCH_WRITE_AT`（既定 **10 秒**）＋ジッター（`random.randint(0, 5)` 秒）で**バッチ化**される（`litellm/constants.py:1789`, `litellm/proxy/proxy_server.py:10033`、ソース直読）。ソースコード内コメントも「エンティティの `.spend` はバッチごとにフラッシュされるので、直近のリクエストの費用を含まないことがある」と明記する（`proxy_server.py:2711` 付近）。**常駐 Swarm 一覧のような「今まさに動いている行」の費用表示にこの経路は使えない**（10〜15 秒遅れの事後集計にしか使えない）。
4. **`/model/info` は LiteLLM の価格表由来の `input_cost_per_token`/`output_cost_per_token` を返す実在のエンドポイントであり（`_enrich_model_info_with_litellm_data`、ソース直読）、「起動時に価格表だけ取得してクライアント側の静的テーブルを埋める」設計は技術的に可能。** ただし今回調べた範囲（pi, omp, cline, aider, LibreChat, OpenCode）で**このエンドポイントを実際に叩いている実装は見つからなかった**（"見つからない"であって「存在しない」の確認ではない。GitHub コード検索が無認証で使えず、網羅的な確認はできていない）。実際に採用されている「価格表を配りなおす」方式は、LiteLLM の `/model/info` ではなく models.dev という**第三者の共有カタログ**（cline, おそらく OpenCode も）か、LiteLLM python ライブラリ自身のライブ取得（aider が間接的に使う）だった。
5. **pi の拡張 API `registerProvider` はプログラム的（`session_start` 等のイベントハンドラから呼べる）なので、拡張コードが起動時に LiteLLM の `/model/info` を叩いて `cost` フィールドを動的に埋めることは仕組みとして可能** （`packages/coding-agent/src/core/extensions/types.ts:1798-1799, 1942-1943`、ソース直読）。一方 **omp の `models.yml`/`models.yaml` の `cost` フィールドは静的な数値のみを受け付けるスキーマであり、起動時フェッチの仕組みは無い**（`models-config-schema-bundle.ts:203, 260`、`docs/models.md`、ソース直読）。**pi には「拡張が自分でフェッチすれば実現できる」余地があるが、omp には設定ファイルレベルでその余地が無い**、という非対称がある。
6. **「価格不明のときどう見せるか」は実装ごとにばらけているが、多くが「0 やダミー値ではなく省略する」方向。** aider は `main_model.info.get("input_cost_per_token")` が無ければ Cost 行自体を出さずトークン行だけ返す（`base_coder.py:2031-2033`、ソース直読）。cline は `usageCostDisplay` が `"hide"`（「費用が知りようがない、または無意味なプロバイダ」）のとき費用欄を出さない設計をコード内コメントで明言する（`useProviderUsageCostDisplay.ts`、ソース直読）。LiteLLM 自身も今まさに同じ結論に向かっている——PR #41532 は「価格未設定のデプロイでは cost フィールドを**欠落させる、ゼロにはしない**」と明記（"Unpriced deployments leave the field absent, never zero"）。これに対し **omp の Agent Hub は既存記録どおり 0 を `$0.0000` と表示する**（`agent-hub-renderer.ts:261-266`、既存記録で直読済み）——業界の新しい合意（欠落表示）と omp の現状の実装が逆方向。

---

## 1. 候補A: プロキシがレスポンスに費用を乗せ、クライアントが合算する

### 1-1. OpenRouter（ベンダー docs、要約フェッチ）

https://openrouter.ai/docs/use-cases/usage-accounting

- 返るフィールド: `cost`（総課金額）、`cost_details.upstream_inference_cost`（**BYOK リクエストのみ**、それ以外は 0 または null）、`cached_tokens`/`cache_write_tokens`。
- ストリーミング: 「最後の SSE メッセージに usage 情報が含まれる」——非ストリーミングと同じ形で完全な usage が返る。
- `usage: {include: true}` パラメータは**廃止**——「now obsolete... Full usage details are now always included automatically in every response」。かつては opt-in だったが今は常時オン。

### 1-2. LiteLLM は OpenRouter のフィールド名を模倣するが、ストリーミングに限定され、非ストリーミングは未解決（ベンダー issue tracker、API 直読）

既存記録の通り、LiteLLM のストリーミング `usage.cost` 注入は `include_cost_in_streaming_usage`（既定オフ）でのみ有効。**非ストリーミングは本文に乗らずヘッダーのみ**。これを埋める提案が今回新たに見つかった:

- [BerriAI/litellm#41486](https://github.com/BerriAI/litellm/issues/41486)（open, 作成 2026-09-16, 作成者 `benlangfeld`）
  > "This asymmetry means a client that wants per-call cost has to read it from a different place depending on whether it streamed — and for a large class of clients, the header is not reachable at all."
  > "Langfuse runs its LLM-as-a-Judge evaluators and its Playground through the Vercel AI SDK. ... The `@ai-sdk/openai-compatible` provider's `metadataExtractor` hook — the sanctioned way to lift non-standard fields off a gateway response — is handed only the parsed body. So there is no supported path by which a LiteLLM cost header reaches that consumer."
  > "The result is that every judge and playground generation routed through a LiteLLM gateway records tokens but zero cost, despite LiteLLM having computed the exact figure."
  > 根拠として「OpenRouter ships `usage.cost` and `usage.cost_details` unconditionally on every response, streaming or not」「DeepInfra reports `usage.estimated_cost`」を挙げ、LiteLLM にも本文への注入を求めている。
- [BerriAI/litellm#41532](https://github.com/BerriAI/litellm/pull/41532)（open, 作成 2026-09-17）——上記への対応 PR。
  > "Unpriced deployments leave the field absent, never zero"
  2026-09-30 時点でまだマージされていない（`state: open`）。

→ **候補Aの「サーバーが本文に費用を乗せる」は、ストリーミングに関してのみ現実的な経路であり、非ストリーミングは業界の議論としても未解決の穴**。pi/omp の実際の通信がストリーミングかどうかは別記録（server-reported-cost.md）の範囲で、omp・pi 双方ともストリーミング API を使う前提で書かれている（`parseChunkUsage`/ストリーミングチャンク処理として引用されている）ため、この穴自体は今回のユースケースへの影響は限定的と読める——ただし「読む側」の実装（次項）がボトルネックになっている。

### 1-3. omp: provider 名ホワイトリストの再確認（前回記録の再掲、新規追加なし）

`packages/ai/src/providers/openai-shared.ts:405-425` の `applyProviderReportedCost` は `model.provider` が文字列として `"openrouter"` または `"cline-pass"` のときのみ `rawUsage.cost` を読む（前回記録で確認済み、再検証していない）。

### 1-4. omp: provider 名を `"openrouter"` と自称すればゲートを通るか（新規、未検証で終わった)

`models.yml` の `providers.<provider-id>` の `provider-id` キーがそのまま `Model.provider` になる経路を `model-registry.ts` で追った(`provider: customModel.provider`, line 1123, ソース直読)。`customModel.provider` の実際の代入元（YAML の `provider-id` キー由来かどうか）までは、スキーマ束ねファイル（`models-config-schema-bundle.ts`、496バイトの再エクスポートのみの薄いファイルで、実体は生成物の可能性が高い）を追いきれず**未確認**。**「LiteLLM プロキシを `providers.openrouter:` というキー名で登録すれば `applyProviderReportedCost` のゲートを満たせるか」は理論的な推測に留まり、実機検証していない** [unverified]。仮に通るとしても、それは実装の偶然の隙を突く回避策であり、業界の作法として確認できたものではない。

### 1-5. 実際にサーバー報告コストを読むクライアント実装は探した範囲で見つからなかった

Cline（`cline/cline`, ★69,585, 2026-09-30 push）のソースを `git/trees` API で走査したが、専用の `openrouter.ts` プロバイダファイルや `totalCost`/`genId` 相当の生成コスト取得コードは見つからなかった。現行の Cline は次節のとおり models.dev 由来のカタログ単価×トークン数で計算する設計に見え、**「OpenRouter の generation エンドポイントやレスポンスの `cost` フィールドを読んで実測コストを出す」経路は今回のソース走査では確認できなかった**（コード検索 API が使えないための限界、"存在しない"の確認ではない）。

---

## 2. 候補B: クライアントがプロキシの spend ストアを事後に問い合わせる

### 2-1. LiteLLM のエンドポイント群（ベンダー docs、要約フェッチ + ソース直読で補強）

https://docs.litellm.ai/docs/proxy/cost_tracking （要約フェッチ）
- `/spend/logs`: 個別トランザクション、レガシー版は 10,000 行で切り詰め（`x-litellm-spend-logs-truncated` ヘッダーで通知）。
- `/spend/logs/v2`: ページネーション対応（`page`, `page_size`, 最大1000/ページ）。
- `/user/daily/activity`: 日付・モデル・プロバイダ・API キー別の集計。
- タグ: リクエスト本文 `metadata.tags`、ヘッダー `x-litellm-tags`、キー/チーム設定時のタグ。既定で `User-Agent` を自動タグ化。
- `user` パラメータは**自己申告値**であり、なりすまし可能——信頼できる帰属には key 作成時の `user_id` 設定を推奨、とドキュメントが明記。

https://docs.litellm.ai/docs/proxy/tag_routing （要約フェッチ）
- タグルーティングの主目的はデプロイ振り分けだが、「チーム／プロジェクト単位のコスト帰属」ユースケースにも言及（要約：ドキュメントは「タグベースの費用追跡」という言葉自体は明示的には使っていないが、チーム作成＋タグでの振り分けが組織単位のコスト追跡に使われる、と説明）。

### 2-2. バッチ書き込みの遅延（ソース直読、ベンダー docs に明記なし）

`litellm/constants.py:1789`
```python
PROXY_BATCH_WRITE_AT: Final = int(os.getenv("PROXY_BATCH_WRITE_AT", 10))  # in seconds, increased from 10
```
`litellm/proxy/proxy_server.py:10033`
```python
batch_writing_interval: Final = proxy_batch_write_at + random.randint(0, 5)
```
`litellm/proxy/proxy_server.py:2711` 付近のコメント（`reseed_spend_counter_from_db` 関数のdocstring）:
> "The DB row is a LAGGING authoritative floor, not post-request truth: the entity .spend column is flushed in batches (every PROXY_BATCH_WRITE_AT), so it can exclude this request's just-recorded cost and other buffered spend."

→ **既定で最短 10 秒・最長 15 秒（10 + 0〜5 秒のジッター）、DB 反映が遅れる**。これはドキュメントに明記されておらず、ソースコードのコメントでのみ確認できた実装詳細。Swarm 一覧のような「今のワーカーの費用」表示に `/spend/logs` を毎回叩く設計は、この遅延の分だけ表示が遅れることになる。

### 2-3. 名前のある実践者による「タグでエージェント単位に帰属」の実例は見つからなかった

WebSearch がこのセッションで予算切れ、DuckDuckGo HTML 検索も CAPTCHA で到達不能だったため、ブログや X の投稿を探索できなかった。GitHub の issue 検索（無認証、API 直読）でも `repo:BerriAI/litellm "usage.cost" streaming` 等のクエリでヒットしたのは LiteLLM 自身の PR/issue のみで、外部実践者が「タグでマルチエージェントの費用を割り当てた」体験を書いた記事や issue は見つからなかった。**「届かなかった」であり「存在しない」の確認ではない。**

---

## 3. 候補C: クライアントが起動時にプロキシの価格カタログを取得する

### 3-1. `/model/info` は実在し、価格表由来のフィールドを返す（ソース直読）

`litellm/proxy/proxy_server.py:15343-15352`（`GET /model/info`, `GET /v1/model/info`）→ `_enrich_model_info_with_litellm_data`（同ファイル:13831 以降）:
```python
# read litellm model_prices_and_context_window.json to get the following:
# input_cost_per_token, output_cost_per_token, max_tokens
litellm_model_info = get_litellm_model_info(model=model)
...
unpriced: Final = cost_map_omits_token_price(model_info.get("id"), litellm_model_info.get("key"))
...
model["model_info"] = {
    ...
    k: None if unpriced and k in ("input_cost_per_token", "output_cost_per_token") else v
    ...
}
```
→ 価格が価格表に無いモデルは `input_cost_per_token`/`output_cost_per_token` が **`None`（欠落として明示）** で返る——ここでも「0 ではなく欠落」という同じ規約が採用されている。

ベンダー docs（`docs/proxy/model_management`、要約フェッチ）も「Each row shows the public model name, the underlying provider and litellm model, and the input and output cost per token」と一致する記述。

### 3-2. LiteLLM python ライブラリ自体は既定でこの価格表を**ライブ取得**する（ベンダー docs、要約フェッチ）— 候補Cの最も強い前例

https://docs.litellm.ai/docs/completion/token_usage
> "use the live list from `api.litellm.ai`"（`completion_cost()`/`cost_per_token()` の既定動作として）
> 価格表は "a community maintained list"、"Contributions are welcome!"
> ファイアウォール環境向けの代替: `export LITELLM_LOCAL_MODEL_COST_MAP="True"` — ただしこれを使うと「you will need to upgrade to get updated pricing, and newer models」

→ **ベンダー自身が「静的コピーは劣化パス」と位置付けている**一次情報。aider はこの `completion_cost()` を直接呼んでいる（次項）。

### 3-3. Aider: litellm ライブラリの計算を優先し、失敗したらローカルの `model.info` にフォールバックする（ソース直読、名前のある実践者ツール）

`aider/coders/base_coder.py:2031-2046`
```python
if not self.main_model.info.get("input_cost_per_token"):
    self.usage_report = tokens_report
    return

try:
    # Try and use litellm's built in cost calculator. Seems to work for non-streaming only?
    cost = litellm.completion_cost(completion_response=completion)
except Exception:
    cost = 0

if not cost:
    cost = self.compute_costs_from_tokens(
        prompt_tokens, completion_tokens, cache_write_tokens, cache_hit_tokens
    )
```
→ 3段構え: ①`model.info` に単価が無ければコスト行自体を出さない（次章）、②あれば litellm ライブラリの計算器（=上記のライブ取得価格表）を試す、③例外またはゼロならローカルの `model.info`（litellm の `model_cost` 辞書 or ユーザー上書き）から自前計算。**「まずベンダーのライブ計算に委譲し、失敗したら自分の持っている情報で計算」という二段構えの実例**。

### 3-4. Cline / LibreChat / OpenCode: 独自コピーではなく「共有カタログ」または「サーバー1箇所への集約」

**Cline**（`cline/cline`、ソース直読）: モデルカタログは models.dev（第三者の共有プロジェクト）から生成される。
`sdk/packages/llms/src/catalog/README.md`
> "The generated catalog is the SDK's normalized copy of provider and model metadata. Most built-in catalog data comes from [models.dev](https://models.dev) through `catalog-live.ts` and is written to `catalog.generated.ts` by the model generation scripts."
→ Cline は**手で価格を追わず、models.dev というコミュニティ管理カタログをビルド時に取り込む**設計。実行時フェッチではなく生成スクリプトでの取り込みだが、「各クライアントが個別に価格を書き写す」ことは避けている。加えて費用表示自体が3状態（`"show" | "hide" | "subscription"`）で、`"hide"` は「コストが知りようがない、または無意味」なプロバイダ向けと明記される（`useProviderUsageCostDisplay.ts`、コメント全文引用済み、ソース直読）。

**LibreChat**（`danny-avila/LibreChat`、ソース直読、コミット固定不能・2026-09-30 の `main`）: 価格解決をサーバー側1箇所に集約する設計をコード内コメントで明言。
`packages/api/src/endpoints/pricing.ts`
```ts
/**
 * Resolves context windows (and optionally pricing) for every configured
 * model, server-side, so the client never reimplements pattern matching.
 */
export function buildTokenConfigMap(...)
```
かつ `TokenConfigParams.endpointTokenConfigs` のコメント:
> "Per-endpoint overrides: fetched (e.g. OpenRouter) or yaml `tokenConfig`"
→ **既定は自前の価格表（`tx.js` 系、モデル名パターンマッチ）だが、OpenRouter のような一部エンドポイントは「フェッチした」レートで上書きできる仕組みがある**、とコメントされている（具体的なフェッチ実装ファイルは今回のツリー走査では特定できず [unverified]）。いずれにせよ「サーバーが1箇所で解決し、複数クライアント面がそれぞれ価格表を持たない」という設計原則は明確。

**OpenCode**（`anomalyco/opencode`、★211,009、2026-09-30 push、`dev` ブランチ既定）: vendor docs（`opencode.ai/docs/models/`、要約フェッチ）にはコスト表示の記述が無く（「見当たらない」であって「無い」の確認ではない）、リポジトリ内にも `pricing.ts`/`price.ts` は見つかったが、それらは OpenCode 自身のホスティングゲートウェイ（"Zen"）向けのコンソールコードであり、CLI 本体のコスト表示ロジックは今回のファイル名ベースの走査では特定できなかった [unverified]。GitHub コード検索が無認証で使えないため、`models.dev` をこの CLI 自身も使っているという一般に知られた話（本調査では一次確認していない）は引用しない。

### 3-5. LiteLLM `/model/info` を実際に起動時フェッチしているクライアントは見つからなかった

上記 3-1〜3-4 を踏まえ、**LiteLLM の `/model/info` エンドポイント自体を叩いて価格を取得しているクライアント実装は、今回調べた6リポジトリ（pi, omp, cline, aider, LibreChat, OpenCode）のいずれでも見つからなかった**。「候補C」という発想自体は models.dev 経由（cline）やライブラリ委譲（aider）という**隣接する形**で広く実践されているが、LiteLLM プロキシの `/model/info` を名指しで使う例は不在——「見つからない」であり「存在しない」ことの確認ではない（GitHub コード検索が無認証で不可のため）。

### 3-6. pi: `registerProvider` は拡張コードから任意のタイミングで呼べる（ソース直読、新規発見）

`packages/coding-agent/src/core/extensions/types.ts:1798-1799`
```ts
registerProvider(provider: Provider): void;
registerProvider(name: string, config: ProviderConfig): void;
```
同ファイルのドキュメントコメント（1755-1758行目）:
> "During initial extension load this call is queued and applied once the runner has bound its context. After that it takes effect immediately, so it is safe to call from command handlers or event callbacks without requiring a `/reload`."

`ProviderConfig.models[].cost` は `AnyModel["cost"]`（静的なレート型、1942-1943行目）——**フィールド自体は静的な数値だが、それを埋める呼び出しはいつでも・任意のロジックから発行できる**。つまり pi の拡張が `session_start` などのイベントで `fetch(proxyBaseUrl + "/model/info")` を叩いて得た `input_cost_per_token`/`output_cost_per_token` を `cost: {...}` に詰めて `pi.registerProvider(...)` すれば、「起動時に価格カタログを取得してクライアント側の静的表を埋める」設計は**仕組みとして実現できる**。ただし**そのような拡張が既に存在するかは確認していない**（今回はAPI仕様の確認のみ、実装例の探索はしていない）[unverified: 実例なし]。

### 3-7. omp: `models.yml` の `cost` は完全に静的、起動時フェッチの仕組みは無い（ソース直読、新規発見）

`packages/coding-agent/src/config/models-config-schema-bundle.ts:203, 260`
```ts
"cost?": {
    input: "number",
    output: "number",
    cacheRead: "number",
    cacheWrite: "number",
},
```
（`ModelOverrideSchema` 側では各フィールドが `optional` になるだけで型は同じ、260行目）。`docs/models.md` のカスタムプロバイダ例でも `cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }` と**書き込む数値そのもの**が例示されている。omp には pi の `registerProvider` に相当するような「拡張コードから動的にプロバイダを登録する」公開APIがあるかは今回確認できていないが、少なくとも `models.yml`/`models.yaml` という**設定ファイルの経路には起動時フェッチの仕組みが無い**（[unverified: omp の拡張API全体を洗っていない、設定ファイル経路のみ確認]）。

---

## 4. 候補D: 価格不明のとき何を表示するか

| 実装 | 価格不明時の表示 | 出典 |
|---|---|---|
| aider | Cost 行自体を出さない（Tokens 行のみ） | `base_coder.py:2031-2033`（ソース直読） |
| cline | `usageCostDisplay: "hide"` で費用欄を出さない。`"subscription"` はドル換算だが「実際の課金ではなく API レート換算の推定値」と明記 | `useProviderUsageCostDisplay.ts`（ソース直読、コメント全文引用済み） |
| LiteLLM `/model/info` | `input_cost_per_token`/`output_cost_per_token` を `None`（欠落）で返す。0 にはしない | `proxy_server.py:_enrich_model_info_with_litellm_data`（ソース直読） |
| LiteLLM `usage.cost`（提案中） | PR #41532: "Unpriced deployments leave the field absent, never zero" | [BerriAI/litellm#41532](https://github.com/BerriAI/litellm/pull/41532)（API直読、open） |
| LiteLLM 自身の spend ログ | 逆に、価格キー欠落が**サイレントに $0 として記録される**ことが長年の問題だった。2026年に警告とカウンタを追加 | [BerriAI/litellm#42345](https://github.com/BerriAI/litellm/pull/42345)（API直読、詳細下記） |
| omp Agent Hub | `$0.0000` のように**数値として表示**（`—` にしない） | 既存記録 `2026-09-30-agent-table-conventions.md`（`agent-hub-renderer.ts:261-266`、ソース直読済み） |
| Claude Code | ローカル単価表からの推定値を常に表示、「権威ある請求は Console の Usage ページを見よ」と注記 | 既存記録 `2026-09-30-agent-table-conventions.md`（要約フェッチ） |
| pi | 今回のソース走査では専用の費用表示コンポーネントを特定できず、確認できていない | [unverified] |

### 4-1. LiteLLM 自身が「価格キー欠落の黙殺」を問題として認識し直した経緯（新規、負の証拠）

[BerriAI/litellm#42345](https://github.com/BerriAI/litellm/pull/42345)（"feat(cost): warn and count $0 cost on billable requests"、API直読）
> "A billable request that prices to $0 is written to spend logs as truth"
> "Nothing warns, nothing counts it, so a missing pricing key goes unnoticed for weeks"
> "Free models and requests without usage look identical to the mispriced ones"

対応: リクエストごとに1回の警告（モデル名・価格表のキー・欠落しているレートを名指し）、新しいカウンタ `litellm_zero_cost_requests_total{requested_model, model, model_id, api_provider, reason}`（`reason` は `missing_pricing_key`/`pricing_not_applied`/`cost_calculation_error`）、無料モデル・usage無しのリクエストは黙って除外。

→ **「0円で沈黙する」設計は、価格計算を担う本家 LiteLLM でも運用上の実害（数週間気づかれない）を招いた既知の失敗モードであり、omp の `$0.0000` 常時表示（=「不明」と「本当に無料」を区別しない設計）は同種のリスクを継承している**、と読める。

### 4-2. Zed（ベンダー docs、要約フェッチ、到達したが記述なし）

https://zed.dev/docs/ai/models — Zed 自身がホストするモデルの価格説明はあるが、**カスタム OpenAI 互換プロバイダ（自前プロキシ経由）で価格不明のときにどう表示するかの記述は無かった**（"見当たらない"であって"無い"の確認ではない）。

---

## 比較表（出典・タスク種別・数値・失敗モード）

| 出典 | 種別 | 主張・数値 | 費用の出どころ | 名指しの失敗モード |
|---|---|---|---|---|
| OpenRouter usage-accounting docs | ベンダー | `usage.cost` は常時本文に乗る（ストリーミング／非ストリーミング共通） | サーバー計算・本文 | `cost_details.upstream_inference_cost` は BYOK 限定、それ以外は0/null |
| LiteLLM `include_cost_in_streaming_usage` | ベンダー(ソース) | 既定オフ、ストリーミング最終チャンクの `usage.cost` にのみ注入 | サーバー計算・本文（ストリーミングのみ） | 非ストリーミングは未対応（#41486, open） |
| LiteLLM `/spend/logs`, `/user/daily/activity` | ベンダー(docs+ソース) | `PROXY_BATCH_WRITE_AT`=10秒+ジッター0〜5秒 | サーバーDB事後集計 | 直近リクエストが除外される遅延、`user` 自己申告 |
| LiteLLM `/model/info` | ベンダー(ソース) | 欠落は `None`、0にしない | サーバー価格表(静的JSON) | 価格表自体が community maintained、頻繁な追加PR |
| LiteLLM python lib `completion_cost()` | ベンダー(docs) | 既定で `api.litellm.ai` からライブ取得 | ベンダーのライブカタログ | ローカル固定モードはアップグレードしないと最新価格を得られない |
| aider | 実践者ツール(ソース) | litellm委譲→失敗ならローカル計算→単価無しならCost行省略 | ライブラリ委譲＋自前フォールバック | 単価無し時は費用非表示（0でも—でもない） |
| cline | 実践者ツール(ソース) | `show`/`hide`/`subscription`/`unknown` の4状態 | models.dev生成カタログ（ビルド時取り込み） | `hide`=「不明・無意味」を明示的に区別 |
| LibreChat | 実践者ツール(ソース) | サーバー1箇所で解決、一部エンドポイントはフェッチ値で上書き | サーバー集約（自前価格表＋一部フェッチ） | フェッチ実装の具体箇所は未特定 |
| LiteLLM #42345 | 測定(issue) | 新カウンタ `litellm_zero_cost_requests_total` | — | 「数週間気づかれない$0」という実害を名指し |
| LiteLLM #41486/#41532 | 測定(issue,PR) | 2026-09-17提出、09-30時点でopen | — | Langfuse実例で「SDK越しのクライアントは常に$0」と指摘 |
| omp Agent Hub | 公開リポジトリ(ソース) | `$0.0000`表示、providerホワイトリスト2件のみ | ローカル計算＋ホワイトリストのみサーバー値 | 欠落と0円を区別しない |
| pi | 公開リポジトリ(ソース) | `registerProvider`は動的呼び出し可、`calculateCost`はサーバー値を読まない | ローカル計算のみ（現状） | 費用表示コンポーネント自体は未確認 |

---

## pi / omp への適合性（今回のユースケース: pi/omp のメインセッション＋ヘッドレス `--mode json` Swarm ワーカー）

- **候補A（本文の `usage.cost`）**: omp はストリーミングかつ provider 名が `openrouter`/`cline-pass` のときだけ読む——LiteLLM のカスタムプロキシ provider 名（例: `"proxy"`）はこのままでは対象外（前回記録の再確認）。pi はこの経路自体を持たない。**どちらも「そのままでは使えない」**。
- **候補B（`/spend/logs` 等の事後集計）**: タグで帰属自体はできるが、10〜15秒のバッチ遅延があるため、**常駐 Swarm テーブルのような「今動いているワーカーの費用」をリアルタイムに出す用途には不向き**——セッション終了後の確定値の裏取りには使える。
- **候補C（`/model/info` を起動時に取得）**: エンドポイントは実在し、実装コストは小さそうに見えるが、**採用している既存実装は見つからなかった**。pi は `registerProvider` が動的呼び出しに開かれているため、拡張として書けば実現できる可能性がある。**omp は `models.yml` の `cost` が静的数値のみで、この経路が設定ファイルレベルでは塞がれている**。
- **候補D（不明時は欠落表示）**: aider・cline・LiteLLM自身の新しい提案(PR #41532)が揃って「0円ではなく欠落として表示」の方向に収束しつつある。**omp の現状（`$0.0000`常時表示）はこの収束と逆方向**——ただし omp 側の設計変更が必要かどうかは今回の調査範囲外（判断ではなく事実の指摘のみ）。

---

## 確認できなかったこと

- WebSearch ツールはこのセッション開始時点で既に「200 of 200」使用済みで一切使えなかった。DuckDuckGo HTML 検索は CAPTCHA チャレンジ、grep.app は Vercel のチャレンジ画面で到達不能——ブログ・X投稿・Show HN 級の「名前のある実践者がLiteLLMタグでエージェント単位のコストを割り当てた」一次情報は探索できていない。
- GitHub の `search/code`（コード検索）API は無認証だと `401 Requires authentication` で使えず、`gh` CLI もこのセッションでは keyring 認証エラーで使えなかった。そのため「LiteLLM の `/model/info` を実際に叩いているクライアントが本当に存在しないか」は、走査した6リポジトリの範囲でしか確認できていない——網羅的な確認ではない。
- `api.github.com` の無認証レート制限（core 60回/時、search 10回/分）に複数回到達し、LibreChat の HEAD コミット SHA 固定、OpenCode の CLI 本体コスト表示ロジックの特定、cline の `applyProviderReportedCost`相当・generation エンドポイント読み取りの有無の確定的な検索、omp の provider 名自称ハックの実機検証、pi の費用表示UIコンポーネントの特定はいずれも未完了のまま終えた。
- LibreChat の OpenRouter向け「フェッチした」レート上書きの実装ファイルは特定できなかった（コメントで言及されているのみ）。
- 「LiteLLM プロキシに `providers.openrouter:` という provider-id を割り当てれば omp の `applyProviderReportedCost` ゲートを通せるか」は、ソースの型定義追跡だけでは確定できず、実機検証もしていない[unverified]。
- pi の `registerProvider` を使って `/model/info` を起動時にフェッチする拡張が実在するかどうかは探索していない（API仕様の確認のみ）。
- omp に pi の `registerProvider` に相当する動的プロバイダ登録の拡張APIがあるかどうかは、`models.yml` という設定ファイル経路以外を洗っていないため未確認。
- Codex（OpenAI）・Cursor は前回記録（agent-table-conventions.md）で到達性に難があったのと同じ理由で今回は対象に含めていない。

## 出典（URL一覧）

- https://openrouter.ai/docs/use-cases/usage-accounting （要約フェッチ）
- https://docs.litellm.ai/docs/proxy/cost_tracking （要約フェッチ）
- https://docs.litellm.ai/docs/proxy/tag_routing （要約フェッチ）
- https://docs.litellm.ai/docs/proxy/model_management （要約フェッチ）
- https://docs.litellm.ai/docs/proxy/response_headers （要約フェッチ、既存記録と重複確認）
- https://docs.litellm.ai/docs/completion/token_usage （要約フェッチ）
- https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/proxy/proxy_server.py （ソース直読、commit `04fa760bf2a0`）
- https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/constants.py （ソース直読、同上）
- https://github.com/BerriAI/litellm/issues/41486 （API直読、open）
- https://github.com/BerriAI/litellm/pull/41532 （API直読、open）
- https://github.com/BerriAI/litellm/pull/42345 （API直読）
- https://raw.githubusercontent.com/Aider-AI/aider/main/aider/coders/base_coder.py （ソース直読、commit `5dc9490bb35f`）
- https://raw.githubusercontent.com/cline/cline/main/apps/vscode/webview-ui/src/hooks/useProviderUsageCostDisplay.ts （ソース直読、commit `3435f72fcf4c`）
- https://raw.githubusercontent.com/cline/cline/main/apps/cli/src/utils/usage-cost-display.ts （ソース直読、同上）
- https://raw.githubusercontent.com/cline/cline/main/sdk/packages/llms/src/catalog/README.md （ソース直読、同上）
- https://raw.githubusercontent.com/danny-avila/LibreChat/main/packages/api/src/endpoints/pricing.ts （ソース直読、コミット未固定）
- https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/core/extensions/types.ts （ソース直読、commit `e7a9bf7e9423`）
- https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/models.md （ソース直読、commit `2b023d1b8013`）
- https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/models-config-schema-bundle.ts （ソース直読、同上）
- https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/model-registry.ts （ソース直読、同上）
- https://opencode.ai/docs/models/ （要約フェッチ、記述なし）
- https://zed.dev/docs/ai/models （要約フェッチ、記述なし）
