# 日本語の文章はnatural-japaneseの上に薄いplain-japaneseを載せて書く。用語は残してその場で説明し、比喩・内輪の呼び名・記号の省略を使わない

Status: superseded — 2026-10-19-plain-japanese-on-request.mdが置き換える（盲検の判定で採用の基準に届かず、plain-japaneseは頼まれたときだけ使う。書き方の決まりとterms.tsvは引き継ぐ）。もとの裁定は2026-10-19

rule: Write Japanese documents and chat replies with the `plain-japanese` skill layered on `natural-japanese`: keep technical terms and explain each at its first use in the same or the next sentence, never in a glossary or prerequisites block; no analogies, metaphors or personification; no names coined in the conversation or repository and no ordinary words with an in-house meaning (`terms.tsv`, plus a project's `.plain-japanese/terms.tsv`); no verbless fragments or symbol-speak; conclusion first; when asking again, restate the background, options and recommendation; a rewrite adds no facts, rankings, numbers or certainty, checked with `diff_content.py`. The checks list suspects for the writer to judge and are never run from a hook.

## Problem

アシスタントの日本語の返答と文書に、読み手がつまずく書き方が繰り返し出ていた。

- このリポジトリの中だけで通じる呼び名（ハーネス一式を指す「家」、guard-rules.jsonのfloor節を指す「床」、並列の担当を指す「レーン」、観点を指す「考え方の型」）が、説明なしに使われた。
- 「6本。」のような述語のない文、「／」「→」で語を並べる書き方、「一般原則：」のようなラベルとコロンが混ざった。
- 「静かに壊れる」「時間を溶かす」「重心を移す」のような、中身の見えない比喩が使われた。
- 何度かやり取りしたあとに同じ質問をし直すとき、前の会話を読んでいないと答えられない形で聞いた。

既存のnatural-japanese（上流v1.6.0）は、結論を先に書く、元にない内容を足さない、段落ごとに読み手が取れない言い回しを書き出す、といった手順を持つ。ただし見本で確かめると、そのlintは内輪の呼び名を含む返答にも比喩の段落にも0件だった。`terms.py`が拾うのはカタカナ語・英字・固有名詞だけで、漢字1字の普通の語を別の意味で使う呼び名は拾えない。チャットの返答は対象に入っておらず、lintはファイルしか読まない。

## Decision

1. **natural-japaneseは置き換えず、その上に`harness/skills/plain-japanese/`を載せる。** natural-japaneseは上流に追従し続け、plain-japaneseはnatural-japaneseの規則を書き直さない。食い違ったときは、技術文についてはplain-japaneseの用語・比喩・圧縮の規則を優先する。
2. **書き方の規則。**
   - 専門用語は残し、初出の同じ文か次の文で、何をするものかを説明する。冒頭の用語集や前提の節には置かない。言い換えると意味が変わるときは、語を替えず文を分ける。易しくしすぎない。
   - たとえ話・比喩・擬人化で説明しない。誰が何をするかを字義どおりに書く。
   - 会話やリポジトリの中で作った呼び名、普通の語に内輪の意味を持たせた呼び名を使わない。実際のファイル名・コマンド名・道具の名前を使うか、初出で意味を言う。
   - 述語のない断片、文中の「／」「→」「＝」、「ラベル：」で始まる行を使わない。これは、Cursorが公開しているskillのパックであるpstackのunslop規則33とtechnical-writingを、日本語に移した規則である。
   - 結論を先に書き、必要なことを全部書き、同じことを二度書かない。
   - 図は流れ・構造・依存をまとめるときに使い、具体例と組にして行き来する。節に「抽象」「具体」と見出しを付けない。図の型はwriteup-kitの規則を参照し、加えて図には題・凡例・線のラベルを付け、略語は図の中で説明する。
   - チャットでも同じ。読み手は前の会話を読んでいない前提で書き、質問をし直すときは背景・選択肢・推奨をその返答の中で言い直す。
   - 書き直しでは、元にない事実・順位・数値・確信の強さを足さない。
3. **内輪の呼び名の表`terms.tsv`を持つ。** 列はterm・refers_to・class・use_instead・gloss・sourceと任意のpattern。classは文化庁「公用文作成の考え方」の扱いの分け方に合わせてkeep・keep+gloss・replace・avoidの4つにする。初期の行は、このリポジトリの返答や決定メモに実際に出た語から取った。プロジェクトごとの表は`.plain-japanese/terms.tsv`（環境変数と`--terms`でも渡せる）で足し、同じ語の行を置き換え、`off`で既定の行を外す。
4. **検査スクリプトを4つ持つ。** どれもPythonの標準ライブラリだけで動き、ファイルか標準入力を読むので、チャットの返答の下書きにも当てられる。用語（replace・avoidの語と、説明の無いkeep+glossの語の初出）、比喩（yomiyasuから取った比喩動詞と比喩の語の一覧、説明のためのたとえの印）、圧縮表現（述語のない断片、記号、ラベルとコロン）、書き直しの差分（足した・消した内容語、数値、否定、確信・順位・範囲の語、「一つずつ」のような副詞句）。検査は疑わしい箇所を並べるだけで、直すかは書き手が決める。
5. **手順は5段にする。** 規則に沿って書き、natural-japaneseのlintと段落ごとの確かめを行い、plain-japaneseの検査を走らせ、指摘を直し、書き直しのときは最後に差分の検査をする。skillが自動で読まれないこともあるので、チャットの返答にも当てる数行を`rules/common/90-writing.md`に常時の規則として置く。
6. **評価は持ち主の盲検のA/Bで行う。** 18題（日本語の技術文書6、日本語のチャットの返答6、調査メモ3、英語3）を、事実の一覧つきで`evals/items/`に置く。7つの観点で持ち主が判定し、モデルの判定は一致率の参考にとどめる。手順は`references/evaluation-plan.md`。

## Alternatives considered

- **yomiyasuをそのまま入れる。** 比喩動詞の機械検出は候補の中でいちばん広いが、見本の比喩5か所のうち「潰していく」「重心を移す」を拾わなかった。書き直しの差分は、足された「一つずつ」を元にない語として出さなかった。内輪の呼び名を拾う規則が無い。SKILL.mdが111 KBあり、作者自身が他の日本語校正skillとの併用で指示が食い違うと書いている。名前を出して頼まれたときだけ動くので、常に当てる使い方に向かない。却下。比喩の語の一覧だけをMITの表示つきで取り込んだ。
- **natural-japaneseだけを使う。** 上流v1.6.0の段落ごとの確かめは最も近いが、見本の内輪の呼び名・断片・比喩はlintで0件で、拾えるかはモデルが全段落の書き出しを手を抜かずに行うかに頼る。内輪の呼び名の表、比喩で説明すること自体の禁止、記号の省略の規則、チャットの返答への適用が無い。却下。
- **全部を自前で書く。** natural-japaneseのlintはSudachiによる形態素解析と、コーパスで決めた閾値を持ち、上流で保守されている。書き直すと上流の改善を追えなくなる。却下。足りない部分だけを自前で足す。
- **textlint-rule-preset-ja-technical-writingを検査に使う。** 見本の内輪の呼び名・比喩を1件も拾わず、用語を使う場所で説明した技術の段落に3件の誤検出（算用数字、助詞「でも」の重複、文長105字）を出した。却下。
- **stop-ai-slop-jpを使う。** 対象はエッセイやブログで、伝聞を混ぜる、文末をばらけさせる、誤字を残す、といった規則は技術文とチャットの返答の正しい断定を崩す。検出の仕組みが無く、語の一覧も見本の比喩を含まない。却下。

## Consequences

- 検査はフックに入れない（`2026-09-22-hooks-five-events.md`がフックを5本に固定している）。書き手が手順の中で走らせる。
- writeup-kitも同じ日に、冒頭の用語ブロック（`.wu-terms`）をやめ、初出の場所で説明する形にそろえた（`references/writing.md` §5）。
- `terms.tsv`に無い呼び名と、`data/metaphors.tsv`に無い比喩は、検査では見つからない。新しい呼び名に気づいたら、表への追加を返答で提案する（表を勝手に書き換えない）。
- 評価はまだ行っていない。18題の事実の一覧は作ったが、出力の生成と持ち主の判定はこれからで、採用を既定にするかは評価の結果で決める。
- 用語集を冒頭に置く方式と、使う場所で説明する方式の理解度を比べた研究は見つからなかった。この規則を支えるのは文体の指針と間接の証拠である。

## Sources

- coji/natural-japanese（v1.6.0）: https://github.com/coji/natural-japanese
- nanaism/yomiyasu（v2.0.2、コミット79d15a6）: https://github.com/nanaism/yomiyasu
- textlint-rule-preset-ja-technical-writing: https://github.com/textlint-ja/textlint-rule-preset-ja-technical-writing
- iKora128/stop-ai-slop-jp: https://github.com/iKora128/stop-ai-slop-jp
- docwriter-org/plain-writing-skill（規則2・14・21、deslopify）: https://github.com/docwriter-org/plain-writing-skill
- 文化庁「公用文作成の考え方」（2022年建議）: https://www.bunka.go.jp/seisaku/bunkashingikai/kokugo/hokoku/pdf/93651301_01.pdf
- plainlanguage.govのガイドライン: https://github.com/GSA/plainlanguage.gov/tree/main/_pages/guidelines
- GOV.UKの文体ガイド: https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/
- Google開発者向け文体ガイド: https://developers.google.com/style/tone
- C4モデルの図の記法: https://c4model.com/diagrams/notation
- blader/humanizer issue 229（語彙の癖を消すとリズムの癖が増える）: https://github.com/blader/humanizer/issues/229
- pstackのunslopとtechnical-writing: cursor/pluginsのpstack（MIT）
