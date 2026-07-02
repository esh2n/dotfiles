---
name: explain-page
description: Create a richly formatted explanation document as Markdown with custom directives, rendered by the local explain-pages viewer. Use when the user asks to explain a technical topic as an HTML page, create an explanation document, or says /explain-page. Output is saved locally per user and browsable with history in the viewer.
---

# Explain Page

技術的な説明を Markdown + directive で執筆し、ローカルの explain-pages viewer でレンダリングする。

この skill はコードを持たない薄い指示書である。語彙・デザインの仕様 (契約) は explain-pages リポジトリ側にあり、必ず実行時に読むこと。

NOTE: このファイルが正本。`~/dotfiles` の ECC profile (`skills/explain-page/SKILL.md`) に同内容のコピーがあり、変更時は両方を更新する。

## 前提

### リポジトリ位置の解決

explain-pages リポジトリ (github.com/esh2n/explain-pages) を次の順で解決する。開発者ごとに clone 先の流儀 (ghq / src 直下など) が異なるため、**「よくある場所に無い」を「clone されていない」と判断しない**。探索と質問を経てから clone を最終手段とする:

1. `$EXPLAIN_PAGES_ROOT` が設定されていればそれを使う
2. `ghq` が使える環境なら `ghq list --full-path | grep explain-pages` で探す
3. よくある clone 先を探す: `~/go/github.com/*/explain-pages`、`~/src/github.com/*/explain-pages`、`~/ghq/github.com/*/explain-pages`
4. 見つからなければ「explain-pages リポジトリはどこに clone してありますか？」とユーザーに質問する
5. clone されていないと回答された場合のみ、`git clone https://github.com/esh2n/explain-pages` を依頼して中断する

解決できたら、次回以降の解決を確実にするため `export EXPLAIN_PAGES_ROOT=<解決したパス>` をシェル設定に追加するよう提案する。提案に留め、シェル設定ファイルを無断で編集しない。

### コンテンツ置き場

- `$EXPLAIN_PAGES_DIR`、未設定なら `~/.local/share/explain-pages/pages/`

## ワークフロー

「前提」のリポジトリ位置解決を済ませてから、番号順に実行する (契約読みが常に最初)。

### 1. 契約を読む (必須・毎回)

語彙やデザインはこのファイルに複製しない。リポジトリ側が唯一の情報源である:

- `docs/authoring.md` — frontmatter schema、directive 語彙 (callout / compare / steps / terms / diagram / sequence / diff / scorebars / html)、DSL 文法、執筆ガイドライン
- `docs/design-system.md` — 視覚設計の仕様 (執筆時は参照不要だが、見た目の質問に答えるときに読む)

authoring.md が読めない場合 (リポジトリ破損・ファイル欠落等) は執筆に進まず、状態と再開条件を報告して中断する。語彙を記憶から捏造しない。

### 2. 内容を確認する

依頼文で既に確定している項目は質問しない。不明な項目だけ最小限を聞く:

- 対象読者と前提知識のレベル
- 何が伝われば成功か (結論・判断・手順のどれか)
- 機密性 (社外秘の固有名詞を含むか。含んでもローカル保存のみなので可、ただし本人に自覚させる)

### 3. ページを書く

- authoring.md の語彙だけで書く。語彙にない表現が必要なときのみ `:::html` (escape hatch)
- ファイル名: `YYYY-MM-DD-<slug>.md`。分類が必要ならサブディレクトリ (フォルダ) を切る
- frontmatter の `summary` は執筆時に自分で書く (サイドバーの検索・一覧に使われる)
- 図は宣言的 directive (`:::diagram` / `:::sequence`) を優先する。座標や色コードは書かない
- 大きい図は `scroll=true` 属性を付ける

### 4. プレビュー

- dev server が起動済みか確認: `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/`
- 未起動なら解決済みリポジトリのルートディレクトリで `pnpm dev` をバックグラウンド起動する
- ユーザーにページの URL を伝え、フィードバックを反映する

## 運用ルール

- `:::html` を同じパターンで 2 回使ったら、語彙の欠落として authoring.md への directive 追加をユーザーに提案する
- authoring.md と viewer 実装の乖離を見つけたら、勝手に直さずユーザーに報告する
- ページに書いた内容はローカル保存のみ。リポジトリ (explain-pages) 側に固有名詞や機密を含む example を書かない
