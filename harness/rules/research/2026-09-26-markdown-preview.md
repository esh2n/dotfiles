# k1LoW/mo を外した後、コーディングエージェントが書いた Markdown(計画・調査記録・README)を macOS と Omarchy(Arch/Hyprland)の両方でどう「きれいに見る」か

調査日: 2026-09-26。前提（既出、再調査しない）: `2026-09-26-cli-linux-install-paths.md` が `k1LoW/mo`(Markdown ビューア)を含む 6 ツールの Nix 化可否を調べ、`pkgs.mo` は nixpkgs 側で無関係な Bash 用 Moustache テンプレートエンジン (`tests-always-included/mo`) に**名前衝突**しており、mo 自身のパッケージ化には自作 Nix 導出が要ることまで確定済み。同記事は比較対象として `glow`(nixpkgs あり、活発)・`mdcat`(archived)・`grip`(2年超停滞)・`frogmouth`(2年超停滞)・`markserv`(nixpkgs なし、活発)の表も作成済み — この記事はその表を前提とし、mo の代替候補を深掘りする形で構築する。このリポジトリの `flake.lock` は今日 2026-09-26 02:47 UTC 時点で更新済み（root の `nixpkgs` 入力 → ロックノード `nixpkgs_2`、rev `d54020a6ac3211e9f4201631bdf67678818c0cdf`）。

## 方法・検証凡例

- GitHub API は `curl -H "Authorization: Bearer $(gh auth token)" https://api.github.com/...`（`gh` 自体はこのサンドボックスで TLS が通らないため使わない、指示どおり）。
- nixpkgs の確認は `nix --extra-experimental-features 'nix-command flakes' eval --inputs-from . --raw nixpkgs#<attr>.version` を実際に試したが、このサンドボックスでは `/nix/var/nix/daemon-socket/socket` への接続が `Operation not permitted` で拒否され失敗した（`XDG_CACHE_HOME` を書き込み可能な一時ディレクトリに退避してSQLiteキャッシュの書き込み拒否は回避できたが、デーモンソケット拒否は回避できず）。代わりに `raw.githubusercontent.com/NixOS/nixpkgs/<rev>/pkgs/by-name/...` を、root の `nixpkgs` 入力が実際に固定しているコミット `d54020a6ac3211e9f4201631bdf67678818c0cdf`（ロックノード `nixpkgs_2` — 依頼文が名指しした注意点どおり、前回記事が使った別の入力のロック `4975466d...` とは別物）に対して直接取得して確認した。これは評価そのもの（依存解決・ビルド可否）の代替ではない。
- Neovim 設定は `home/shared/nvim/` 配下の4ディストリ（lazyvim/nvchad/astrovim/custom）を直接 grep・読み取り。`home/shared/nvim/default.nix` のコメントで「新規マシンでは LazyVim が既定」と明記されている。
- 未到達/未確認は都度明記。

---

## 1. 方向1: writeup-kit は任意の `.md` を「点で」プレビューできるか

### 1-1. writeup-kit の設計方向はそもそも逆(HTML→MD)

`harness/tools/writeup-kit/bin/to-md.mjs` の冒頭コメント（直接読み取り）:

> "to-md.mjs — deterministic HTML→Markdown conversion (contract §7). Reads only role-tagged structure (bin/lib/html.mjs), so the mapping never has to guess."

writeup-kit がネイティブに持つ唯一の Markdown 関連 CLI は **HTML → Markdown** 変換であり、逆方向（任意の Markdown → HTML）の CLI は存在しない。任意の `.md` を渡して HTML に変換する処理自体が、この kit にはそもそも実装されていない。

### 1-2. 「Markdown からの入力」は自動変換ではなく人間(エージェント)の手作業手順

`harness/skills/writeup/SKILL.md` の該当節（直接読み取り、137-142行目）:

> "`--from <md-path> --kind <kind>`: map headings, lists, tables, code blocks and `A --> B` mermaid edges into `.wu-*` components and diagram IR (note any loss where mermaid is richer), then continue at step 3."

