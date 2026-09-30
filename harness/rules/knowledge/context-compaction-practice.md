# ベンダー・ラボ・実践者はコーディングエージェントの文脈窓と圧縮発火点をどう設定しているか

確認日: 2026-09-27

## 答え

この問いは決定 `harness/rules/decisions/2026-09-27-context-budget-1m-85pct.md`（main/complex の予算をプロバイダの1Mそのものにし、圧縮点を85%＝850,000に置く）の根拠となった6本の同日調査をまとめたものである。

ベンダー既定は窓の50%（Gemini CLI）から98%台（Crush・OpenCode・pi）まで散らばり、1M窓に対して20%のような小さい割合を強制するベンダーは無い。200Kという値が現れるのは Claude Code がゲートウェイ越しで1M窓を検証できないときのフォールバックだけで、これは「保守的な既定」ではなく「確認できないので小さく仮定する」という別の理由による。数値で作業予算を推奨する一次情報は少なく、唯一の例外は Amp（Sourcegraph）で「200k tokens is plenty」と明言し、1M窓を出した当のベンダーとして「フルの窓を使うな、20%（=200K）で警告を出す」と書いている。OpenAI の圧縮ガイドの全SDK例もコーディングモデルに対して `compact_threshold: 200_000` を使う（既定値ではなく例示）。Google の Gemini CLI は実験的機能で 150,000 発火・40,000 保持という絶対値の既定を持つ。

名の知れた実践者（Huntley、HumanLayer の Horthy/Kyle、pi 作者 Zechner、obra の Vincent、aider 作者 Gauthier）が数字を言うときは、いずれも200Kよりずっと小さい絶対値に収まる：Huntley は「170Kが上限」「147〜152Kで品質がclipする」、HumanLayer は「75Kのsmart zone」「1M窓でも100Kで警告（=10%）」、Zechner は「100Kあたりで崩れ始める」、Vincent は長い作業でも「100K」、Gauthier は「25〜30Kで混乱する」。割合で語るのは HumanLayer の40〜60%のみ。共通する機構は「窓を広げる」ではなく「ディスク上の引き継ぎ成果物（progress.md 等）＋セッション／subagentの隔離」で、圧縮そのものを信用しない（Amp: 圧縮は参考程度にし、正確な情報は原文に戻って確認せよ）という運用が繰り返し現れる。

日本語圏の実践者も同じ型に収束する。人間側が自分で先回りする基準を割合で示した例は「体感50〜60%を超えたあたりから、こまめに /compact」のみで、それ以外の実測（705回の圧縮ログ解析など）は「道具側の自動発火点が16万〜18万トークン付近にある」という観察であって、人間の判断基準ではない。割合で見ると、決定の発火点（85%）は日本語圏の慣行（80%）よりやや遅い。絶対値で見ると、決定の 850,000 は実践者が口にする先回りの値（数万〜17 万）より桁で大きい。

測定面では、設定した窓の値を操作変数にした統制比較（同じモデルで200K設定と1M設定を比べて品質を測った研究）は2026-06〜09に一件も存在しない。存在するのは(1)設定値→実効値の変換率（Codex は同梱カタログとの積で頭打ちにし、同じ「1000000」という設定が258,400にも828,400にもなる。OpenAIは2026-07-18に自社の同梱既定を372,000→272,000へ実際に下げている）、(2)コスト（Cline は圧縮点が窓の0.81倍に溶接されているため、200K→1Mへの設定変更だけで1タスク$49.63・キャッシュヒット12%（対照98%）を記録した）、(3)充填量だけを振った品質研究（最も近いものでも約75Kトークンで有意でない劣化）の三種。

## 根拠

- ベンダー既定トリガーが窓の50〜98%に散らばり、200Kを強制するベンダーが無いこと — Claude Code(約967K)/Codex(95%クランプ)/Gemini CLI(50%)/Cline(0.81×窓)/OpenCode/pi/Crush の各ソース・公式文書
- Amp の「200k tokens is plenty」と1M窓での20%警告 — https://ampcode.com/notes/200k-tokens-is-plenty 、https://ampcode.com/news/1m-tokens
- OpenAI compaction ガイドの全SDK例が `compact_threshold: 200_000` — https://developers.openai.com/api/docs/guides/compaction
- Gemini CLI の絶対既定（150,000発火／40,000保持） — `gemini-cli` の `docs/reference/configuration.md`
- Huntley の170K上限・147〜152Kでのclipping — https://ghuntley.com/ralph/ 、https://ghuntley.com/subagents/
- HumanLayer の75K smart zone・1M窓での100K警告（=10%） — https://www.humanlayer.dev/blog/context-efficient-backpressure 、https://www.humanlayer.dev/blog/long-context-isnt-the-answer
- Zechner（pi作者）の「100kあたりで崩れる」、subagentを持たない設計判断 — https://mariozechner.at/posts/2025-06-02-prompts-are-code/
- Cline の圧縮点が窓の0.81倍に溶接され、200K→1Mの設定変更だけで$49.63・キャッシュヒット12%を記録 — https://github.com/cline/cline/issues/14329
- OpenAI が同梱既定を372,000→272,000へ下げたこと（ファイル差分で確認） — Codex PR #33972（2026-07-18）
- 日本語圏の人間側の唯一の割合基準「体感50〜60%」、道具側の自動発火点16万〜18万トークン — Qiita/Zenn の実践者記事（`Tsutomu_eng`, `pnd`, `toshi772` 等）

## 注意点

- **決定の85%発火点は、名の知れた実践者の先回り帯（HumanLayer 40〜60%・75K、Zechner 100K、Huntley 147〜152Kでのclipping）より明確に上に位置する。** 決定が却下した「圧縮トリガーを窓に比例させる」パターンを、この家自身が同じ形（`effectiveReserveTokens = max(窓×15%, 16384)`）で採用している点は、実践者証拠と部分的に矛盾する。これは決定を変更する根拠としてではなく、将来の見直しのために明示的な未決着点として記録する。
- 設定した窓の値と実際に効く値は一致しないことが多い（Codex の同梱カタログ×95%クランプ、Cline の窓連動、Claude Code の発火率のバージョン間ドリフト）。「1M予算」と書いた設定がそのまま効いているとは限らない。
- Codex の実効窓は `min(設定値, カタログの上限) × 95%`。上限はアカウントの権利と時期で変わる（1M 級モデルで 872,000 なら 828,400、272,000 なら 258,400）。上限より下の設定はそのまま効く（設定 800,000 → 760,000、設定 450,000 → 427,500 で 400,990 に圧縮） — https://github.com/openai/codex/issues/47805 、https://github.com/openai/codex/issues/43648 、https://github.com/openai/codex/issues/39144
- 同じ設定・同じ場所でも、対話の CLI は約 1.05M、`codex exec --json` は約 258K と報告した例がある。道具が表示する値は予算そのものではない — https://github.com/openai/codex/issues/33478
- 圧縮点を実効窓より上に置くと、窓が埋まっても圧縮が起きない（設定 1,000,000・圧縮点 900,000・実効 828,400 の例） — https://github.com/openai/codex/issues/47805
- 圧縮1回あたりのキャッシュ再構築コストを金額で示した一次情報はどの記録でも見つからなかった。
- コーディングタスクに限定した長文脈劣化の測定は薄く、最も近いものでも n=10・p=0.0698（有意でない）で、単一の劣化開始点は特定できない。
- Web検索がこの一連の調査のセッションを通じて全プロバイダで失敗しており、発見経路は直接URL取得・GitHub API・HN Algolia API 等に限られる（「見つからない」は到達不能を意味し、不在の証明ではない）。
