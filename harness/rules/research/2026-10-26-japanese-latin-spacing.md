---
question: "日本語の文で、日本語と英字・数字・インラインコードの間に半角の空白を入れるのは受け入れられたやり方か。入れない場合、Markdownの表示で何が壊れ、既存の文書はどう直せるか"
date: 2026-10-26
verdict: "業界は割れているが、日本語の標準と組版の規格は『本文に空白を入れない』側にある。JTF日本語標準スタイルガイド4.0は入れない（v1.1から同じ）、Microsoftの日本語スタイルガイドは入れる（MDN・Vue・Reactの日本語版はこれに従う）。W3CのJLReqは和欧間を組版で作る四分アキと定め、CSSの`text-autospace`は表示だけで1/8文字分を足しコピーした本文に影響させない。textlintの空白規則は既定で入れない、Prettierは3.0で空白の自動挿入をやめた。インラインコードについての規則はどの標準にも無く、textlintの既定は前後とも詰める。空白を消すと壊れるのはMarkdownの強調で、GitHubでは記号の内側が括弧や記号で始まるか終わる太字（`**「重要」**です`）と、日本語の隣の`_x_`が効かない。Slackの`*x*`も日本語の隣で効かないという報告が4件ある（公式の記述は無い）。既存文書の一括修正にはtextlintのpreset-ja-spacingが使えるが、強調の規則は太字を壊すので使わない"
unverified:
  - "Slackでインラインコードが日本語に接したとき崩れるかは確かめていない"
  - "Slackの強調が日本語の隣で効かないことは第三者の報告4件だけで、Slackの公式文書に記述が無い"
  - "Backlogの記法の扱いは公式ページに注意書きが無く、記法のページには届かなかった"
  - "読みやすさを、打った空白と表示で作る字間で比べた測定は見つからなかった"
  - "2019年のTwitter投票（約6,800票、約60%が入れない）はjsakamoto氏のブログ経由で、原典は読んでいない"
  - "日本語の直後にインラインの`<code>`が来るとき、`text-autospace`が要素の境目にも字間を入れるかは確かめていない"
  - "2万か所規模でtextlintの自動修正を走らせた公開の記録は無い"
sources_note: "URLs and quotes are inside the record."
---

# 日本語と英字・数字の間の空白

調査日: 2026-10-26（調べたのは2026-10-25）

調べ方は2つに分けた。1つは表示とツールの調査で、CommonMarkとGitHubでの表示、Slack、Backlog、既存の文書を直すツールを調べた。もう1つは書き方の決まりの調査で、スタイルガイド、組版の規格、実践者、リポジトリの決まりを調べた。

## 結論

1. **本文に空白を入れない側に、日本語の標準と組版の規格がある。** 入れる側の大きな文書（Microsoft Learn、MDN、Vue、React）は、Microsoftの決まりを引き継いでいる。
2. **字間は表示で作る。** JLReqは四分アキを組版の量として定め、CSSの`text-autospace`は本文を変えずに字間を足す。ただし3つのブラウザとも初期値が字間なしなので、ページのCSSで指定しないと効かない。
3. **インラインコードには規則が無い。** textlintの既定とKubernetesの日本語版の書き方は、どちらも日本語の隣を詰める。
4. **空白に意味があるのは強調の記号の周りだけ。** 内側が括弧や記号で始まるか終わる太字は、空白を消すとGitHubで太字にならない。括弧を記号の外に出せば、空白なしで太字になる。
5. **打った空白には実害が1つ報告されている。** ページ内検索やgrepで「IPアドレス」と探すと、「IP アドレス」が見つからない。

## 書き方の決まり

| 出どころ | 日本語と英字・数字の間 | 根拠 |
|---|---|---|
| JTF日本語標準スタイルガイド4.0（2026-07-25） | 入れない | §2.3.1.1 |
| Microsoft Japanese Localization Style Guide | 入れる | §4.1.11 |
| W3C JLReq | 組版で四分アキを作る | §3.2 |
| CSS Text Level 4 `text-autospace` | 表示で1/8文字分を足す | §8.4 |
| Appleの日本語スタイルガイド | 公開されていない | — |