この `--from` はスクリプトの実引数ではない — `harness/skills/writeup/scripts/` に存在するファイルは `init-store.mjs` 1本のみで、Markdown を解析するスクリプトは存在しない（`find`で確認済み）。実体は `harness/skills/writeup/references/from-markdown.md` という**人間(エージェント)向けマッピング表**で、冒頭にこう書かれている:

> "Used for turning a workflow's Markdown report ... — or any Markdown the user hands over — into a writeup page. Read the file, map it with the table below, then continue at `SKILL.md` step 3 (write the body into the copied template, render figures, lint, self-check, save, commit)."

つまり任意の Markdown を writeup-kit のページにするには、エージェントがこの表を読みながら**手で** `.wu-*` コンポーネントに書き換え、mermaid をこの kit 独自の図 IR（9ノード/12エッジ/4グループ上限、ノードの形状情報は破棄される、と同ファイル54-76行目に明記）に変換し直す必要がある。「そのまま渡せば見られる」機構ではなく、1ページぶんの著者作業が発生する。

### 1-3. `serve.mjs` にライブリロード機構は無い

`bin/serve.mjs` を全文読み、`websocket`/`watch`/`reload`/`EventSource`/`SSE` を kit 全体で grep したが、`bin/`・`kit/`・`package.json` のどこにも一致は無かった（直接検索、ヒットはコメント中の "watch" 等の無関係な単語のみ）。`serve.mjs` はファイル変更を検知しない素朴な `node:http` 静的サーバーで、`build.mjs --store` を都度手動で再実行しない限り、ブラウザ側は古い内容を表示し続ける。mo が持つ「保存したらブラウザに自動反映」（後述 2-2 のレビュー記事の言及）に相当する機構は、writeup-kit のどのコンポーネントにも存在しない。

### 1-4. `self-check` ゲートが「そのまま見る」を構造的に拒む

`bin/publish.mjs` は `self-check.mjs` を通らないページの公開を拒否する（`assertSelfCheckPasses`、251-258行目）。`self-check.mjs` は `kit/template.html` と一致するヘッダー/フッターの chrome、`wu-*` 以外のクラス名の禁止（`bin/self-check.mjs:475`、`ALLOWED_NON_WU_CLASSES`）など、kit 固有の構造契約を強制する。これは「任意の Markdown をそのまま素早く見る」用途とは設計思想が正反対で、`serve`/`publish` のどちらの経路を通しても、kit の構造に沿っていない文書は最初の一歩（lint/self-check）で止まる。

### 1-5. 「小さな追加」で足りるか

mo と同じ体験（`mo any.md` でブラウザにGFM+mermaid+シンタックスハイライト+ライブリロードが出る）を writeup-kit の上に作るには、少なくとも次が要る（推測ではなく、上記1-1〜1-4の欠落から機械的に導かれる）:

1. `to-md.mjs` の逆写像（Markdown → kit 非依存の素の HTML、GFM パーサ + mermaid レンダラの依存追加）— writeup-kit は現在 `vendor/` 以外に依存を持たない「ゼロ依存」設計（README 19-29行目、`node --test` 以外は `npm install` 一切なし）だが、GFM/mermaid パーサはこの制約と衝突する。
2. `serve.mjs` へのファイル監視 + WebSocket/SSE の新規追加（現状ゼロから）。
3. kit の store・self-check・`.writeup.toml` 契約を経由しない「生の一時ファイルを見るだけ」の第三のモードの新設 — 既存の `serve.mjs` は store 前提（`.writeup.toml` が無いと警告を出す、478-481行目）。

これは「点の追加」ではなく、writeup-kit とは別のツール（後述 mdts のようなもの）を新規に書くのとほぼ同じ量の作業になる。**結論: writeup-kit は現状、任意の `.md` の即席プレビューには使えず、小さな追加でも届かない。** writeup-kit が向いているのは「保存して残す1ページの文書」であり、mo が担っていた「今すぐこのファイルを見る」用途とは非対称。

---

## 2. 方向2: 既存の軽量ツール比較

### 2-1. ターミナルレンダラー: `glow` (再確認)

前回記事で確認済み: `charmbracelet/glow` は 27,474 star、2026-09-22 push（4日前）、nixpkgs に `pkgs.glow` が既にあり、このリポジトリの実際の pin（`d54020a6...`）でも同じ `version = "3.0.0"`（今回直接取得で再確認、upstream 最新と一致）。実践者側の評価（WebSearch、Medium/ConfigCrate 等の記事横断、2026年時点）:

