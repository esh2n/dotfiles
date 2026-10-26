# k1LoW/moが使えなくなった後、Markdownをどう「きれいに見る」か（macOS/Omarchy両対応）

確認日: 2026-09-26

## 答え

k1LoW/mo（GFM + mermaid + ライブリロードをブラウザで見せる単一Goバイナリ）はnixpkgsの`pkgs.mo`が無関係な別ツール（Bash用Moustacheテンプレートエンジン）に占有されているため、Nixパッケージ化には名前衝突の回避が要る。用途別に使い分けるのが妥当で、mo一本の完全な代替は無い。

- ターミナルで素早く読む用途は`glow`（charmbracelet/glow）が事実上の標準。nixpkgsに既にありupstream最新と一致、star数も圧倒的。mermaid・ライブリロードは無い。
- エディタで書きながら見る用途は、Neovimの`render-markdown.nvim`（Treesitterベースのバッファ内装飾）が既に配線されているディストリ（LazyVim、custom/kickstart系）では追加コストがゼロ。ただしmermaidは出ない。
- ブラウザでGFM + mermaid + ライブリロードをまとめて見たいmoの本来の用途には、`npx mdts`（unhappychoice/mdts）が最も近い後継候補。インストール不要（Node.jsがあれば良い）でmacOS/Omarchy同一コマンド、mermaid・PlantUML・GFM・ライブリロード・ディレクトリツリー表示を実装として確認できた。ただしstar 250・単独開発者のプロジェクトでmoほどの実績は無い。`markserv`はより長い実績を持つが機能面で見劣りする（mermaid部分対応、全文検索なし）。

writeup-kit / writeupスキルは「今すぐこの .mdを見る」用途の代替にはならない。設計方向がそもそも逆（HTML→Markdown変換であり逆方向は無い）、ライブリロード機構がゼロから無い、self-checkゲートが任意の構造を拒む、ゼロ依存原則がGFM/mermaidパーサ追加と衝突する。

## 根拠

- `pkgs.mo`がBash用Moustacheテンプレートエンジンと名前衝突していること — nixpkgs `pkgs/by-name/mo/mo/package.nix`（`tests-always-included/mo`）
- glowがnixpkgs既存・upstream最新一致・star 27,474 — nixpkgs `pkgs/by-name/gl/glow`、GitHub API
- mdtsがmoとほぼ同じ機能集合（GFM/mermaid/ライブリロード/検索/テーマ）を実装として持つこと — https://github.com/unhappychoice/mdts（README、package.json の依存: markdown-it、chokidar、ws）
- markservはmermaid部分対応・全文検索なしでmoの部分集合 — mo作者ではなくmdts作者による比較記事の評価表
- writeup-kitがゼロ依存設計でありGFM/mermaidパーサ追加と衝突すること、ライブリロード機構が無いこと — `harness/tools/writeup-kit/bin/serve.mjs`、`self-check.mjs`の直接確認
- LazyVim / custom(kickstart) ディストリに`render-markdown.nvim`が既に配線済み、nvchad・astrovimには未配線 — `home/shared/nvim/lazyvim/lua/plugins/markdown.lua`ほかの直接確認

## 注意点

- mdtsがOmarchy（Hyprland/Wayland）上で`npx mdts`からブラウザが実際に自動で開くかは実機検証していない。
- mo作者ではなくmdts作者自身が書いた比較記事の評価（◯/△/❌）は独立した第三者検証を経ていない。
- VS Code/Cursorのmermaid対応拡張はこのリポジトリではmacOS専用パスにしか無く、Omarchy側には届いていない（既存の欠落）。
- nvchad・astrovimを使う場合は`render-markdown.nvim`が未配線のため、同じ体験を得るには小さな追加設定が要る。
