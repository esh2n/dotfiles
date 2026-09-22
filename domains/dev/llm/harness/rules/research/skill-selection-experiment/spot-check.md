# Spot check — 30 prompts for the owner to verify by hand

Fill the **verdict** column with `ok` (the provisional label is right), a skill name
(the right one, if the label is wrong), or `none`. Add a short reason when you overrule.
Answer in chat or edit this file; either way, copy your verdicts into `prompts.jsonl`'s
`verdict` field before the protocol is frozen.

`src` — **N** = natural label (the model opened this skill by itself, no injection);
**M** = provisional label assigned by a model and not yet verified.

## 易 (10)

| id | stratum | src | prompt (redacted excerpt) | provisional label | why | verdict |
|---|---|---|---|---|---|---|
| `f69c6c3fb004` | unscouted | N | 全然話してることがわからないです。前提の説明がないし、DAPデバッガーってそもそも何かもわからないし、何が言いたいのかがわからないです。/eli5 | `eli5` | 「何も分からない」+ /eli5 の明示。 |  |
| `98d43111ea26` | followed | M | これまでにかかったコストをモデル別に見せて | `cost-tracking` | コストをモデル別に見せる依頼。 |  |
| `7bd2a695bdc7` | ignored | M | はい。 | `none` | 「はい。」のみ。 |  |
| `51dafa9308a8` | none | M | 別にCIを回してほしいとは言ってないですけど、ローカルでチェックできてればそれでいいと思ってます。  そして、ローカルにずっと差分が残り続ければよくないので、GitHub上に上げるのは良いですが、別にCIを回してほしいと… | `none` | CI は不要という指示。 |  |
| `efd92b33cd8f` | unscouted | N | このページのスクショを撮って、PRの説明に貼りたい | `ui-capture` | 同上（別セッションの同一文面）。 |  |
| `e9e4c89aad9b` | followed | M | いくつか調査したと思うので結果をまとめて htmlで。 | `writeup` | 「調査結果をまとめて html で」。 |  |
| `463d9f862317` | ignored | M | 全期間の 1 円単位の正確な請求履歴これは知りたいですよ。 | `cost-tracking` | 全期間の正確な請求履歴が知りたい。 |  |
| `d157b729c8f0` | none | M | <pasted_content id="6249"> じゃあ一旦別のエージェントの作業を完了してから、私たちもやるのがいいかなと思いましたが、いかがでしょうか。 </pasted_content id="6249"> | `none` | 順序の提案。 |  |
| `709cdf808a02` | unscouted | N | trust_brew_tapsについて調査してください。   次の内容を確認してください。   - どこで定義されているか  - どこから呼び出されているか  - 直接・間接的な呼び出し経路  - 依存している関数や設定… | `code-graph-exploration` | 定義・呼び出し経路・影響範囲の列挙という影響分析の定型依頼。 |  |
| `b5db31a5f707` | followed | M | 今月いくら使ったか、モデル別に集計して。結果を短く。 | `cost-tracking` | 今月の使用額をモデル別に集計する依頼。 |  |

## 中 (10)

| id | stratum | src | prompt (redacted excerpt) | provisional label | why | verdict |
|---|---|---|---|---|---|---|
| `ae39ef0e25b7` | unscouted | N | <pasted_content id="6249"> 使ってないからといって不要なスキルだとは判断できないと思います。  使ってないことが問題なのであって、例えばジェブとかで使うスキルを判断するという仕組みを入れたので、… | `skill-stocktake` | スキルの要否判定と、質を測る評価スキルの話。 |  |
| `042c13712b08` | followed | M | すでにフックを使っているからそれはいいでしょうという話はちょっと置いといて、ちゃんとそれがいいものかどうかは別途調べるべきだと思います。  例えば、フックを使うことによって何かデメリットがあるのかみたいな話とか、デファク… | `code-review-discipline` | 現状を是としないで調べた上で判断しろという要求。 |  |
| `f9f72c5ae1f0` | ignored | M | 自分のコードはまず信用しないで。フラットに考えて。 まず、loopエンジニアリングも評価を調べる必要があるでしょ | `code-review-discipline` | 自分のコードを根拠にするな、フラットに考えろという判断の作法。 |  |
| `33193be87227` | none | M | スプリットビューの時のヘッダーがおかしいのと検索の時にフォーカスリンクが出ているのは意図的ですか。私は変だと思いました。 | `none` | ヘッダーとフォーカスリングの仕様確認。 |  |
| `7185338e0d80` | unscouted | N | 要点だけ言われてもわかんないです。前提の説明がなくて、情報を落とされているのでわかんないです。  あと、意思決定をするときにアーティファクトで出してくださいと何度も伝えていると思います。 | `writeup` | 前提から積み上げた説明と、意思決定のアーティファクト化の要求。 |  |
| `ad4b9d6f51bb` | followed | M | そもそもこの形が間違っているという前提を訴える姿勢はちゃんと考えた上で、どのアーキテクチャ、どの組み方が業界的に優れているのか、デファクトスタンダードなのか、著名人が使っているのかみたいなところを調べた上で、私にディレク… | `code-review-discipline` | 業界標準を調べて設計を当て、承認を得てから進めるという判断の作法の要求。 |  |
| `a9b9ff83739e` | ignored | M | <pasted_content id="6249"> Pi v0.87.0がリリースされました！ 個人的に大きな変更点は以下  ・会話ログはそのままで、モデルに送るコンテキストだけを分離できる（1セッションで複数モデルを… | `none` | pi のリリースノートの共有。依頼が含まれない。 |  |
| `7599ea40f1fb` | none | M | デザインMD日本化しましたと言いましたが、私がそれ読めって言ってますか？読むコストのこと考えてます？ちゃんとチャットで説明してくださいね。 | `none` | 読ませる前にチャットで説明しろという指示。 |  |
| `75522759f1e7` | unscouted | N | Yokiを作り直さないか？流石にちゃんと設計したいyokiというaiぽい名前も気に食わないし | `writeup` | 作り直しの是非と設計方針の相談で、決定記録が残る類の話。 |  |
| `909c93f0dc03` | followed | M | いや、私は費用の数字そのものも見たいですよ。  <pasted_content id="6249"> そして、損益分益点も見たいです。もちろん、両方見たいです。 </pasted_content id="6249">  … | `cost-tracking` | 費用の実数と損益分岐点を見たいという要求。 |  |

