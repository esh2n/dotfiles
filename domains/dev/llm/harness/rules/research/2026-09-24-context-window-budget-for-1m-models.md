# ハーネスの contextWindow を1M-classモデルのベンダー最大値に合わせるべきか

日付: 2026-09-24
対象: pi / omp / DSH（LiteLLM経由）、比較対象として Claude Code / Codex CLI
問い: `contextWindow`（ハーネス側のクライアント予算・圧縮トリガーの元値）はベンダー公称の最大値（DeepSeek 1M）に合わせるのが業界の慣行か、それとも低く予算取りするのが慣行か。

## 方法と検証凡例

- 「直接取得」= WebFetch/curl で一次ページを直接取得し、返答内に verbatim 引用を含む
- 「要約経由」= WebSearch のスニペット合成のみで、一次ページを直接確認できていない箇所。該当箇所には `[要約経由]` と明記
- 「未検証」= 出典が単一の要約にしか現れず、一次ページで再確認できなかった数値。`[unverified]` と明記
- GitHub は `gh` CLI がこのセッションでは認証・TLS 検証エラーで使用不可（`gh auth status` → keyring invalid、`gh api` → `x509: OSStatus -26276`）。代わりに `curl` 経由の `api.github.com`（未認証、レート制限あり）と WebFetch で直接ページ取得した。Issue本文・state・stateReasonは `curl` で取得した生JSONから直接確認したものが複数ある（明記する）

## 1. ベンダー

### (a) Claude Code / Anthropic

直接取得（code.claude.com/docs/en/model-config, platform.claude.com/docs/en/build-with-claude/context-windows, .../about-claude/pricing）。

- 1M窓はネイティブ1M対応モデル（Sonnet 5 等）では**デフォルトでON**、ベータヘッダ不要:
  > "For every model with a 1M-token context window, 1M is the default: you don't need a beta header, and long-context requests are billed at standard pricing."
  （https://platform.claude.com/docs/en/build-with-claude/context-windows）
- だが自動圧縮はウィンドウを使い切る前、既定で約967Kトークンで発火する。かつ**満杯まで待たない**設計:
  > "Sessions auto-compact before the window fills, at about 967K tokens by default; set `CLAUDE_CODE_AUTO_COMPACT_WINDOW` to choose a different threshold."
  （https://code.claude.com/docs/en/model-config）
- **最重要**: LiteLLM のようなゲートウェイ経由で使う構成（この持ち主の pi/omp/DSH と同型）では、Claude Code自身も1M対応を検証できないため予算を200Kに落とす:
  > "LLM gateway: when `ANTHROPIC_BASE_URL` points at a gateway, Claude Code can't verify 1M support. To use the full window, select Sonnet 5 (1M context) in the model picker, which maps to `sonnet[1m]`."
  （https://code.claude.com/docs/en/model-config）
- 料金面では1M級モデルに上乗せ課金は無い（コストは理由にならない）:
  > "Claude 4.6 and later models and Claude Mythos Preview include the full 1M token context window at standard pricing. (A 900k-token request is billed at the same per-token rate as a 9k-token request.)"
  （https://platform.claude.com/docs/en/about-claude/pricing#long-context-pricing）

結論: Anthropic自身が「フルの1M窓を持つモデルでも、満杯より手前の固定トークン数（967K、公称最大の約97%）で圧縮を発火させる」設計を採用しており、かつ「ゲートウェイ越しでは検証できないので既定は200K」という、まさにこの持ち主のLiteLLM構成に直撃する後退則を明文化している。

### (b) OpenAI Codex CLI

直接取得（learn.chatgpt.com/docs/config-file/config-reference）+ 直接取得したIssue本文（curl, api.github.com経由でJSON確認）。

- `model_context_window` フィールドの説明は簡潔: "Context window tokens available to the active model."／既定は「モデルごとの既定値に委ねる」で、ドキュメント上に具体的な既定トークン数は明記されていない。
- `model_auto_compact_token_limit`: "Token threshold that triggers automatic history compaction (unset uses model defaults)"
- **否定的証拠（直接取得, state=CLOSED, stateReason=NOT_PLANNED）**: openai/codex #19185「config.toml context window settings are not respected」。報告者は `model_context_window = 960000`（ほぼ1M）と `model_auto_compact_token_limit = 800000` を設定したが:
  > "After setting a large context window, for example around `1M`, Codex still automatically reports/uses about `258k` instead... The configured value is silently reduced/ignored."
  （https://github.com/openai/codex/issues/19185, Issueは `NOT_PLANNED` でクローズ済み）