- **JTF 4.0**: https://www.jtf.jp/pdf/jtf_style_guide.pdf の§2.3.1.1（29ページ）は「原則として、全角文字と半角文字の間にスペースを入れません。」と書く。注記に「環境によってはスペースが存在するように見えることがあります…実際には、そのような箇所にスペースは存在しません。」とある。v1.1（2012年12月改訂）の§3.1.1にも同じ決まりがあり、v3.0は節を移しただけだった。CSSWGのissue #12386にある「3.0でスペースを除いた」という記述は、改訂履歴と合わない。インラインコードの決まりは無い。
- **Microsoft**: https://download.microsoft.com/download/a/8/2/a822a118-18d4-4429-b857-1b65ab388315/jpn-jpn-StyleGuide.pdf の§4.1.11（32ページ）は「In principle, insert a half-width space.」と書く。句読点、括弧、かぎ括弧、スラッシュの隣は除く。インラインコードの決まりは無い。
- **JLReq**: https://www.w3.org/TR/jlreq/#handling_of_western_text_in_japanese_text_using_proportional_western_fonts は「quarter em spacing」と書き、詰めて組む例の図には「(This method is not recommended)」とある。本文に空白文字を打つ指示は無い。打った半角空白は欧文間隔で、三分アキ（1/3文字分）になり、四分アキと幅が合わない。
- **CSS Text 4**: https://www.w3.org/TR/css-text-4/#text-autospace-property は「This property has no effect on the underlying content, and must not affect the content of a plain text copy & paste operation.」と書く。字間は「1/8 of the CJK advance measure」。対応はChrome 140、Firefox 145、Safari 18.4で、3つとも初期値が`no-autospace`（https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/text-autospace.json）。CSSWGは2025-12-10に初期値を`normal`にすると決めたが、出荷中のブラウザはまだ変えていない（https://github.com/w3c/csswg-drafts/issues/12386 、未解決）。

## 実践者

- **Koji Ishii（Chromeの開発者）**は、CSSWGのissue #12386で、新しいものほど空白を入れない人が増えていると書いた。
- **Florian Rivoal（CSSWG）**は同じissueで、日本語のWikipedia、朝日新聞、日経新聞、東京大学、慶應義塾大学のサイトは空白を打っていないと書いた。
- **fantasai（CSSWG）**は、日本語の書き手が空白を打たないのは、英語の書き手が曲がった引用符を打たないのと同じ理由で、表示で自動で付くことを望んでいると書いた。
- **tats-u（Prettier 3.0の日本語・中国語まわりの変更の作者）**は https://github.com/tats-u/prettier-plugin-md-nocjsp で「inserting spaces (but not U+0020 itself) is the job of viewers and such, not formatters like Prettier」と書く。理由は、打った空白の幅がJLReqの幅と違うことと、意図した空白と紛れ込んだ空白をツールが見分けられず元に戻せないこと。
- **june29（Scrapboxで日記を書く開発者）**は https://scrapbox.io/june29/ で、見た目を文字で制御するのは全角スペースで字下げをそろえるのと同じだと書く。空白なしで出した原稿に、雑誌の組版が字間を入れたことも書いている。
- **debiru（MDNとAstroの日本語版の翻訳者）**は https://qiita.com/debiru/items/1b4a5aa73fe5c952e104 で、MDNの決まりは強すぎると書き、「2008 年」と書くと語句の検索に掛からないことを挙げる。
- **komitake**は https://qiita.com/komitake/items/a1b164a4a7f99ec3ba77 で、「IPアドレス」をページ内検索した数を比べた。AWS、Azure、Google Cloudの文書は空白なしで0件、空白ありで4件、16件、63件だった。Wikipediaは逆で、空白なしが21件、空白ありが1件だった。
- **DTP Transit**は https://www.dtp-transit.jp/misc/writing/post_664.html で、寄稿者に空白を入れないよう求め、和欧間のアキはアプリケーションの設定で作ると書く。
- **入れる側**: jsakamoto氏（devadjust.exblog.jp、2023年）はHTMLでは空白を入れてよいと書き、Google Store、MDN、React、Vue、Microsoft Learnが入れていると挙げる。taheiNNotes（https://tahein.com/20260222-halfwidth-space-trend ）はMicrosoftの決まりを採った。中国語ではpangu.js（https://github.com/vinta/pangu.js ）が空白を入れる伝統の側にある。

## リポジトリと公開ページ

