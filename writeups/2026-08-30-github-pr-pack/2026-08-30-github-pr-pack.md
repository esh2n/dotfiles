---
title: "writeup ページを GitHub の PR 説明として届ける経路"
kind: "設計"
date: "2026-08-30"
updated: "2026-08-30T17:17+09:00"
sources: "https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files; https://github.blog/changelog/2023-05-08-more-secure-private-attachments/; https://docs.github.com/en/repositories/working-with-files/using-files/working-with-non-code-files"
---

# writeup ページを GitHub の PR 説明として届ける経路

> [!NOTE]
> PR 説明は外部ホストに頼らず、ページ一式をリポジトリにコミットして PR 本文から参照する。 GitHub は非公開リポジトリの blob を read 権限のある人にしか返さず、2023 年 5 月以降は添付ファイルも同じ扱いになった。 PR 本文には to-md の Markdown を置き、原本 HTML・図の SVG・PDF はリポジトリに置く。 Artifact と Cloudflare の URL は閲覧の可否がリポジトリの権限と切れるため使わない。

## 目的と読者

PR の説明を writeup で書きたい。ただし非公開リポジトリの内容が外に出る経路は使えない。この条件で kit の資産をどこまで残せるかを決め、そのための kit コマンド pr-pack の形を固める。

読者は writeup で PR を出す本人と、kit を保守する人。一週間後に覚えていてほしい一文は「PR 説明の図と原本はリポジトリに入れ、本文は SHA 固定の blob URL で指す」である。

## 用語

- **blob URL** — `https://github.com/<owner>/<repo>/blob/<sha>/<path>` の形をした、リポジトリ内ファイルへの URL。`?raw=true` を付けると画像として読み込める
- **SHA 固定** — blob URL のリビジョン部分をブランチ名ではなくコミット SHA にすること。ブランチを消しても PR の `refs/pull/N/head` から到達できる
- **pr-pack** — ページを PR 用の一式（原本 HTML・Markdown・図・PDF）に書き出す kit のコマンド。この文書で設計する
- **to-md** — kit の HTML から Markdown への変換。alerts・表・diff・mermaid に構造を残し、見た目の皮だけを落とす

## 現状とギャップ: 出口が外部ホストしかない

publish の出口は artifact・cloudflare・file の 3 つで、PR 説明に向いた経路がない。Artifact と Cloudflare は「URL を知る人」または「Access を通った人」にページを返す。そのため閲覧の可否がリポジトリの権限と一致しない。

![外部ホストの URL を PR に貼るため、閲覧の可否はリポジトリの権限と切れている](figures/2026-08-30-github-pr-pack-pr-route-now.svg)

GitHub の Markdown に手で写す道もあるが、図は消え、表と diff は書き直しになる。kit の図は単体でも成立しない。色はすべて `currentColor` と `var(--wu-*)` の参照で、ページの CSS が無いと黒一色になり、トーンと強調が消える。

## あるべき姿: 一式をリポジトリに入れ、本文は blob URL で指す

![図も原本もリポジトリに入れ、PR 本文は SHA 固定の blob URL で参照する](figures/2026-08-30-github-pr-pack-pr-route-next.svg)

pr-pack が `docs/writeup/<slug>/` に原本 `index.html`・`<slug>.md`・`figures/*.svg`・任意で PDF を書き出す。PR 本文は Markdown に SHA 固定の blob URL を埋めたものにする。GitHub のドキュメントは、非公開リポジトリの画像は閲覧者に read 権限があるときだけ表示すると明記している。

本文に残るのは alerts・表・`diff` フェンス・劣化版の mermaid まで。行番号つきの diff 表、side TOC、kit の配色は原本 HTML と PDF が持つ。PDF は GitHub の blob 画面がそのまま描画するので、外部ホスト無しで kit の見た目を見せられる。

## 決定点

| 経路 | 閲覧の権限 | 自動化 | 残る資産 |
| --- | --- | --- | --- |
| リポジトリにコミット + blob URL | リポジトリの read 権限と一致 | gh で完結 | HTML・SVG・PDF・Markdown |
| PR エディタに添付 | 2023 年 5 月以降は一致 | API も gh も無い | HTML は添付できるが描画されない |
| Cloudflare Pages + Access | Access の設定次第 | wrangler が要る | 完全 |

### 図は不透明な白いカードとして書き出す

GitHub のダークテーマでも読める図にする局面で、ライト・ダーク 2 枚組ではなく背景を不透明にした 1 枚を選ぶ。テーマの食い違いに強い出力を得て、ダーク画面で白く浮くことを受け入れる。`<img>` 内の `prefers-color-scheme` は OS の設定に従い、GitHub のテーマ設定とは一致しない。2 枚組にしても同じ問題が残る。

### pr-pack では private word 検査を掛けない

読者はリポジトリのメンバーなので、社外向けの門は要らない。検査を掛けると社内の製品名が書けなくなり、PR 説明として成り立たない。外部ホストに出す publish とは門の位置が違う。

## 進め方

![SHA は push 後に決まるので、本文の生成は 2 回目の pr-pack になる](figures/2026-08-30-github-pr-pack-pr-pack-flow.svg)

```sh
node $KIT/bin/pr-pack.mjs page.html --out docs/writeup/<slug> --pdf
git add docs/writeup/<slug> && git commit -m "docs: pr writeup"
git push -u origin <branch>
SHA=$(git rev-parse HEAD)
node $KIT/bin/pr-pack.mjs --out docs/writeup/<slug> \
  --repo <owner>/<repo> --sha $SHA --path docs/writeup/<slug> --body-out body.md
gh pr create --draft --title "..." --body-file body.md
```

置き場所の既定は `docs/writeup/<slug>/` だが、`--path` で変えてよい。dotfiles は `docs/` が Astro サイトなので `writeups/<slug>/` に置く。

この文書自体を最初の PR 説明にして、dotfiles リポジトリで経路を通す。ただし dotfiles は公開リポジトリなので、非公開リポジトリでの表示は別途確かめる。

- PDF の生成は playwright-core が見つかるときだけ行う。kit のゼロ依存は崩さない
- 非公開リポジトリで blob URL の画像が PR 本文に出ることの実機確認【要確認】
- PR 本文の `<style>` とインライン `<svg>` が除去されることの一次ソース【要確認】
- 添付ファイルの署名付き URL の有効期限【要確認】
