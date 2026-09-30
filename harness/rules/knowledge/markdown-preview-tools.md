# k1LoW/mo が使えなくなった後、Markdown をどう「きれいに見る」か（macOS/Omarchy 両対応）

確認日: 2026-09-26

## 答え

k1LoW/mo（GFM + mermaid + ライブリロードをブラウザで見せる単一 Go バイナリ）は nixpkgs の `pkgs.mo` が無関係な別ツール（Bash 用 Moustache テンプレートエンジン）に占有されているため、Nix パッケージ化には名前衝突の回避が要る。用途別に使い分けるのが妥当で、mo 一本の完全な代替は無い。

- ターミナルで素早く読む用途は `glow`（charmbracelet/glow）が事実上の標準。nixpkgs に既にあり upstream 最新と一致、star 数も圧倒的。mermaid・ライブリロードは無い。
- エディタで書きながら見る用途は、Neovim の `render-markdown.nvim`（Treesitter ベースのバッファ内装飾）が既に配線されているディストリ（LazyVim、custom/kickstart 系）では追加コストがゼロ。ただし mermaid は出ない。
- ブラウザで GFM + mermaid + ライブリロードをまとめて見たい mo の本来の用途には、`npx mdts`（unhappychoice/mdts）が最も近い後継候補。インストール不要（Node.js があれば良い）で macOS/Omarchy 同一コマンド、mermaid・PlantUML・GFM・ライブリロード・ディレクトリツリー表示を実装として確認できた。ただし star 250・単独開発者のプロジェクトで mo ほどの実績は無い。`markserv` はより長い実績を持つが機能面で見劣りする（mermaid 部分対応、全文検索なし）。

writeup-kit / writeup スキルは「今すぐこの .md を見る」用途の代替にはならない。設計方向がそもそも逆（HTML→Markdown変換であり逆方向は無い）、ライブリロード機構がゼロから無い、self-check ゲートが任意の構造を拒む、ゼロ依存原則が GFM/mermaid パーサ追加と衝突する。

## 根拠

- `pkgs.mo` が Bash 用 Moustache テンプレートエンジンと名前衝突していること — nixpkgs `pkgs/by-name/mo/mo/package.nix`（`tests-always-included/mo`）
- glow が nixpkgs 既存・upstream 最新一致・star 27,474 — nixpkgs `pkgs/by-name/gl/glow`、GitHub API
- mdts が mo とほぼ同じ機能集合（GFM/mermaid/ライブリロード/検索/テーマ）を実装として持つこと — https://github.com/unhappychoice/mdts（README、package.json の依存: markdown-it、chokidar、ws）
- markserv は mermaid 部分対応・全文検索なしで mo の部分集合 — mo 作者ではなく mdts 作者による比較記事の評価表
- writeup-kit がゼロ依存設計であり GFM/mermaid パーサ追加と衝突すること、ライブリロード機構が無いこと — `harness/tools/writeup-kit/bin/serve.mjs`、`self-check.mjs` の直接確認
- LazyVim / custom(kickstart) ディストリに `render-markdown.nvim` が既に配線済み、nvchad・astrovim には未配線 — `home/shared/nvim/lazyvim/lua/plugins/markdown.lua` ほかの直接確認

## 注意点

- mdts が Omarchy（Hyprland/Wayland）上で `npx mdts` からブラウザが実際に自動で開くかは実機検証していない。
- mo 作者ではなく mdts 作者自身が書いた比較記事の評価（◯/△/❌）は独立した第三者検証を経ていない。
- VS Code/Cursor の mermaid 対応拡張はこのリポジトリでは macOS 専用パスにしか無く、Omarchy 側には届いていない（既存の欠落）。
- nvchad・astrovim を使う場合は `render-markdown.nvim` が未配線のため、同じ体験を得るには小さな追加設定が要る。
