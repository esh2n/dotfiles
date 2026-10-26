# 記録はMarkdownを元にしてgitに置き、人向けのviewは二回ビルドで作り、文章は検査表で書く

Status: accepted — 記録の元をMarkdownにするのは業界の収束と一致し、非公開の出し分けは添付の漏れが構造的なのでビルドを分け、記法はCommonMark互換でlintを通す（2026-09-22）

rule: Write all records (research, decisions, work notes) as Markdown in git, never hand-written HTML; check rules/research/INDEX.md before researching so established facts aren't re-researched. Build human-facing views twice from the same Markdown — a private site with everything and a public site selecting only publish: true records at the source — using CommonMark notation only (> [!type], :::name), never JSX.
scope: repo

## Problem

writeup（セッションの調査・判断・勉強の記録を文書にして残し、人に見せる仕組み）の三つの動機に応える。(1) 過去の調査を次のセッションが見つけて再調査しない。(2) 勉強や作業の記録を、スマホでも読める人向けのviewで残し、一件ずつ公開できる。(3) AIの書く説明が分かりにくい（自己評価20/100）。いまのwriteupはHTMLを`wu-*`部品で直接書き、`~/.local/share/writeup/{private,work}`のローカルgitに貯め、claude.ai Artifact等へpublishする。

## Decision

- **元はMarkdown、HTMLは生成物。** 三種の記録（調査記録、決定記録、勉強・作業の記録）は全部Markdownをgitに置く。writeup-kitのHTML直書きの経路は廃止し、`wu-*`のCSSと部品定義だけを引き継ぐ。
- **調査記録はharnessのrepoに置き、索引で再調査を防ぐ。** `harness/rules/research/<date>-<topic>.md`、先頭に「問い / 日付 / 結論一行 / 検証できなかったこと」。索引`rules/research/INDEX.md`（一行一記録、200行を超えたら分割）を生成するAGENTS.mdから「調べる前に索引を読め。確立済みの事実は再調査しない」で指す。参照は番号IDでなくパスとURL。
- **人向けのviewは同じMarkdownから二回ビルドする。** 私的サイトは全記録をCloudflare Pagesに置きCloudflare Accessで本人のメールだけ許可（スマホはブラウザでログイン）。公開サイトは`publish: true`の記録**だけを元の段階で選んで**別にビルドし、別のPagesプロジェクトに置く。store（private/work）はGitHubのprivateリポジトリにpushして同期する。Artifactは投影の一つで、記録の置き場にはしない。
- **記法はCommonMark互換に固定する。** コールアウトは`> [!type]`、それ以外の部品（手順、比較、図とキャプション、注意）は`:::name`のディレクティブ。JSXは使わない。写像（`> [!type]`/`:::name` → `wu-*`のHTML）は自前のrehype変換一つ。図はMermaid/D2をビルド時に描く。サイトの殻（索引、ナビ、検索、スマホ向け）はAstroに`.md`のまま任せる。
- **文章は16項目の検査表で書く**（出典つき、`rules/knowledge/clear-writing-checklist.md`）。最重要の情報を先頭に、1段落1アイデア、見出しは記述、具体例が浮かばない説明は疑う、説明文は「なぜ」と代替案を扱う。文の長さの数値目標は書かない（どの出典にも無い）。
- **図は仕組みと関係を伝えるときだけ。** 一覧や平叙文の飾りに置かない。複雑になったら分割する。静的な図に「直感を養う」効果を主張しない。
- **品質は読者の点数で追う。** lint（natural-japanese、textlint）はAI臭の除去まで。分かりやすさは各文書に読者の点数を記録し、規則の変更で上がるかを見る。

## Alternatives considered