結論: Codex CLIは設定ファイル上は1Mに近い値を受け付けるように見えるが、実際には約258Kに黙って切り詰め、メンテナはこれを「対応しない」とクローズした。ベンダー実装そのものが1M設定を信用していない。

### (c) pi (earendil-works/pi)

直接取得（packages/coding-agent/docs/compaction.md, settings.md, models.md — GitHub raw経由）。

- 圧縮トリガーの式が明文化されている:
  > "Auto-compaction triggers when: `contextTokens > contextWindow - reserveTokens`"
  （https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md）
  `reserveTokens` 既定 16384、`keepRecentTokens` 既定 20000（settings.md）。つまり `contextWindow` の値そのものが圧縮タイミングを直接支配する一次パラメータであり、それ以外の安全装置は薄い。
- `models.md`/`settings.md` 本文には「`contextWindow` をベンダー最大に合わせよ」という推奨も、逆に「低く取れ」という推奨も明記されていない — カタログのメタデータ任せである。
- **否定的証拠（直接取得, DeepSeek公式リポジトリ）**: deepseek-ai/deepseek-harness Discussion #5800（リポジトリは `curl api.github.com` で確認: owner type=Organization, star 234,001、DeepSeek公式）。pi系ハーネス相当の自前実装で、pi-aiカタログの既定 `contextWindow` が:
  > 262,144 tokens, which the source code describes as "a guess by construction" from the pi-ai catalog rather than a real capacity measurement
  （[要約経由] — WebFetchによる要約。原文verbatimは未確認）
  自己ホストvLLMは `max_model_len` を大きく設定していると `CONTEXT_WINDOW_EXCEEDED` を返さないため、二次安全装置（オーバーフロー検知による圧縮）も発火しない、という二重の穴が報告されている。
- **否定的証拠（直接取得, OPEN）**: earendil-works/pi #9482。DeepSeek V4 Flash を OpenAI互換ゲートウェイ（opencode-go）経由で使用、`contextWindow` は正しく1,000,000に設定済みだったにもかかわらず、ゲートウェイが返す空ボディ400エラーを「コンテキスト超過」と誤判定するバグにより、40%使用時点で約397,619トークン、13%使用時点で約127,210トークンが**破壊的に**削除された。根本原因はCerebras向けの正規表現 `"400 status code (no body)"` が全プロバイダに適用されていたこと。Issueはこのセッション時点で **OPEN**。
- **否定的証拠（直接取得, OPEN）**: earendil-works/pi #8328。usageブロックを返さないプロバイダでは `estimateContextTokens` の推定値が `lastUsageIndex === null` の場合に捨てられ、閾値圧縮が一切発火しない。0.84.1/0.84.2/mainで再現、**OPEN**。
- 参考（タイトルのみ確認、本文未読）: earendil-works/pi #5512「Auto-compaction has no mid-turn context guard, so long tool loops can exceed configured contextWindow」。

結論: pi自体のドキュメントは `contextWindow` の推奨値を明言しないが、実装済みバグ（#9482, #8328）はいずれも「`contextWindow` を大きく（1Mクラスに）設定した状態」または「使用量が報告されないプロバイダ」で圧縮が壊れる方向で発生しており、DeepSeek公式ハーネス側の同種報告と一致する。

### (d) omp (can1357/oh-my-pi)

直接取得（docs/models.md, GitHub raw経由）。

- `contextWindow` と `maxContextWindow` を明確に分離する設計:
  > "Set `contextWindow` to the normal prompt window and `maxContextWindow` to the larger prompt window accepted by the provider."
  > "`/extended-context on` selects the larger window; `off` restores the normal one."
- **設計意図が明文化されている**: これは「クライアント側のローカル予算」であって「プロバイダのサーバー側上限」ではないと明言:
  > "This changes OMP's local context budget, not the provider's server-side limit; verify the endpoint accepts requests of the configured size."
