# GLM-5.3 は main tier（日常コーディングエージェント用モデル）で DeepSeek Flash を置き換える根拠になるか

確認日: 2026-09-23

## 答え

置き換えを裏付ける根拠は薄い。GLM-5.3 は合成知能指標（Artificial Analysis Intelligence Index）で DeepSeek Flash より優れる（44.78 対 39.46）が、その優位性は独立測定上、タスクあたり約7.4倍のコスト、TTFT 約3.2倍、出力速度が約1/3.7という代償を伴う。廉価版の GLM-5.3-Flash はコストでは DeepSeek Flash とほぼ同水準（オフピーク比で約13%高い）だが、その知能指標は本調査では確認できていない。運用面でも、LiteLLM の `zai` プロバイダは構造化出力（`response_format`）を事実上ドロップする未解決の公開バグがあり、Z.ai の API 自体も GLM-5.3 で JSON schema 出力を無視することが報告者により直接検証されている。GLM のサブスクリプション（Coding Plan）は正式にサポートされるツール一覧に pi は含まれるが DSH・omp は含まれず、非対応ツール経由の利用は過去に実際の大規模レート制限インシデントを招いている。

## 根拠

- Artificial Analysis（独立測定、SSR JSON を直接取得）: Intelligence Index は GLM-5.3 (max) 44.78 対 DeepSeek V4.1 Flash (max) 39.46。Median Output Speed は 60.69 対 226.56 tok/s。Cost per Intelligence Index task は $2.01 対 $0.27。TTFT は 3.41s 対 1.08s。
- ベンダー価格ページ（DeepSeek: `api-docs.deepseek.com/quick_start/pricing`、Z.ai: `docs.z.ai/guides/overview/pricing`、いずれも直接取得）: pay-as-you-go の1Mトークンあたり入力/出力価格は DeepSeek Flash が地域・ピーク時間帯に応じ $0.003〜$0.30（入力）/ $0.60〜$1.20（出力）、GLM-5.3 は $1.40（入力）/ $4.40（出力）でピーク/オフピークの区別なし。廉価版 GLM-5.3-Flash は $0.15（入力）/ $0.50（出力）。
- `github.com/BerriAI/litellm` issue #37720（open, 直接取得）: 「`zai` プロバイダは `response_format` を黙って捨てる。litellm を経由せず Z.ai の API を直接叩いても glm-5.2/5.3 は JSON schema 指定を無視し、強制ツールコールのみ仕様どおり機能する」。
- `docs.z.ai/devpack/usage-policy`（直接取得）: 「GLM Coding Plan は公式にサポートされたツールでのみ利用でき、非対応ツールでの利用は利益制限の対象になり得る」。サポート対象一覧（`docs.z.ai/devpack/tool/others`）に pi は名指しで含まれるが DSH・omp は含まれない。
- `github.com/zai-org/GLM-5` issue #83（直接取得、2026年6月〜9月にかけてコメントが継続）: GLM Coding Plan の有料ユーザーが数日にわたりレート制限で「実質使用不能」だったと複数ユーザーが報告、9月14日時点でも同種の苦情が続いている。
- GLM-5.3 のモデルカード（`docs.z.ai/guides/llm/glm-5.3`、直接取得）: 「GLM-5.3 は常に reasoning が有効で、無効化はサポートされない」——低レイテンシが求められる単純な呼び出しでも常に reasoning のコストがかかる。
- ベンダー自身のベンチマーク発表（同モデルカード）: GLM-5.3 は Max effort で Claude Fable 5（39.5%）にまだ届かない（34.5%）と明記。

## 注意点

- GLM-5.3 の SWE-bench Verified・τ²-bench・BFCL 個別スコア、GLM Coding Plan の月額 $ 金額の一次確認は取れなかった（サードパーティのアグリゲータ間で $18/$72/$160〜$18/$80/$168〜$10/$30/$80 まで不一致）。
- GLM-5.3-Flash（廉価版）の知能指標・コーディングベンチマークは未確認——コスト比較のみで品質は不明のまま。
- 上記コストはすべて国際エンドポイント（z.ai）の pay-as-you-go 価格であり、中国国内エンドポイント（bigmodel.cn）の価格・データポリシーは未調査。
- データ保持方針について、DeepSeek 側は期限付きの ZDR（Zero Data Retention）契約という検証可能な裏付けがあるのに対し、GLM 側の「学習に使わない・保持0日」という主張には第三者（GitHub issue）が契約文言の裏付け不在を指摘している。
- 本調査自体は「置き換えるべきか」への決定を下さず、判断材料の提示にとどまる。