> "Its design avoids over-complication—the TUI mode is intuitive, the CLI mode is flexible, and the rendering quality is solid, making it a 'just right' tool for developers who spend significant time in the terminal." — Glow: The Terminal Markdown Reader That Actually Makes Documentation Readable (joaolealdasilva.medium.com)

> "Glow renders markdown, not arbitrary HTML, so if a README leans heavily on raw HTML tags, custom badges, complex table formatting, or embedded videos, the render will be imperfect." — 同上

mo の作者自身の比較記事（後述2-4）でも glow の位置づけは明確:「Reading in terminal / over SSH」— mermaid は描画不可(❌)、ライブリロードも無し(❌)、その代わりオフライン・軽量・ターミナル完結（SSH 越しに `.md` を読むのに便利、と明記）。**ターミナル内で素早く読む用途では業界の事実上の標準のまま** — この結論は前回記事から変わらない。

### 2-2. mo 自身が現役だったときの評価(実践者の声、日本語圏)

WebSearch で見つかった一次反応（mo が削除される前の実際の評判、削除の是非を判断する材料として記録）:

> "k1LoW/moが便利すぎて、本当に手放せないツール入りしてきた" — syumai (X/Twitter)

> "GFM（GitHub Flavored Markdown）、シンタックスハイライト、Mermaid、LaTeX、全文検索、MDXサポートなどの機能を誇ります。ファイルを保存すると、ブラウザに自動反映されます。" — Markdownプレビューにk1LoW/moを使ったら記事執筆がかなり楽になった (zenn.dev/yamadatt)

> "2026-02-27に作られたばかりで、執筆時点でまだ2ヶ月ほどですが、既にv1.3.0まで進み、かなり機能が揃っていて開発ペースも速い" — 同種の評（Qiita/Zenn、要旨）

mo は「ブラウザ常駐+ライブリロード+GFM+mermaid+LaTeX+全文検索+複数ファイル/ディレクトリ指定」を単一 Go バイナリで満たしていた、というのが実践者の一致した評価。**この機能集合をまるごと満たす後継は、今回の調査では存在を確認できなかった**（後述の通り、個々のツールはこの部分集合しか満たさない）。

### 2-3. `markserv` (再確認 + 深掘り)

前回記事で確認済み: 626 star、2026-09-25 push（1日前）、nixpkgs に無し(`pkgs/by-name/ma/markserv/` を今回もこのリポジトリの実際の pin で直接確認、404)。mo の作者自身の比較記事(後述2-4)での評価:

> markserv: 「Straightforward Markdown server」— Node ベースで「four themes: dark / light / synthwave / solarized」と WebSocket ライブリロードを持つが、「no modern sidebar tree navigation」

mermaid 対応は同記事の表で `△`(部分対応)、全文検索は `❌`。**「ブラウザで開いてライブリロードする」という設計は mo に最も近いが、機能は mo の部分集合。**

### 2-4. mo の後継候補: `mdts` (unhappychoice/mdts) — 発見

この調査で新規に見つかった、mo と最も機能が近い現役ツール。GitHub 直接取得:

- リポジトリ: `unhappychoice/mdts`、star 250、TypeScript、MIT、`created_at: 2025-07-13`、**`pushed_at: 2026-09-26T05:11:32Z`（今日）**。リリースタグは `v0.20.6`(2026-07-27) が直近だが push 自体は継続中。
- README（直接取得、`raw.githubusercontent.com/unhappychoice/mdts/main/README.md`）:
  > "A zero-config CLI tool to preview your local Markdown files in a browser. **npx mdts** — and you're done."
  > "⚡ Instant Markdown Preview ... 🌐 Web UI – Clean, tree-based browser interface with three-panel layout ... 🔄 Live Reload – Automatically refreshes on file changes ... 🧘 Zero Setup – No config, no install, no nonsense"
  > Use Cases: "Reviewing AI-generated docs" — mo と全く同じ利用動機を名指ししている。