- 上限のクランプ: "Configured maxima do not replace provider-advertised capacity. Models governed by a catalog override ceiling (such as Codex Astra) still clamp to that ceiling."
- 省略時の既定値は128,000トークン（出題文で既知の事実として提示されており、pi系ハーネスのLiteLLM連携での既定フォールバック128K — 後述 pi-provider-litellm #170 — と同水準）。
- 実地（OPEN, [要約経由]）: can1357/oh-my-pi #12578「Allow TUI option for custom model context length for single session」。ユーザーは起動時にしか `contextWindow` を変えられず、セッション中の変更手段が無いと報告 — カスタムプロバイダ利用者が既定値を頻繁に手で上書きしている実態を示す。

結論: ompは「通常は低いcontextWindow・拡張は明示オプトインのmaxContextWindow」という二段構えを設計として採用しており、1Mをいきなり既定にする設計を明確に避けている。これはこの調査で見つかった唯一の、"低く予算取りする"ことを設計原則として文書化しているハーネスである。

### (e) opencode / Cursor / Cline

- **opencode**（anomalyco/opencode）直接取得:
  - #16308「How to enable 1M context in OpenCode for GPT-5.4? Compaction triggers at 272k, not 1M」。GPT-5.4の公称1M窓を使おうとしたが実際は272Kで圧縮発火、原因不明のまま**未解決でクローズ**（担当者からの回答なし）。
  - #8140「Feature Request: Configurable context limit and auto-compaction threshold」— **CLOSED as not planned**。要求内容自体が「200Kモデルのうち100Kしか使わないようにしたい」という、ベンダー最大より低く抑えたいという逆方向の要望:
    > "limit the maximum context usage (e.g., use only 100k of a 200k model)"
    理由として「コスト最適化」「60-80%で圧縮発火」「予測可能な動作」「想定外の高額請求の防止」が挙がっている。
