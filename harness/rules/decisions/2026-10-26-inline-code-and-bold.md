# 飾らずに書き、インラインコードと太字は意味のある場所にだけ使う

Status: accepted — 持ち主の裁定（2026-10-26）

rule: Write plain text by default; decoration goes only where it carries meaning. Use inline code only for what a reader types or a program reads — commands, flags, paths, config keys, function names, values to enter — never for product or tool names, ordinary words or numbers (the command `jig apply`, the tool jig). Do not bold for emphasis; say it in words, and bold only the one or two spots where a reader who skims past would come to harm. Never open list items with a bold label (`- **Label:** text`). Name a screen's buttons and menus in ［ ］.

## Problem

モデルが書く文章は、製品名、ファイル名、数字、普通の言葉にまでバッククォートを付け、箇条書きの頭や文の途中に太字を置いていた。書き手に意図の無い装飾は、読み手の目を散らし、モデルが生成した文章だと見分ける目印にもなる。それまでの決まりには、空白の扱い（2026-10-26-japanese-latin-spacing.md）はあったが、装飾をいつ使うかの決まりは無かった。

調査（`../research/2026-10-26-inline-code-and-bold.md`）で分かったことは次のとおり。

- インラインコードを、読み手が打つものとプログラムが読むものに付けることは、Google、Microsoft、GitHub、GitLab、Kubernetes、Docker、Appleのスタイルガイドで一致している。製品名やサービス名は、GoogleとDockerが明示して除いている。
- 強調のための太字は、Google、GitLab、Dockerが禁止し、GitHubは5語までなら認めている。英語のガイドの多数は、太字を画面のラベルに使う。日本語のガイドには太字の決まりが無く、JTFは画面の用語を［ ］で書く。
- 太字の使いすぎと、箇条書きの頭を太字の見出し語にする書き方は、AIの文章の目印として英語版Wikipedia、Anthropic、textlintの規則集が挙げている。インラインコードの付けすぎを目印とする証拠は無かったが、製品名や数字に付けることはどのガイドにも反する。
- 太字が読み取りを良くすることを、太字だけ変えて測った研究は無い。

## Decision

1. 基本は飾らずに書く。 装飾は、普通の文字では伝わらないことがあるときだけ付ける。コードコメントを、コードから読み取れない理由があるときだけ書くのと同じ考え方である。
2. インラインコードは、読み手が打つものとプログラムが読むものにだけ使う。 コマンド、フラグ、パス、設定のキー、関数名、入力する値がこれに当たる。製品名とツール名（jig、Slack、textlint）、普通の言葉、数字、件数は普通の文字で書く。同じ名前でも、打つコマンドとして書くとき（`jig apply`）だけコードの書式にする。
3. 強調は言葉で書く。 太字は、読み飛ばされると読み手が実害を受ける1〜2か所だけに付ける。取り返しのつかない操作の注意がその例である。
4. 箇条書きの頭を「太字: 説明」にしない。
5. 画面のボタンやメニューの名前は［ ］で書く。 JTFの決まりに合わせ、日本語の文に太字を混ぜない。
6. HTMLのページでも見た目を分ける。 インラインコードは等幅の文字と薄い背景で示し、太字は文字の太さだけで示して色や背景を付けない。`writeup-kit`の`writeup.css`はこの形になっている。
7. 既存の文書は一括では直さない。 どこを強調すべきかは場所ごとの判断なので、機械では直せない。製品名にバッククォートを付けた所と「太字: 説明」の箇条書きの数を数え、どこを手で直すかは持ち主が決める。

空白の決まり（2026-10-26-japanese-latin-spacing.md）の`rule:`行にあった例`` `jig`の設定 ``は、この決定と矛盾するので、`` `jig apply`を実行する ``に替えた。持ち主の許可による変更である（2026-10-26）。

## Alternatives considered

- 識別子に見えるものはすべてインラインコードにする: Google、Microsoft、Dockerが製品名を除いているので、どのガイドとも合わない。却下。
- 英語のガイドに合わせて画面のラベルを太字にする: 日本語の文で太字が増えると、強調との区別がつかなくなる。JTFの［ ］で同じ役目を果たせる。却下。
- 太字の量を数で決める（1,000字あたり何回まで、など）: 数の根拠になる測定が無い。GitHubの5語の上限は1か所の長さの決まりで、文書全体の量の決まりではない。却下。
- 既存の文書をtextlintで一括して直す: `textlint-rule-preset-ai-writing`は検出はできるが、どの太字を残すかは決められない。却下。

## Consequences

- `rules/common/90-writing.md`に、この記録の`rule:`行と同じ内容の行を足す。
- 太字の使いどころは書き手の判断に残る。検査が要るときは、`textlint-rule-preset-ai-writing`の`no-ai-list-formatting`と`no-ai-emphasis-patterns`で、頼まれたときに数える。hookでは走らせない（2026-10-19-plain-japanese-on-request.md）。
- 英語で書く文書（skill、エージェントの定義）にも同じ決まりが当てはまる。［ ］の決まりは日本語の文だけに当てはまる。

## Sources

- 調査記録: `../research/2026-10-26-inline-code-and-bold.md`
- Google, Code in text: https://developers.google.com/style/code-in-text
- Google, Text-formatting summary: https://developers.google.com/style/text-formatting
- Docker STYLE.md: https://raw.githubusercontent.com/docker/docs/main/STYLE.md
- Wikipedia, Signs of AI writing: https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
- JTF日本語標準スタイルガイド4.0: https://www.jtf.jp/pdf/jtf_style_guide.pdf