- `package.json`（直接取得）の依存: `markdown-it ^15.0.0`(GFM系パーサ)、`chokidar ^4.0.3`(ファイル監視)、`ws ^8.18.3`(WebSocket、ライブリロードの実装)、`express ^5.1.0`、`plantuml`/`plantuml-encoder`/`node-plantuml-back`(PlantUML対応)。リポジトリ内に `packages/frontend/src/components/Content/MarkdownContent/MarkdownRenderer/MermaidRenderer.tsx` が実在（GitHub code search で直接確認）— **mermaid 対応は名前だけでなく実装ファイルとして存在**。
- nixpkgs: `pkgs/by-name/md/mdts/package.nix` は今回の pin で 404（未パッケージ）。
- 起動: `npx mdts` — mo の「インストール不要」という利点を Node/npx の経路で踏襲（Node.js が入っていれば良く、macOS/Omarchy 両方で同一コマンドが通る）。ディレクトリを渡せば配下の `.md` をツリー表示（`npx mdts ./docs`）— mo の複数ファイル/ディレクトリ指定にも相当する。

mo の作者自身ではなく、`unhappychoice`（mdts の作者）が書いた比較記事「2026 Markdown Viewer Comparison (grip / markserv / glow / mo / Arto / mdts)」(zenn.dev/qiita.com、WebFetch で内容取得、自著の宣伝を含む可能性に留意) の比較表:

| ツール | 種別 | Tree | Offline | Live Reload | Search | Mermaid | Theme |
|---|---|---|---|---|---|---|---|
| grip | Python CLI (browser) | △ | ❌ | ◯ | ❌ | ◯ | GitHub only |
| markserv | Node CLI (browser) | △ | ◯ | ◯ | ❌ | △ | 4 themes |
| glow | Go CLI (TUI) | ◯ | ◯ | ❌ | ◯ | ❌ | Style configurable |
| **mo** | Go CLI (browser) | ◯ | ◯ | ◯ | ◯ | ◯ | Dark / Light |
| Arto | Native app (macOS) | ◯ | ◯ | ◯ | ◯ | ◯ | Dark / Light |
| **mdts** | Node CLI (browser) | ◯ | ◯ | ◯ | ◯ | ◯ | 20+ themes / fonts |

同記事の mdts の位置づけ: 「Fine-tuning themes and fonts」— 差別化点は「visual customizability — you can adjust over 20 app-wide themes, syntax highlight themes」。**この表を字面どおり読むなら、mo が削除された今、この6ツールの中で mo と同じ ◯/◯/◯/◯/◯ の並びを持つのは mdts だけ**（Arto は macOS ネイティブアプリで対象外、後述）。ただし記事の著者自身が mdts の作者である一次利害関係は明記して読む必要がある[要留保: 表の各セルの判定基準(◯/△/❌)は記事側の主観評価で、独立した第三者による再現検証はしていない]。

**grip の活動状況**: 同記事は「last commit 2023-10」と述べるが、前回記事は GitHub API 直接取得で `pushed_at: 2024-07-10`(2年超前)と記録しており、日付そのものが約9ヶ月食い違う。どちらも「2年前後 push が無い」という結論は一致するため、記事側の月の記憶違いの可能性が高いが、**正確な最終 push 日は前回記事の直接取得値(2024-07-10)を正とする**[このズレ自体は unverified のまま記録]。

### 2-5. mo 自体の直系フォーク: `Aliancn/mdlive`

GitHub 直接取得: `Aliancn/mdlive`、説明文「Markdown viewer that opens .md files in a browser with live-reload. Fork of k1LoW/mo.」、**`created_at: 2026-09-22T11:48:48Z`**（この調査の4日前）、star 0、リリースは `v0.1.0`(09-22)〜`v0.1.3`(09-23) の4本のみ。

**否定側の証拠として重要**: mo が削除された直後に、無関係な第三者が mo 自体をフォークしてライブリロードを足す試みが実在した、という事実そのものは「mo の空白を埋める動きがある」という肯定材料に見えるが、star 0・4日・v0.1.x という若さは「後継として実用に足る」を裏付けるにはあまりに早い。**このリポジトリで新規に採用する候補としては時期尚早**と判定し、存在の記録のみに留める。

### 2-6. Arto — macOS 専用なので対象外