- **Cline**（cline/cline, star 69,125, OPEN issues 1,435 — curl api.github.com で直接確認）直接取得:
  - 圧縮しきい値の式: `maxAllowedSize = Math.max(contextWindow - 40_000, contextWindow * 0.8)`
  - #14329「Auto-compact threshold scales with context window, so 1M-context models never compact in practice — no way to configure it」。200K→1M窓のモデル（Claude Sonnet 5）に切り替えたところ、圧縮発火点が約150K→約800Kへ移動し、典型的な会話が295K前後で収まるため**圧縮が一度も発火しなくなった**。実測の被害:
    > 294.9K tokens accumulated without compaction; $49.63 reported cost for a single task; Only 12% cache hit rate versus 98% in a controlled comparison
    Issue本文でCline側には Claude Code にある `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 相当の絶対値設定手段が無いと指摘。**CLOSED**（本文にメンテナの修正コミットへの言及なし、内容からは未修正の可能性）。
- **Cursor**: 「実用窓は200Kマイナスツール用システムプロンプト約24Kで176K程度」という言及が検索合成で見つかったが `[要約経由]` かつ一次のCursor公式ページで再確認できていない。`[unverified]`

結論: opencodeとClineはいずれも「圧縮しきい値がcontextWindowに比例してスケールする」設計を採用しており、モデルを1Mに切り替えると比例スケールにより実質「圧縮が起きなくなる」という同一の失敗パターンが両ハーネスで独立に報告されている。opencodeでは利用者側から明示的に「ベンダー最大よりわざと低く抑えたい」という要望が出ている。

### (f) DeepSeek

直接取得（api-docs.deepseek.com/quick_start/pricing, arXiv 2606.19348）。

- 価格表: コンテキスト長「1M」、最大出力「MAXIMUM: 384K」。入力サイズによる階層課金は無し（cache miss peak: flash $0.3/1M tok、v4-pro $1.32/1M tok — 均一レート）。
- 公式技術レポート（DeepSeek-AI著者、arXiv:2606.19348）:
  > "We present a preview version of DeepSeek-V4 series, including two strong Mixture-of-Experts (MoE) language models -- DeepSeek-V4-Pro with 1.6T parameters (49B activated) and DeepSeek-V4-Flash with 284B parameters (13B activated) -- both supporting a context length of one million tokens."
  長文コンテキストでの推論効率化（CSA+HCA）は述べられているが、抄録レベルでは劣化の自己申告数値（MRCR等）は確認できなかった。
- 「1Mコンテキストは容量であって性能ではない」という評は **DeepSeekの公式発信ではなく** Hugging Face の第三者ブログ（著者 ben burtenshaw、コミュニティ寄稿者、DeepSeek社員ではない）:
  > "A 1M context window is just capacity, not performance."
  （https://huggingface.co/blog/deepseekv4 — 著者確認済み、直接取得）
  同ブログはMRCR 8-needle精度について「256Kまで0.82超を維持、1Mで0.59まで低下」と記載するが、これも第三者の引用であり一次データへのリンクは本文中に確認できなかった。測定エビデンス扱いとしてlens 2に計上する。

結論: DeepSeekの一次情報は「1Mコンテキスト・384K最大出力・均一課金」という容量とコストのみを公表しており、実効性能の自己申告や「効果的にはこれより低く使え」という推奨は見つからなかった。劣化の定量値は第三者のみ。

## 2. 測定エビデンス

- **Chroma "Context Rot"**（trychroma.com/research/context-rot、18モデル: Claude Opus/Sonnet/Haiku系, o3, GPT-4.1系, GPT-4o, GPT-4 Turbo, GPT-3.5 Turbo, Gemini 2.5系, Qwen3系）。直接取得できた本文からの verbatim:
  > "their performance grows increasingly unreliable as input length grows"
  「1M窓でも5万トークンで劣化が始まる」という具体的数値は検索合成のみで見つかり、trychroma.com本体の直接取得では確認できなかった。`[unverified]`
- **NoLiMa**（arXiv:2502.05167, Adobe Research）: 文字列一致に頼らない検索課題。GPT-4oは短文99.3%→32Kで69.7%→128Kで56%。10モデルが32Kで短文基準の50%を下回る。`[要約経由]`（アブストラクト内容の合成、原文PDF未直接取得）
- **RULER**（arXiv:2404.06654, NVIDIA）: 素朴なNeedle-in-Haystackでほぼ満点でも、マルチホップ・集約課題では公称コンテキスト長に遠く届く前に性能が崩れる、との一般的知見。`[要約経由]`
- **DeepSeek V4固有**: MRCR 0.82(256K)→0.59(1M) は前述の通り第三者ブログ発。「V4 Flash（non-thinking）は32K/435Kで100% NIAH」というコミュニティコメントも同ブログ内の引用で、DeepSeek公式値ではない。単純NIAHが高スコアでも複雑タスクは別、というRULERの一般論と整合する。
- **コスト試算**（DeepSeek公式価格から算出）: cache miss / peak時間帯で、
  - 1Mトークン入力: flash $0.30、v4-pro $1.32
  - 200Kトークン入力: flash $0.06、v4-pro $0.264
  差額自体は小さく、「1Mに設定すると高額請求になる」という直接の価格的恐怖は無い。実際に高額化するのは Cline #14329 のように**圧縮が発火せずキャッシュヒット率が98%→12%に崩れる**という間接的な経路であり、生のトークン単価ではない。
- **レイテンシ/TTFT対プロンプト長**: Artificial AnalysisはDeepSeekの複数モデル・プロバイダのTTFTを個別に公表している（例: DeepSeek V4 Pro non-reasoning 最速1.57秒、V4.1 Flash max 5.09秒〜、V4 Flash reasoning 6.10秒〜）が、これはプロバイダ間比較であり「プロンプト長を伸ばすとTTFTがどう伸びるか」を制御した実験ではない。**数値なし（この問いに対しては）**。

## 3. 実践者

- pi #9482 報告者: DeepSeek V4 Flashをopencode-goゲートウェイ経由でpiに接続、`contextWindow`は正しく1,000,000に設定していたが、ゲートウェイのバグにより最大約40万トークンが誤って破棄される事故を経験。「1Mに正しく設定しても守られない」という実例。
- Cline #14329 報告者: 200K→1M窓のモデルに切り替えた結果、圧縮が発火しなくなり単一タスクで$49.63、キャッシュヒット率12%（対照98%）という実測コスト増を経験・報告。
- opencode #16308 報告者: GPT-5.4の公称1Mを使おうとしたが実際には272Kで頭打ちになり、原因も対処法も得られないまま終了（1Mへ到達しようとして到達できなかった実例）。
- opencode #8140 要求者: 最初から「200Kモデルのうち意図的に100Kしか使わない」設定を求める — ベンダー最大を使わないことを積極的に選好する実践者の声。
- DeepSeek公式ハーネス（deepseek-ai/deepseek-harness）Discussion #5800 の報告者: 自己ホストvLLM構成で `contextWindow` の既定値（262,144、カタログ上の「推測値」）が実際のセッション挙動と乖離し、圧縮が発火しないまま1日あたり約6.7億入力トークン（大半がコンテキストの再読み込み）を消費したと報告。

いずれも「named, notable な個人ブログ」ではなくGitHub Issue報告者（ハンドル名のみ判明）である。著名な個人技術者が自分のサイトで「pi/ompをDeepSeek 1Mでこう設定した」と書いた一次記事は、今回の調査では見つからなかった。

## 4. 実地（公開リポジトリ）

| リポジトリ | star | open issues | 直近push | 関連する状態 |
|---|---|---|---|---|
| earendil-works/pi | 108,773 | 224 | 2026-09-23（当日）| #9482, #8328 とも OPEN。圧縮トリガー機構のバグが未修正のまま活発運用中 |
| can1357/oh-my-pi | 32,915 | 3,062 | 2026-09-23（当日）| #12578（セッション中に窓を変えられない）OPEN。issue:star比が高く粗さが残る |
| anomalyco/opencode | — | — | — | #16308, #8140 とも解決なしでクローズ（負のエビデンス: 要望が通っていない） |
| cline/cline | 69,125 | 1,435 | 2026-09-23（当日）| #14329 はCLOSEDだが本文からは修正確認できず、実測コスト事故が記録として残る |
| BerriAI/litellm | — | — | — | #27830: セルフホストvLLM/OpenAI互換モデル（この持ち主のLM Studio構成と同型）は`max_input_tokens`/`max_output_tokens`が手動設定なしでは`null`になる。対応PR #41508はクローズ済み |
| balcsida/pi-provider-litellm | — | — | — | #170: LiteLLMが`max_input_tokens`を返さない場合、piプロバイダはハードコードされた128Kにフォールバックする現行実装 |

## まとめ表

| 情報源 | 種別 | タスク種別 | 結果 | コスト数値 | 名指しの失敗モード |
|---|---|---|---|---|---|
| Claude Code docs (code.claude.com) | ベンダー | 汎用エージェント運用 | 1M対応モデルでも既定は満杯前967Kで圧縮、ゲートウェイ経由は200Kに後退 | 上乗せ課金なし（900k=9kと同単価） | ゲートウェイ越しは1M検証不能 |
| openai/codex #19185 | 実地/Issue | 汎用CLI設定 | 960K設定→実際は約258Kに黙って縮小、NOT_PLANNED | — | 設定が黙って無視される |
| pi #9482 | 実地/Issue | DeepSeek V4 Flash + ゲートウェイ | contextWindow=1M設定済みでも誤検知で破壊的圧縮 | 約40万+約13万トークン破棄 | ゲートウェイ400を誤ってオーバーフロー判定 |
| pi #8328 | 実地/Issue | usage非対応プロバイダ | 閾値圧縮が一切発火しない | — | usageブロック欠如で推定値を破棄 |
| deepseek-ai/deepseek-harness #5800 | 実地/Discussion（DeepSeek公式） | 自己ホストvLLM | 既定262,144は「推測値」、圧縮も過剰検知もされない | 1日約6.7億入力トークン | 二重の安全装置欠落 |
| omp docs/models.md | ベンダー(ハーネス) | 設計方針 | 通常窓と拡張窓を明示分離、既定は低い方 | — | — |
| opencode #16308 | 実地/Issue | GPT-5.4 1M狙い | 実際は272Kで頭打ち、未解決 | — | 原因不明のまま放置 |
| opencode #8140 | 実地/Issue | コスト管理目的 | ベンダー最大より低く抑える機能を要求、NOT_PLANNED | 「想定外の高額請求」を懸念 | — |
| cline/cline #14329 | 実地/Issue | Claude Sonnet 5 (1M) | 比例スケールしきい値のため1M窓で圧縮が事実上発火せず | 1タスク$49.63、キャッシュヒット12%(対照98%) | 圧縮しきい値がcontextWindowに比例 |
| Chroma context rot | 測定 | 汎用（18モデル） | 満杯よりずっと手前から劣化 | — | lost-in-the-middle、distractor干渉 |
| NoLiMa | 測定 | 非文字列一致検索 | 32Kで多くのモデルが基準の50%未満 | — | 文字列一致に頼らないと崩れる |
| RULER | 測定 | 検索/マルチホップ/集約 | 公称長より手前で実効長が尽きる | — | NIAH満点は他課題の崩壊を隠す |
| DeepSeek pricing | ベンダー | — | 1M/384K、階層課金なし | 1M入力: flash $0.30 / v4-pro $1.32 | — |

## 確認できなかったこと

- Chromaの「1M窓でも5万トークンで劣化が始まる」という具体的しきい値の一次確認（trychroma.com本体からは再取得できず、検索合成のみ）
- DeepSeek自身が発表した長文脈での定量的な劣化指標（MRCR等）。今回見つかったMRCR数値はHugging Faceの第三者ブログ経由であり、DeepSeek公式のモデルカードやリリースノートには当たれていない
- DeepSeek Flash / V4-Proのプロンプト長に対するTTFT・レイテンシを制御した実験データ。プロバイダ横断のTTFT値はあるが、プロンプト長を変数にした測定ではない
- ompの128,000という既定フォールバック値そのものをomp本体のソースコードで再確認すること（出題文で既知の事実として提示された値と、同種ハーネス pi-provider-litellm の128Kフォールバックとの整合は確認できたが、omp本体コードの直接確認はできていない）
- 著名な個人技術者が自分のブログで「pi/omp/opencodeをDeepSeek 1Mクラスモデルでどう設定したか」を書いた一次記事。見つかった実践者エビデンスはすべてGitHub Issue報告者(ハンドル名)であり、独立ブログ記事ではない
- Cursorの「実用窓は200Kマイナス約24Kのツールシステムプロンプトで176K程度」という数値の一次資料（Cursor公式ドキュメントでの直接確認）
- Claude CodeのLiteLLMゲートウェイ経由での200K後退が、実際にLiteLLMプロキシ構成で観測された practitioner報告（ドキュメント上の記述のみ確認、実地でのLiteLLM越しの再現談は見つからず）

## 結論(一段落)

ベンダー・実践者・測定・実地のどの角度から見ても、「`contextWindow` をベンダー公称の最大値（1,000,000）にそのまま合わせる」ことを標準的慣行として推奨する情報源は一つも見つからなかった。逆に、ベンダー自身（Anthropic）が1M対応モデルでも満杯の約97%（967K）で圧縮を打ち、しかもゲートウェイ越しでは1M検証ができないという理由で既定を200Kまで下げており、ハーネス側（omp）は「通常窓」と「拡張窓」を明示的に分離して既定は低い方を使う設計を採用し、他のハーネス(opencode, Cline)では逆に「ベンダー最大より低く固定したい」という利用者要望が(実装はされていないが)繰り返し出ている。そして`contextWindow`を額面通りベンダー最大に設定した実例(pi #9482、Cline #14329、DeepSeek公式ハーネスのDiscussion #5800)は、いずれも「圧縮トリガーが発火しない」か「誤検知で破壊的に発火する」かのどちらかの事故につながっている——原因はDeepSeekの生トークン単価(1M入力でも1ドル未満)ではなく、圧縮しきい値をコンテキスト窓に比例させる実装(`contextWindow`に対する割合)が、窓を大きく取るほど実質的な安全装置として機能しなくなるという、複数の独立したハーネスに共通する構造的な欠陥にある。業界が実際にやっているのは、ベンダー最大値をそのまま使うことではなく、圧縮の発火点を(窓に対する割合ではなく)固定の絶対トークン数として設定し、かつゲートウェイ越しでベンダー窓を検証できない場合は保守的な既定値に後退させる、という設計である。
