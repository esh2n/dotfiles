# 日本語と英字・数字・インラインコードの間に空白を入れない。空白は意味のある場所にだけ残す

Status: accepted — 持ち主の裁定（2026-10-26）。2026-10-25-no-space-between-japanese-and-latin.mdを置き換える

rule: In any Japanese text you write, put no space between Japanese and Latin letters, digits or inline code (`skillを使う`, `2件`, `` `jig apply`を実行する ``). Keep a space only where it carries meaning: inside code blocks, in quoted text, and beside Markdown emphasis that would otherwise not render — and there first move the brackets outside the markers (`「**重要**」です`). A page you write sets `text-autospace: normal` on `body` for the visual gap.

## Problem

モデルが書く日本語は、`skill を使う`、`2 件`、`` `jig` の設定 ``のように、日本語と英字や数字の間に半角の空白を入れていた。この空白は、モデルが生成した文章だと見分ける目印になる。モデルが書いた文章は、持ち主の名前でチャット、PRの説明、チケット、メールなどに出ていく。

2026-10-25の決定記録は空白を入れないと決めたが、3つの点が足りなかった。1つ目は、空白を入れないことが業界で通っているやり方かを調べていなかったこと。2つ目は、空白を消すと表示が壊れる場所を調べていなかったこと。3つ目は、既存の文書をどうするかを、決定記録のDecisionの節を書き換えない決まりを理由に見送っていたことである。

調査（`../research/2026-10-26-japanese-latin-spacing.md`）で分かったことは次のとおり。

- 日本語の標準と組版の規格は、本文に空白を入れない側にある。JTF日本語標準スタイルガイド4.0は入れない。W3CのJLReqは和欧間の字間を組版で作る量として定め、CSSの`text-autospace`は本文を変えずに表示で字間を足す。textlintの空白規則は既定で入れず、Prettierは3.0で空白の自動挿入をやめた。入れる側にはMicrosoftの日本語スタイルガイドと、それに従うMDN・Vue・Reactの日本語版がある。
- インラインコードの決まりは、どの標準にも無い。textlintの既定とKubernetesの日本語版は、日本語の隣のコードを詰める。
- 空白を消すと、Markdownの強調が壊れる場所がある。GitHubでは、記号の内側が括弧や記号で始まるか終わる太字（`**「重要」**です`）は太字にならず、日本語の隣の`_x_`は斜体にならない。Slackの強調も、日本語の隣では効かないという報告がある。
- 打った空白は、ページ内検索やgrepで語句を探すときに見落としの原因になる。

## Decision

1. **本文に空白を入れない。** モデルが書く日本語のすべてで、日本語と英字、数字、インラインコードの間を詰めて書く。チャット、文書、PRの説明、チケット、メールなど、どこに出す文章かで分けない。
2. **空白は意味のある場所にだけ残す。** 意味のある場所は次の3つである。
   - コードブロックの中。
   - 引用した原文。規則の中で見せる悪い例もここに含む。
   - Markdownの強調の記号の隣で、空白を消すと強調にならない場所。ここではまず括弧を記号の外に出して`「**重要**」です`と書き、それができないときだけ空白を残す。日本語の隣では`_x_`を使わず`*x*`を使う。
3. **字間はCSSで付ける。** モデルが作るHTMLのページは、`body`に`text-autospace: normal`を指定する。`writeup-kit`の`writeup.css`にも入れる。
4. **dotfilesの既存の文書を一度だけ直す。** textlint 15.8.0と`textlint-rule-preset-ja-spacing`で、`ja-space-between-half-and-full-width`を`space: "never"`、`ja-space-around-code`を`before: false, after: false`にして直す。強調の規則（`ja-space-around-strong`、`ja-space-around-emphasis`）は使わない。直す前と後の文書をHTMLに変換して比べ、空白以外が変わっていないことを確かめる。
   - 範囲はMarkdownの文書（`.md`と`.mdx`）。調査記録（`rules/research/`）は14日で消えるので除く。テスト用のデータ、`terms.tsv`、悪い例を文字列として持つコードも、中身が検出用の例なので除く。
   - 受け入れ済みの決定記録も、空白を消すだけの変更なら直す。意味を変えないので、Decisionの節を書き換えない決まり（2026-09-22-decision-records.md）の例外として持ち主が認めた（2026-10-26）。それ以外の書き換えは、これまでどおり新しい記録で置き換える。

## Alternatives considered

- **空白を入れる今の書き方を続ける**: Microsoftの決まりとMDN・Vue・Reactの日本語版はこちらにある。しかし、日本語の標準と組版の規格は字間を表示で作る側にあり、打った空白は語句の検索で見落としを生む。表示の読みやすさは`text-autospace`で同じように得られる。却下。
- **出す先ごとに決める（SlackとPRの説明だけ詰める、など）**: 出す先は数が限られず、決まりが例外の一覧になる。どの出す先でも空白を消して困るのは強調の記号の周りだけなので、その場所だけを決める。却下。
- **インラインコードの前後だけ空白を残す**: どの標準にも決まりが無く、textlintの既定も詰める。Slackで崩れるかは確かめていないので、崩れると分かったら、その時点で出す先の例外として記録を足す。却下。
- **既存の文書は直さない**: 直さないと、モデルが既存の文書の書き方をまねて空白を入れ続ける。textlintは自動で直せ、変換したHTMLを比べれば壊れていないことを確かめられる。却下。
- **既存の文書を手で直す**: 2万か所を超え、手では漏れる。却下。

## Consequences

- `rules/common/90-writing.md`の行を、この記録の`rule:`行に合わせて直す。
- 調査記録の中の空白は残る。調査記録は14日で消え、知識へ昇格するときに書き直す。
- `text-autospace`に対応していないブラウザでは、字間は空かずに詰まって表示される。文字は変わらない。
- 日本語の直後にインラインの`<code>`が来るとき、要素の境目にも字間が入るかは確かめていない。
- textlintの修正は、太字やリンクの隣の空白を既定では残す。そこは強調の決まりに従って手で見る。

## Sources

- 調査記録: `../research/2026-10-26-japanese-latin-spacing.md`
- JTF日本語標準スタイルガイド4.0: https://www.jtf.jp/pdf/jtf_style_guide.pdf
- W3C JLReq: https://www.w3.org/TR/jlreq/#handling_of_western_text_in_japanese_text_using_proportional_western_fonts
- CSS Text Module Level 4: https://www.w3.org/TR/css-text-4/#text-autospace-property
- textlint-rule-preset-ja-spacing: https://github.com/textlint-ja/textlint-rule-preset-ja-spacing
- 強調の規則が太字を壊す件: https://github.com/textlint-ja/textlint-rule-preset-ja-spacing/issues/132
