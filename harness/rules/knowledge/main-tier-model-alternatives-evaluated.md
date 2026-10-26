# GLM-5.3はmain tier（日常コーディングエージェント用モデル）でDeepSeek Flashを置き換える根拠になるか

確認日: 2026-09-23

## 答え

置き換えを裏付ける根拠は薄い。GLM-5.3は合成知能指標（Artificial Analysis Intelligence Index）でDeepSeek Flashより優れる（44.78対39.46）が、その優位性は独立測定上、タスクあたり約7.4倍のコスト、TTFT約3.2倍、出力速度が約1/3.7という代償を伴う。廉価版のGLM-5.3-FlashはコストではDeepSeek Flashとほぼ同水準（オフピーク比で約13%高い）だが、その知能指標は本調査では確認できていない。運用面でも、LiteLLMの`zai`プロバイダは構造化出力（`response_format`）を事実上ドロップする未解決の公開バグがあり、Z.aiのAPI自体もGLM-5.3でJSON schema出力を無視することが報告者により直接検証されている。GLMのサブスクリプション（Coding Plan）は正式にサポートされるツール一覧にpiは含まれるがDSH・ompは含まれず、非対応ツール経由の利用は過去に実際の大規模レート制限インシデントを招いている。

## 根拠

- Artificial Analysis（独立測定、SSR JSONを直接取得）: Intelligence IndexはGLM-5.3 (max) 44.78対DeepSeek V4.1 Flash (max) 39.46。Median Output Speedは60.69対226.56 tok/s。Cost per Intelligence Index taskは $2.01対 $0.27。TTFTは3.41s対1.08s。
- ベンダー価格ページ（DeepSeek: `api-docs.deepseek.com/quick_start/pricing`、Z.ai: `docs.z.ai/guides/overview/pricing`、いずれも直接取得）: pay-as-you-goの1Mトークンあたり入力/出力価格はDeepSeek Flashが地域・ピーク時間帯に応じ $0.003〜$0.30（入力）/ $0.60〜$1.20（出力）、GLM-5.3は $1.40（入力）/ $4.40（出力）でピーク/オフピークの区別なし。廉価版GLM-5.3-Flashは $0.15（入力）/ $0.50（出力）。
- `github.com/BerriAI/litellm` issue #37720（open, 直接取得）: 「`zai`プロバイダは`response_format`を黙って捨てる。litellmを経由せずZ.aiのAPIを直接叩いてもglm-5.2/5.3はJSON schema指定を無視し、強制ツールコールのみ仕様どおり機能する」。
- `docs.z.ai/devpack/usage-policy`（直接取得）: 「GLM Coding Planは公式にサポートされたツールでのみ利用でき、非対応ツールでの利用は利益制限の対象になり得る」。サポート対象一覧（`docs.z.ai/devpack/tool/others`）にpiは名指しで含まれるがDSH・ompは含まれない。
- `github.com/zai-org/GLM-5` issue #83（直接取得、2026年6月〜9月にかけてコメントが継続）: GLM Coding Planの有料ユーザーが数日にわたりレート制限で「実質使用不能」だったと複数ユーザーが報告、9月14日時点でも同種の苦情が続いている。
- GLM-5.3のモデルカード（`docs.z.ai/guides/llm/glm-5.3`、直接取得）: 「GLM-5.3は常にreasoningが有効で、無効化はサポートされない」——低レイテンシが求められる単純な呼び出しでも常にreasoningのコストがかかる。
- ベンダー自身のベンチマーク発表（同モデルカード）: GLM-5.3はMax effortでClaude Fable 5（39.5%）にまだ届かない（34.5%）と明記。

## 注意点

- GLM-5.3のSWE-bench Verified・τ²-bench・BFCL個別スコア、GLM Coding Planの月額 $ 金額の一次確認は取れなかった（サードパーティのアグリゲータ間で $18/$72/$160〜$18/$80/$168〜$10/$30/$80まで不一致）。
- GLM-5.3-Flash（廉価版）の知能指標・コーディングベンチマークは未確認——コスト比較のみで品質は不明のまま。
- 上記コストはすべて国際エンドポイント（z.ai）のpay-as-you-go価格であり、中国国内エンドポイント（bigmodel.cn）の価格・データポリシーは未調査。
- データ保持方針について、DeepSeek側は期限付きのZDR（Zero Data Retention）契約という検証可能な裏付けがあるのに対し、GLM側の「学習に使わない・保持0日」という主張には第三者（GitHub issue）が契約文言の裏付け不在を指摘している。
- 本調査自体は「置き換えるべきか」への決定を下さず、判断材料の提示にとどまる。
