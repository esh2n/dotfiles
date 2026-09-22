# 記録は Markdown を元にして git に置き、人向けの view は二回ビルドで作り、文章は検査表で書く

Status: accepted — 記録の元を Markdown にするのは業界の収束と一致し、非公開の出し分けは添付の漏れが構造的なのでビルドを分け、記法は CommonMark 互換で lint を通す（2026-09-22）

## Problem

writeup（セッションの調査・判断・勉強の記録を文書にして残し、人に見せる仕組み）の三つの動機に応える。(1) 過去の調査を次のセッションが見つけて再調査しない。(2) 勉強や作業の記録を、スマホでも読める人向けの view で残し、一件ずつ公開できる。(3) AI の書く説明が分かりにくい（自己評価 20/100）。いまの writeup は HTML を `wu-*` 部品で直接書き、`~/.local/share/writeup/{private,work}` のローカル git に貯め、claude.ai Artifact 等へ publish する。

## Decision

- **元は Markdown、HTML は生成物。** 三種の記録（調査記録、決定記録、勉強・作業の記録）は全部 Markdown を git に置く。writeup-kit の HTML 直書きの経路は廃止し、`wu-*` の CSS と部品定義だけを引き継ぐ。
- **調査記録は harness の repo に置き、索引で再調査を防ぐ。** `domains/dev/llm/harness/rules/research/<date>-<topic>.md`、先頭に「問い / 日付 / 結論一行 / 検証できなかったこと」。索引 `rules/research/INDEX.md`（一行一記録、200 行を超えたら分割）を生成する AGENTS.md から「調べる前に索引を読め。確立済みの事実は再調査しない」で指す。参照は番号 ID でなくパスと URL。
- **人向けの view は同じ Markdown から二回ビルドする。** 私的サイトは全記録を Cloudflare Pages に置き Cloudflare Access で本人のメールだけ許可（スマホはブラウザでログイン）。公開サイトは `publish: true` の記録**だけを元の段階で選んで**別にビルドし、別の Pages プロジェクトに置く。store（private/work）は GitHub の private リポジトリに push して同期する。Artifact は投影の一つで、記録の置き場にはしない。
- **記法は CommonMark 互換に固定する。** コールアウトは `> [!type]`、それ以外の部品（手順、比較、図とキャプション、注意）は `:::name` のディレクティブ。JSX は使わない。写像（`> [!type]`/`:::name` → `wu-*` の HTML）は自前の rehype 変換一つ。図は Mermaid/D2 をビルド時に描く。サイトの殻（索引、ナビ、検索、スマホ向け）は Astro に `.md` のまま任せる。
- **文章は 16 項目の検査表で書く**（出典つき、`rules/research/2026-09-22-knowledge-store-and-clear-writing.md`）。最重要の情報を先頭に、1 段落 1 アイデア、見出しは記述、具体例が浮かばない説明は疑う、説明文は「なぜ」と代替案を扱う。文の長さの数値目標は書かない（どの出典にも無い）。
- **図は仕組みと関係を伝えるときだけ。** 一覧や平叙文の飾りに置かない。複雑になったら分割する。静的な図に「直感を養う」効果を主張しない。
- **品質は読者の点数で追う。** lint（natural-japanese、textlint）は AI 臭の除去まで。分かりやすさは各文書に読者の点数を記録し、規則の変更で上がるかを見る。

## Alternatives considered

