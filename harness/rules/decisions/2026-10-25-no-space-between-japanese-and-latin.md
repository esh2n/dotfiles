# 日本語と英字・数字の間に空白を入れない

Status: accepted — 持ち主の裁定（2026-10-25）

rule: In Japanese text, put no space between Japanese and Latin letters, digits or inline code — in chat, PR descriptions, commit bodies, Slack drafts and documents alike; where a page needs the visual gap, its CSS adds it with `text-autospace`, and the text never carries it.

## Problem

モデルが書く日本語は、`skill を使う`、`2 件`、`` `jig` の設定 ``のように、日本語と英字や数字の間に半角の空白を入れていた。常時の書き方の決まり（`rules/common/90-writing.md`）にも、`plain-japanese`と`natural-japanese`にも、この空白についての決まりや検査はなかった。

空白を入れると画面では読みやすくなる。しかし、Slackの投稿やPRの説明文にこの空白があると、読む人はAIが生成した文章だと受け取る。読みやすさのための字間は、文字ではなく表示の側で付けられる。

## Decision

1. **本文に空白を入れない。** 日本語と英字、数字、インラインの`code`の間は詰めて書く。チャットの返答、PRの説明文、コミットの本文、Slackの下書き、文書のどれでも同じにする。決まりは`rules/common/90-writing.md`に1行で置き、毎回読み込まれるようにする。
2. **字間はCSSで付ける。** Artifactや`writeup`のページで字間が要るときは、CSSの`text-autospace`で表示の上だけ空ける。`writeup-kit`の`writeup.css`の`body`に入れる。

## Alternatives considered

- **`plain-japanese`の検査に足すだけにする**: `plain-japanese`は頼まれたときだけ使う決まり（2026-10-19-plain-japanese-on-request.md）なので、ふだんの返答や文書には効かない。却下。
- **空白を入れる今の書き方を続ける**: 画面では読みやすいが、SlackやPRの説明文ではAIが書いた文章に見える。字間は表示の側で付けられるので、本文に入れる理由がない。却下。

## Consequences

- 2026-10-25より前に入った決定記録や文書には空白が残っている。受け入れ済みの決定記録のDecisionの節は書き換えない決まりなので、まとめて直すことはしない。
- `text-autospace: normal`は、日本語の文字と英字・数字の間に表示の上だけ字間を足す。初期値は`no-autospace`なので、CSSで指定しないと効かない。対応はChromeとEdgeが140、Safariが18.4、Firefoxが145から。値は`normal`だけを使う。`ideograph-alpha`などの個別の値は、Chromeが対応していない。
- 対応していないブラウザでは、字間は空かずに詰まって表示される。文字は変わらない。
- 日本語の直後にインラインの`<code>`が来るとき、要素の境目にも字間が入るかは確かめていない。

## Sources

- MDN `text-autospace`: https://developer.mozilla.org/en-US/docs/Web/CSS/text-autospace
- MDNの対応表のデータ: https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/text-autospace.json
- CSS Text Module Level 4: https://www.w3.org/TR/css-text-4/#text-autospace-property