- **HTMLを直接書き続ける**: 業界に前例が無い。Markdownを真実源にして検索と見た目を上に足す形に、second brain系の道具（obsidian-second-brain 4,574星ほか）、Quartz、Obsidian Publishが全部収束している。Markdownならtextlintとnatural-japaneseが元をそのまま検査できる。却下。
- **Notionで管理する**: ページ単位のPublishトグルは「一件だけ公開」に最も直接的だが、元がMarkdown/gitでなくなり、Notion MCPは「セッション横断のエージェント記憶」として文書化されていない。却下。
- **一つのサイトをfrontmatter（`publish:`）で出し分ける**: QuartzのExplicitPublishは非公開の記録の添付（画像・PDF）を必ず出力に含める（実名のissue 4件、公式文書「非Markdownは全部公開ビルドに出る」）。却下。ビルドを分ける。
- **GitHub Pagesを非公開で使う**: Enterprise Cloud限定で、個人・Proでは不可能（文書のURL構造が裏付け）。却下。
- **自宅サーバー + Tailscale**: 無料でiOSアプリもあり、実践者（einverne、2026-08）が推す。自宅マシンの常時起動が前提で、一件公開のFunnelは未検証。二番手。
- **claude.ai Artifactを置き場にする**: 「publish中しか永続化されない」「unpublishで保存データが恒久削除」と公式文書に明記。投影にはよいが元にはならない。却下。
- **MDX / MintlifyのJSX部品**: remark系のtextlintはHTML/JSXブロックの中身を検査対象から外す。MDXは「地の文のlintは未解決」と開発者が言い、2.0で素のMarkdownの記法を壊した。Astroの素の`.md`は部品を埋め込めずMDX化が必須。却下。
- **Markdoc（`{% tag %}`）**: 宣言的で活発（8,484星、2026-09-16 push）だがタグが地の文に混ざり、記法の分断（GitHub `> [!NOTE]`、Docusaurus `:::`、MkDocs `!!!`、Quartz `> [!info]`。実名のissue 5件）に加担する。却下。
- **AI文の検出器で品質を測る**: GPTZero等は誤検知が約2割で「実運用で信頼できない」。字面のlinter（textlint 3,191星、Vale 6,135星）は現役。検出器は使わない。
- **セッションを丸ごと記事にする**: 道具の市場が事実上無い（`gh search repos`で0件、最も近い物が1星）。ベンダーにも「セッション後に恒久文書を書く」指針は無い。工程は残すが、書くかどうかは決定記録と同じ三部基準（将来の行動を縛る／却下した代替がある／コードや文書から導けない）で決める。

## Consequences

- remark-directiveは7か月更新が無い（424星、本番採用30件）。壊れたらブロッククォート派生の記法だけに寄せる。
- Cloudflare Accessの無料枠の人数上限はベンダー一次資料で未確認（伝聞で50人）。本人一人なら影響しない。
- 索引vs grep vs埋め込みの定量比較は無い。索引 + 必要時に開く形はClaude Codeのmemoryと7件以上の独立リポジトリの収束による。
- 決定記録と説明文書の分離は業界の多数派（Nygard、MADR、log4brains）だが唯一ではない（Kubernetes KEPは統合）。分離は「決定はエージェントが読む元、writeupは人が読む投影」という理由で選ぶ。
- 前例なし: HTML直書きからMarkdown + 部品へ移行した実名の記録、Quartz + Cloudflare Accessの公開例、lintで直した文章が読者に効くという数字。

## Sources

- 自宅サーバー + Tailscaleを選んだ実践者の比較（einverne、2026-08）: https://einverne.github.io/post/2026/08/ignis-obsidian-web-app.html
- 決定記録と説明文書の分離を明言する一次資料（Nygardの原典、ADRの直接の起源）: https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions 、MADRテンプレート: https://raw.githubusercontent.com/adr/madr/main/template/adr-template.md 、log4brains README（分離を最も明示）: https://raw.githubusercontent.com/thomvaill/log4brains/master/README.md
- 決定記録と説明文書を統合する逆方向の先例（Kubernetes KEPテンプレート）: https://raw.githubusercontent.com/kubernetes/enhancements/master/keps/NNNN-kep-template/README.md
- Notionのページ単位Publishトグル（「一件だけ公開」への最も直接的な答え）: https://www.notion.com/help/public-pages-and-web-publishing
- Claude Code memory: https://code.claude.com/docs/en/memory.md 、GitHubの警告: https://docs.github.com/en/copilot/concepts/response-customization
- Cloudflare Access: https://developers.cloudflare.com/cloudflare-one/access-controls/ 、QuartzのExplicitPublishが添付を漏らす実名のissue: https://github.com/jackyzha0/quartz/issues/2531 、https://github.com/jackyzha0/quartz/issues/1941 、https://github.com/jackyzha0/quartz/issues/1950 、https://github.com/jackyzha0/quartz/issues/1519 、https://quartz.jzhao.xyz/features/private-pages
- Artifact: https://support.claude.com/en/articles/9487310 、GitHub Pages: https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site
- 記法: https://docs.astro.build/en/guides/markdown-content/ 、https://github.com/remarkjs/remark-directive 、https://markdoc.dev/docs/overview 、https://github.com/just-the-docs/just-the-docs/issues/1483
- 文章: https://developers.google.com/style/paragraph-structure 、https://www.hyuki.com/writing/writing.html 、https://diataxis.fr 、https://worrydream.com/ExplorableExplanations/ 、https://news.ycombinator.com/item?id=46927101
- 参照の失敗: https://github.com/windyroad/agent-plugins