- **HTML を直接書き続ける**: 業界に前例が無い。Markdown を真実源にして検索と見た目を上に足す形に、second brain 系の道具（obsidian-second-brain 4,574 星ほか）、Quartz、Obsidian Publish が全部収束している。Markdown なら textlint と natural-japanese が元をそのまま検査できる。却下。
- **Notion で管理する**: ページ単位の Publish トグルは「一件だけ公開」に最も直接的だが、元が Markdown/git でなくなり、Notion MCP は「セッション横断のエージェント記憶」として文書化されていない。却下。
- **一つのサイトを frontmatter（`publish:`）で出し分ける**: Quartz の ExplicitPublish は非公開の記録の添付（画像・PDF）を必ず出力に含める（実名の issue 4 件、公式文書「非 Markdown は全部公開ビルドに出る」）。却下。ビルドを分ける。
- **GitHub Pages を非公開で使う**: Enterprise Cloud 限定で、個人・Pro では不可能（文書の URL 構造が裏付け）。却下。
- **自宅サーバー + Tailscale**: 無料で iOS アプリもあり、実践者（einverne、2026-08）が推す。自宅マシンの常時起動が前提で、一件公開の Funnel は未検証。二番手。
- **claude.ai Artifact を置き場にする**: 「publish 中しか永続化されない」「unpublish で保存データが恒久削除」と公式文書に明記。投影にはよいが元にはならない。却下。
- **MDX / Mintlify の JSX 部品**: remark 系の textlint は HTML/JSX ブロックの中身を検査対象から外す。MDX は「地の文の lint は未解決」と開発者が言い、2.0 で素の Markdown の記法を壊した。Astro の素の `.md` は部品を埋め込めず MDX 化が必須。却下。
- **Markdoc（`{% tag %}`）**: 宣言的で活発（8,484 星、2026-09-16 push）だがタグが地の文に混ざり、記法の分断（GitHub `> [!NOTE]`、Docusaurus `:::`、MkDocs `!!!`、Quartz `> [!info]`。実名の issue 5 件）に加担する。却下。
- **AI 文の検出器で品質を測る**: GPTZero 等は誤検知が約 2 割で「実運用で信頼できない」。字面の linter（textlint 3,191 星、Vale 6,135 星）は現役。検出器は使わない。
- **セッションを丸ごと記事にする**: 道具の市場が事実上無い（`gh search repos` で 0 件、最も近い物が 1 星）。ベンダーにも「セッション後に恒久文書を書く」指針は無い。工程は残すが、書くかどうかは決定記録と同じ三部基準（将来の行動を縛る／却下した代替がある／コードや文書から導けない）で決める。

## Consequences

- remark-directive は 7 か月更新が無い（424 星、本番採用 30 件）。壊れたらブロッククォート派生の記法だけに寄せる。
- Cloudflare Access の無料枠の人数上限はベンダー一次資料で未確認（伝聞で 50 人）。本人一人なら影響しない。
- 索引 vs grep vs 埋め込みの定量比較は無い。索引 + 必要時に開く形は Claude Code の memory と 7 件以上の独立リポジトリの収束による。
- 決定記録と説明文書の分離は業界の多数派（Nygard、MADR、log4brains）だが唯一ではない（Kubernetes KEP は統合）。分離は「決定はエージェントが読む元、writeup は人が読む投影」という理由で選ぶ。
- 前例なし: HTML 直書きから Markdown + 部品へ移行した実名の記録、Quartz + Cloudflare Access の公開例、lint で直した文章が読者に効くという数字。

## Sources

- `rules/research/2026-09-22-writeup-practice.md`、`rules/research/2026-09-22-knowledge-store-and-clear-writing.md`、`rules/research/2026-09-22-private-notes-publishing-and-md-components.md`
- Claude Code memory: https://code.claude.com/docs/en/memory.md 、GitHub の警告: https://docs.github.com/en/copilot/concepts/response-customization
- Cloudflare Access: https://developers.cloudflare.com/cloudflare-one/access-controls/ 、Quartz の漏れ: https://github.com/jackyzha0/quartz/issues/2531 、https://quartz.jzhao.xyz/features/private-pages
- Artifact: https://support.claude.com/en/articles/9487310 、GitHub Pages: https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site
- 記法: https://docs.astro.build/en/guides/markdown-content/ 、https://github.com/remarkjs/remark-directive 、https://markdoc.dev/docs/overview 、https://github.com/just-the-docs/just-the-docs/issues/1483
- 文章: https://developers.google.com/style/paragraph-structure 、https://www.hyuki.com/writing/writing.html 、https://diataxis.fr 、https://worrydream.com/ExplorableExplanations/ 、https://news.ycombinator.com/item?id=46927101
- 参照の失敗: https://github.com/windyroad/agent-plugins