| リポジトリ | 決まり | 根拠 |
|---|---|---|
| MDNの日本語版（mdn/translated-content） | 入れる | https://raw.githubusercontent.com/wiki/mozilla-japan/translation/Editorial-Guideline.md 「Microsoft のドキュメントも同じルールを採用している」 |
| Vueの日本語版（vuejs-translations/docs-ja） | 入れる | `.github/CONTRIBUTING.md` |
| Reactの日本語版（reactjs/ja.react.dev） | 入れる | JTFの規則3.1.1を切り、独自の規則で空白を求める（`textlint/jp-reactjs-org-lint.js`） |
| Kubernetesの日本語版（kubernetes/website） | 入れない | `content/ja/docs/contribute/localization.md`「英単語と日本語の間に半角スペースは不要」 |

公開ページの境目を数えると（空白なし／空白あり）、日本語のWikipediaのDNSのページは252／19、Kubernetesの概要は459／2、apple.com/jpのiPhoneのページは237／0、Microsoft LearnのVNetの概要は0／113、Google Cloud Armorは5／487だった。インラインコードの境目も、どのサイトも地の文と同じ扱いで、コードだけ別の決まりにしているサイトは無かった。数え方は粗く、方向を見るためのものである。

## ツール

- **textlintの空白規則**（https://github.com/textlint-ja/textlint-rule-preset-ja-spacing 、2026-10-16〜22の週に28,212ダウンロード）: `ja-space-between-half-and-full-width`の既定は`"never"`で、READMEは「デフォルトでは、半角文字と全角文字の間にスペースを入れません。」と書く。`ja-space-around-code`は`before`と`after`の既定が`false`で、日本語の隣のコードを詰める。どちらも`--fix`で直せる。
  - コードブロック、インデントしたコード、HTMLコメント、URLには触れない。見本で2回走らせても2回目は何も変えなかった。
  - `lintStyledNode: true`にすると、見出し、表、リンクの文字も直す。
  - `ja-space-around-strong`と`ja-space-around-emphasis`は、修正で太字を黙って壊す（https://github.com/textlint-ja/textlint-rule-preset-ja-spacing/issues/132 ）。修正後の構文を確かめる提案（https://github.com/textlint/textlint/issues/2114 ）は取り込まれていない。
- **Prettier 3.0**（2023-07-05）は、日本語や中国語と英字の間に空白を入れるのをやめた。リリースノートは「it isn't standard, and is in fact contrary to official guidelines」と書き、決まりを強制するにはtextlint-jaなどを使うよう案内する。既存の空白は残す。ツールの既定が逆向きに変わった例はこれだけだった。

## Markdownの表示

- **CommonMark**（https://spec.commonmark.org/0.31.2/ ）の強調は、記号の前後の文字の種類で開き・閉じが決まる（flanking）。インラインコードはこの規則の影響を受けない。日本語向けの修正案（https://github.com/commonmark/commonmark-spec/issues/650 ）は2020年から未解決。
- **GitHubで20の文字列を表示して確かめた（2026-10-25）。** 空白なしで正しく表示されたのは、`日本語**bold**日本語`、`*em*`、`~~del~~`、`` `code` ``。空白を消すと壊れたのは、`**「重要」**です`、`` **`x`**です ``、`**foo:**です`、`**foo(bar)**です`。`_x_`は日本語の隣では常に効かない。
- **GitHubは日本語向けの拡張を入れていない。** https://github.com/tats-u/markdown-cjk-friendly はmarkdown-it、remark、VitePress、Docusaurusなどが取り込んでいる。
- **Slack**: 公式文書に記述が無い。https://zenn.dev/elements/articles/a86509157c243a 、https://github.com/maepon/issue-to-pr-flow/issues/24 、https://www.obsidianstats.com/plugins/slack-flavor 、マネーフォワードの記事の4件が、`*x*`、`_x_`、`~x~`は記号の外側に空白か半角の記号が要ると書く。
- **Backlog**: https://backlog.com/ja/enterprise-help/userguide/userguide1666/ に注意書きは無く、例は空白入りで書かれている。記法のページには届かなかった。

## 見つからなかったもの

- 日本語の隣のインラインコードについての、スタイルガイドの決まり。
- Googleの日本語の開発者向けスタイルガイドと、Appleの公開スタイルガイド。
- 打った空白と表示で作る字間の読みやすさを比べた測定。
- `text-autospace`を採って打った空白を消したことを決まりとして書いているリポジトリ。
- 大きな日本語の文書のリポジトリが、空白を入れる決まりを採ってから取り消した例。