`unhappychoice` の比較記事は Arto を「Native app (macOS)」「beta v0.25.x」と記す。GitHub の公開リポジトリ検索では該当プロジェクトを特定できず[unverified: クローズドソースか、検索語が不十分かは未確認]。いずれにせよ macOS 専用である時点で、Omarchy との両対応という要件を満たさないため、これ以上の深掘りはしていない。

### 2-7. エディタ内蔵: Neovim — **既にリポジトリが両OSに配っている**

`home/shared/nvim/default.nix`（直接読み取り、1-3行目）:

> "Neovim: each distribution beside this file (lazyvim/, nvchad/, astrovim/, custom/) is linked as `~/.config/nvim-<name>`; `~/.config/nvim` points at one of them (`dotctl nvim <name>`), **LazyVim on a new machine**."

つまり新規マシン（Omarchy 機を含む）の既定は LazyVim。その `lazyvim/lua/plugins/markdown.lua`（全文読み取り済み、4行）:

```lua
{
  "MeanderingProgrammer/render-markdown.nvim",
  ft = { "markdown" },
  dependencies = { "nvim-treesitter/nvim-treesitter", "nvim-tree/nvim-web-devicons" },
  opts = { heading = {...}, code = {...}, bullet = {...} },
}
```

同じプラグインが `custom/lua/custom/plugins/markdown.lua`（kickstart系ディストリ）にも、より詳細な設定（チェックボックス・パイプテーブル・LaTeX `latex2text` 連携込み）で入っている。一方 `nvchad/`・`astrovim/` の配下を grep しても `render-markdown` は一致しなかった（直接確認、この2ディストリには未配線）。

`MeanderingProgrammer/render-markdown.nvim` は Neovim バッファ内でヘッダー・テーブル・チェックボックス・コードブロックを Treesitter ベースで装飾表示する（ブラウザや Webview は使わない、mo のような別ウィンドウ・ライブリロードとは別カテゴリ）。**この機能は Lua + Treesitter だけで完結し、OS 依存が無いため macOS と Omarchy で完全に同じ体験になる**。すでに `jig apply`/`dotctl nvim` の配線でリポジトリが管理しており、追加のインストールも Nix 導出も一切不要（`home.packages` に何も足さず、プラグインマネージャ(lazy.nvim)が初回起動時に落とすだけ）。mermaid のレンダリングは無い（Treesitter 装飾の範囲外）。

### 2-8. VS Code / Cursor 内蔵プレビュー — macOS 側にしか配線されていない

`home/darwin/vscode/config/extensions.txt`（直接読み取り）に以下が確認できた:

```
bierner.markdown-mermaid
davidanson.vscode-markdownlint
yzhang.markdown-all-in-one
```

VS Code の Markdown プレビュー機能自体は内蔵（拡張子不要）で、`bierner.markdown-mermaid` がそこに mermaid 描画を追加する。しかし、このリポジトリで VS Code/Cursor の設定を配っているのは `home/darwin/` 配下だけで（`home/linux/`・`home/shared/` のいずれにも `vscode`/`cursor` ディレクトリは存在しない、`find` で確認済み）、**Omarchy 側にはこの拡張機能リストが届かない**。VS Code/Cursor 自体はクロスプラットフォームアプリなので Omarchy に入れることはできるが、この dotfiles リポジトリの管理下では mermaid 拡張が付いてこない — 「既に入っている」と言えるのは macOS だけ。

---

## 否定側の証拠（同じ熱量で収集）

- writeup-kit は「ゼロ依存」を明記した設計（README 19-29行目）であり、GFM/mermaid パーサを足すこと自体がこの設計原則と衝突する — 「小さな追加」で済まない根拠は、まさにこの原則にある。
- mdts は 250 star・2026-09-26 push と活発だが、**直近の GitHub Release タグは 2026-07-27 (`v0.20.6`)** — push はコミット単位で継続しているが、タグ付きリリースという意味では約2ヶ月止まっている[この解離自体は事実であり、開発停止を意味するとは限らない]。
- `mdlive`(mo の直系フォーク)は星0・4日・v0.1.x で、後継としての実績が無い。
- markserv は「mermaid 部分対応・全文検索なし・サイドバーtreeなし」と、mo が持っていた機能の一部しか満たさない（2-4の比較表）。
- VS Code/Cursor の mermaid 対応拡張はこのリポジトリでは macOS 専用パスにしか無く、「既に入っている」を Omarchy 側で主張できない。
- nvchad・astrovim の2ディストリには render-markdown.nvim が未配線 — 「Neovim なら既にある」は4ディストリ中2つにしか当てはまらない。
- Arto は独立した一次情報源(GitHub リポジトリ等)を特定できず、記述の裏取りができていない。

