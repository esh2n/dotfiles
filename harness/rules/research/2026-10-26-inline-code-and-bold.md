---
question: "文章の中でインラインコードと太字をいつ使い、いつ使わないのが受け入れられたやり方か。何にでも付ける書き方は、AIが書いた文章の目印になるか"
date: 2026-10-26
verdict: "インラインコードは、読み手が打つものとプログラムが読むもの（コマンド、パス、設定のキー、関数名、入力する値）にだけ付けるのが、Google・Microsoft・GitHub・GitLab・Kubernetes・Docker・Appleで一致したやり方で、製品名やサービス名はGoogleとDockerが明示して除き、Microsoftの表にも無い。太字は画面のラベルに使うのが英語のガイドの多数で、強調の太字はGoogle・GitLab・Dockerが禁止、GitHubが5語までなら認める。日本語のガイドに太字の決まりは無く、JTFは画面の用語を［ ］、強調を「」で書く。太字の使いすぎと『太字の見出し語＋コロン』の箇条書きはAIの文章の目印として挙げられ（Wikipedia、Anthropic自身、textlintのai-writing）、検出ツールの会社の数では1万語あたり人2回・AI 65回。インラインコードの付けすぎを目印とする測定や実践者の声は見つからなかった。太字が読み取りを良くすることを太字だけ変えて測った研究も無い"
unverified:
  - "Pangramの数（1万語あたり太字が人2回・AI 65回、インラインコードが人0.2回・AI 0.8回）はコーパスが公開されておらず、言語・件数・文書の種類も書かれていない"
  - "Freeburg（arXiv 2603.27006）のモデル別のMarkdownの量は要約経由で読んだ。人の基準値はMarkdownについて無い"
  - "井本賢氏の日本語の分析（箇条書きの記号でd +1.00）は査読前で、会社のブログ経由でしか読めていない"
  - "PRの説明、コミットメッセージ、Slackで、装飾の量を人とAIで比べた測定は見つからなかった"
  - "日本語の企業のスタイルガイド（サイボウズ、freee、SmartHR、メルカリ、LINE）とIBM、Atlassianのガイドには届かなかった"
sources_note: "URLs and quotes are inside the record."
---

# インラインコードと太字の使い分け

調査日: 2026-10-26

調べ方は2つに分けた。1つはスタイルガイド、lint、公開リポジトリの決まりで、もう1つは実践者の声、ベンダーの指針、測定、反対の証拠である。空白の扱いは`2026-10-26-japanese-latin-spacing.md`で調べたので、ここでは扱わない。

## 結論

1. インラインコードは、読み手がそのまま打つものとプログラムが読むものにだけ付ける。ここは英語の主なガイドがすべて一致している。製品名、サービス名、ドメイン名、ブラウザで開くURLは普通の文字で書く。
2. 太字は、英語のガイドの多数が画面のラベル（押すボタンや選ぶメニューの名前）に限っている。強調のための太字は意見が割れ、禁止する側（Google、GitLab、Docker）が多い。
3. 日本語のガイドには、インラインコードにも太字にも決まりがほとんど無い。JTFは画面の用語を［ ］、強調を「」で書く。
4. 太字の使いすぎと、箇条書きの頭を太字の見出し語にする書き方は、AIの文章の目印として複数の出どころが挙げる。インラインコードの付けすぎについては、目印だとする出どころが見つからなかった。
5. 太字が読み取りを良くすることを、太字だけ変えて測った研究は見つからなかった。

## スタイルガイド

- Google（https://developers.google.com/style/code-in-text 、2026-10-09更新）は「use code font to mark up most things that have anything to do with code」と書き、理由に「Signals to your reader that the text is meant to be entered verbatim」と「Shows where the boundaries of the text to enter are」を挙げる。普通の文字で書くものの表に「Names of products, services, and organizations」とドメイン名、ブラウザで開くURLがある。コマンドと製品が同じ名前のときは「use code font for the command and ordinary font for the name of the project or product」と書き、例は「Invoke the GCC 8.3 compiler using `gcc`」。太字は https://developers.google.com/style/text-formatting で「only for UI elements and run-in headings」とし、強調は「usually, your words can carry the emphasis without adding italics」と書く。
- Microsoft（https://learn.microsoft.com/en-us/style-guide/developer-content/formatting-developer-text-elements ）は「In general, use code style for programmatic or code-related elements」と書く。製品名はコードの書式の表に無い。画面の名前は太字にする。公開されているGitHubの写し（MicrosoftDocs/microsoft-style-guide、2024年に保存のみの状態になった）はコマンドやクラス名を太字にする古い決まりのままで、現行の決まりと逆である。 https://learn.microsoft.com/en-us/contribute/content/code-in-docs は、コードの書式が多すぎて読みにくい表では太字を使ってよいと書く。
- GitHub Docs（`content/contributing/style-guide-and-content-model/style-guide.md`）は「Use emphasis sparingly (no more than five contiguous words)」と書く。数で上限を決めているのはこのガイドだけだった。「do not use bolding as the only way to convey meaning or emphasis」とも書く。ファイル名とコマンドはインラインコードにする。
- GitLab（`doc/development/documentation/styleguide/_index.md`）は「Do not use bold for keywords or emphasis」と書き、Valeの規則`BoldEmphasis`で強調の太字をエラーにしている。箇条書きでも「Do not use bold formatting to define keywords or concepts in a list」と書く。
- Docker（https://raw.githubusercontent.com/docker/docs/main/STYLE.md ）は「Use bold **only** for UI elements」「Never use bold for emphasis, product names, or feature names」と書き、「Don't use "**Bold:** format" for subsection labels」とも書く。
- Kubernetes（英語のスタイルガイド）は、ファイル名、フィールド名、コマンドの名前をコードの書式にし、StatefulSetなどのAPIの種類と文字列や数の値は普通の文字で書く。画面の名前は太字、新しい用語は斜体にする。
- Apple（https://support.apple.com/guide/applestyleguide/code-font-in-text-apsg1fde73a3/web ）は、開発者向けの文書以外でコードの書式を使うかは「a matter of judgment」と書く。太字の決まりは無く、ボタンの名前は大文字の書き方か引用符で示す。
- JTF 4.0（https://www.jtf.jp/pdf/jtf_style_guide.pdf 、34〜35ページ）は、［ ］を「コンピューターの画面用語（UI）などの特殊な表記」に、「」を「引用、参照先、入力する文字を示す場合、語句を強調する場合」に使うと書く。太字とコードの書式の決まりは無い。
- Deep Insider（https://deepinsider.jp/about/styleguide ）は、クラス名などのコードに関係する語をcodeタグで囲み、入力する値は太字で書く。画面の項目は［ ］にする。
- デジタル庁デザインシステム（https://design.digital.go.jp/dads/foundations/typography/ ）は、等幅の文字をコードの内容に使う前提とし、日本語の斜体は避けるよう書く。