## 難 (10)

| id | stratum | src | prompt (redacted excerpt) | provisional label | why | verdict |
|---|---|---|---|---|---|---|
| `68598cc7ce17` | unscouted | N | ただ、今回の場合だと本命の方でいいと思います。 | `writeup-kit` | 「本命の方でいいと思います」という選択の承認。 **⚠ この自然ラベルに不同意**: writeup-kit は直接呼ばれるスキルではない。承認ターンで選択事象ではない。none が妥当。 _(難しさ: 承認の一言で、指示語しかない。)_ |  |
| `6595ed2d7aec` | followed | M | <pasted_content id="6249">  1. 何を決めようとしているのか   一言でいうと、**「モデルに毎回見せているスキルの一覧をやめて、代わりに別の小さなモデルに1件だけ選ばせる」**という変更を入… | `code-review-discipline` | 決定記録の草稿を貼って判断を求めている。 _(難しさ: writeup（文書化）と code-review-discipline（判断の作法）が同程度に引かれる。)_ |  |
| `8d589ad6afac` | ignored | M | <pasted_content id="6249"> 逆に、判定をエージェント自身に任せた記録は全部失敗しています。Ronacher の自動工場は 35 時間・約 10 億トークン・約 1,200 ドルで 79 コミット… | `none` | 同上（同一本文の再投入）。 _(難しさ: 同上。)_ |  |
| `fec5b7eddec5` | none | M | …/harness-parity feat/pi-local-llm ✓ 18:53 ❯ YOKI_WORKFLOW_DAILY_CAP=50 yoki-graph run research --backend omp … | `none` | yoki-graph の実行ログを貼っている。 _(難しさ: 本文に yoki-graph のコマンドがそのまま含まれるが、要求は結果の確認であって起動ではない。)_ |  |
| `c66f8986fb5d` | unscouted | N | 続きの作業は何ですか。 | `writeup` | 次の作業は何かという状態確認。 **⚠ この自然ラベルに不同意**: 状態確認であって文書作成ではない。none が妥当。 _(難しさ: 継続ターンで、直前の文脈なしには何も決まらない。)_ |  |
| `60df48c52421` | followed | M | なんで分かれてるんですか？私がずっと言ってるのは、なんでジグを作っている時にちゃんと設計して進めてないんですか？設計して進めてくださいねって言ってます。  なんで予期をまず撤退させようとしてるかわかってますか？予期がちゃ… | `sdd` | 設計してから進めろという叱責。 _(難しさ: sdd（仕様駆動）と code-review-discipline（判断の作法）の境界が文面からは切れない。)_ |  |
| `55bb4bfec42a` | ignored | M | <pasted_content id="6249"> 逆に、判定をエージェント自身に任せた記録は全部失敗しています。Ronacher の自動工場は 35 時間・約 10 億トークン・約 1,200 ドルで 79 コミット… | `none` | 他者の調査引用を貼っただけで依頼がない。 _(難しさ: 評価・レビューの語彙が密集するが要求文がない。3 連続で同じ本文が投入されている。)_ |  |
| `686ed3519cfe` | none | M | ライトアップなので、アプリというかライトアップのHTMLを見れるようになっているはずなんですが、どこで見れますか？ | `none` | 生成された HTML をどこで見られるかという場所の質問。 _(難しさ: 『ライトアップ』が writeup を強く引くが、要求は閲覧先の案内。)_ |  |
| `3d6cb1ef6a7d` | unscouted | N | はい、DCBで必要があればAをやるべきだと思います。スキルの棚卸しとも言うのかな。 | `grilling` | 『スキルの棚卸し』への同意。 **⚠ この自然ラベルに不同意**: 文面は skill-stocktake 寄りで grilling とは読めない。継続ターンの副読の疑い。 _(難しさ: 指示語（DCB / A）が前ターン依存で、単体では判定不能。)_ |  |
| `faffc1e3a361` | ignored | M | <pasted_content id="6249"> [床] ハーネス自前の床（cc/codex/DSH）＋ sbx（採用時）＋ コアの floor ルール  ↑ 政策では届かない領域を物理的に止める [PEP] 各ハー… | `natural-japanese` | 『写像』などの不自然な用語で意味が取れないという指摘。 _(難しさ: eli5（前提から説明）と natural-japanese（日本語の不自然さ）が競合する。)_ |  |