---

## 確認できなかったこと

- `unhappychoice` の比較記事の評価セル(◯/△/❌)が独立した第三者検証を経たものか — 著者自身が mdts の作者であるという利害関係は明記したが、表自体を自分の手で全ツール再現検証してはいない [unverified]。
- grip の最終コミット日が 2023-10 か 2024-07-10 か — 出典間で食い違う [unverified]。
- mdts が Omarchy(Hyprland, Wayland) 上で実際に `npx mdts` からブラウザが自動で開くか（`open` npm パッケージの `xdg-open` 経路に依存） — 実機検証していない [unverified]。
- Arto の実体（クローズドソースか、配布元、正確な現在のバージョン） [unverified]。
- nixpkgs の `glow`/`frogmouth`/`mo` package.nix が実際にビルドに成功するか — サンドボックスの nix daemon 接続不可のため `nix build`/`nix eval` を一度も実行できておらず、ソースの内容確認のみ。
- mise の curated registry (`registry/glow.toml` 等) や aqua-registry に mdts/markserv/glow のエントリがあるかは未確認（前回記事は `mo`/`wtp` について aqua-registry 登録を確認済みだが、今回の対象では調べていない）。

---

## 結論

**owner に一番合うのは「用途で使い分け、新規インストールを増やさない」構成 — mo 一本の代替は無い。**

1. **ターミナルで素早く読む（README、SSH越しの確認）**: `glow`。前回記事どおり nixpkgs 既存・upstream 最新一致・27k+ star の事実上の標準。追加作業ゼロ。mermaid・ライブリロードは無いので、それが要る場面には向かない。
2. **エディタで書きながら見る（コーディングエージェントが書いた計画・調査記録を Neovim で開いた瞬間に）**: **何もしなくて良い** — LazyVim（新規マシンの既定）にも custom(kickstart) にも `render-markdown.nvim` が既に配線済みで、macOS・Omarchy 両方で同じ Lua/Treesitter 実装が動く。nvchad・astrovim を使う場合だけ未配線なので、その2ディストリで同じ体験が要るなら `lazyvim/lua/plugins/markdown.lua` と同じプラグイン定義を足す小さな追加で足りる。mermaid は出ない。
3. **ブラウザで GFM+mermaid+ライブリロードをまとめて見たい（mo が担っていた用途そのもの）**: `npx mdts` が最も近い後継候補。インストール不要（Node.js があれば良い）で macOS/Omarchy 同一コマンド、mermaid・PlantUML・GFM・ライブリロード・ディレクトリツリー表示を実装として確認済み。ただし 250 star・単独開発者のプロジェクトで、mo ほどの実績はまだ無い[この評価は事実の記録であり、採用の可否そのものは owner の判断に委ねる]。`markserv` はより多くの star と長い実績を持つが機能面で mo/mdts に見劣りする（mermaid 部分対応、検索なし）。
4. **VS Code/Cursor を既に開いている場面**: macOS では `bierner.markdown-mermaid` を含む拡張が既に配線済みで追加コストなしだが、Omarchy にはこのリポジトリから同じ設定が届かない — 両対応を求めるなら別途 `home/linux/` 側の配線が要る（今回のスコープ外、既存の欠落として記録のみ）。
5. **writeup-kit / writeup スキルは「今すぐこの `.md` を見る」の代替にならない** — 設計方向が逆（HTML→MD）、ライブリロード機構がゼロから無い、self-check ゲートが任意の構造を拒む、ゼロ依存原則が GFM/mermaid パーサ追加と衝突する。「小さな追加」ではなく実質的に mdts 相当の新規ツールを書く量の作業になるため、この用途では別ツール（上記1-3）に任せるのが妥当。