## lint

- markdownlintには、太字を見出しの代わりに使うことを検出する規則（MD036）はあるが、太字やインラインコードの量を制限する規則は無い。
- ValeのGoogleとMicrosoftの規則集は、太字とコードの書式の決まりを検査していない（規則集の対応表で`text-formatting: false`）。
- textlintの`textlint-rule-preset-ai-writing`（https://github.com/textlint-ja/textlint-rule-preset-ai-writing ）は、`- **重要**: …`の形の箇条書きと、`これは**非常に**重要`のような強調の太字を、既定で検出する。インラインコードの規則は無い。

## AIの文章の目印としての装飾

- 英語版Wikipediaの「Signs of AI writing」（https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing ）は「Overuse of boldface」と「Inline-header vertical lists」を挙げ、太字の使いすぎはREADMEやスライドなど人の書いた資料から引き継いだ癖だと書く。同じページは、これらを規則ではなく観察だとしている。バッククォートの付けすぎは載っていない。
- Anthropicの文書（https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1 ）は「Earlier models overused bullets and bold in chat」と書く。指示の書き方の文書は、Markdownをインラインコード、コードブロック、簡単な見出しに絞り、太字と斜体を避ける指示の例を載せている。
- OpenAIのGPT-5の指示の書き方の文書は「Use Markdown **only where semantically correct**」とし、ファイル名や関数名をバッククォートで書くよう勧める。
- 検出ツールの会社Pangram（https://www.pangram.com/ja/signs-of-ai-writing ）の数は、1万語あたり太字が人2回・AI 65回、箇条書きが人3回・AI 28回、インラインコードが人0.2回・AI 0.8回。コーパスは公開されていない。
- Freeburg（https://arxiv.org/abs/2603.27006 ）は12のモデルで、2024年ごろのモデルが1,000語あたり5〜6個のMarkdownの装飾を出し、新しいモデルは0〜1個だったと報告する。散文で書く指示を付けると、ほぼすべてのモデルで0になった。
- coji/natural-japanese（https://github.com/coji/natural-japanese ）は、SKILL.mdで太字を本当に目立たせたい箇所だけに使うよう書き、「太字: 説明」の箇条書きをAIの文書の典型的な見た目として避けるよう書く。一方、同じリポジトリのlint（`scripts/lint.py`）は行頭の「**ラベル**:」を探す目印として残してよいとしていて、食い違う。lintのコーパスでは、文中の太字が多い文書の割合が、生成AI以前のQiita（2022年）と生成した記事でどちらも6%で、区別できなかった。

## 反対の証拠

- NN/g（https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/ ）の拾い読みしやすい版は、使いやすさの点数が147（元の版が100）だった。ただし太字のほかに箇条書きや見出しなど5つを同時に変えていて、太字だけの効果は分からない。記憶の点数は良くならなかった。
- スクリーンリーダーは、太字や強調の意味をほとんど読み上げない（https://www.tpgi.com/screen-readers-support-for-text-level-html-semantics ）。NVDAは読み上げを入れたあと、強調が使われすぎているという苦情で戻した。
- 識別子をバッククォートで書くことは、ベンダー（OpenAI）とスタイルガイドが勧めている。付けすぎの問題は、識別子でないもの（製品名、普通の言葉、数字）に付けることにある。

## コードコメントとの比較

OusterhoutとRobert Martinの議論（https://github.com/johnousterhout/aposd-vs-clean-code ）は、意見の違う2人が「We agree that implementation code only needs comments when the code is nonobvious」で一致している。装飾も、普通の文字では伝わらないことがあるときだけ付けるという点で同じ形になる。

## 見つからなかったもの

- インラインコードの付けすぎをAIの文章の目印とする実践者の声と測定。
- 太字だけを変えて読み取りへの効果を測った研究。
- PRの説明、コミットメッセージ、Slackでの装飾の量を人とAIで比べた測定。
- 日本語のガイドでの、太字の量やインラインコードの使い道の決まり。
