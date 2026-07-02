---
name: keymap-help
description: "Neovimのキーバインドを調べる。「このキーなんだっけ？」「dotfilesでカスタムしたやつ何だっけ？」に答える。実行時にアクティブなdistro(lazyvim/nvchad/astrovim/custom)を自動判定し、headless nvimで全キーマップを実ダンプ、dotfilesで自作したものは★で区別。どのディレクトリからでも実行可能。nvimのキーマップ/keymap/keybinding/ショートカットを聞かれたら使う。"
---

# keymap-help — Neovim キーマップヘルパー

Neovim のキーバインドを調べるスキル。次の3つの悩みを解決する:

1. **このキーバインドなんだっけ…?** → キー or 説明で横断検索
2. **dotfilesでカスタムしたけど忘れた…** → 自作キーだけ ★ で抽出
3. **他のdirから参照するの面倒…** → cwd非依存。どこからでも動く

## 仕組み

- `~/.config/nvim` のシンボリックリンクから**アクティブなdistroを実行時に判定**する
  （lazyvim / nvchad / astrovim / custom を `nvim-switch` で切替可能なため、ハードコードしない）
- **headless nvim** を起動し `VeryLazy` を発火 → `nvim_get_keymap` で全モードの
  キーマップを実ダンプする（framework既定 + プラグイン + 自作、500件超）。
  leader/localleader は `<leader>` / `<localleader>` に展開して表示。
- グローバルマップに載らない**バッファローカル/遅延登録キー**（特に `gd` `gr` `gI`
  `gy` など LspAttach 時のみ張られる LSP 系）は、`lazy.core.config` のプラグイン
  spec（`keys` と lspconfig の `opts.servers[*].keys`）から補完取得する。
  4 distro とも lazy.nvim ベースなので横断的に効く。
- **既知の穴**: treesitter-textobjects の移動キー（`]f` `[f` `]c` `]a` 等）は
  `opts.(textobjects.)move.keys` に定義されFileType時登録のため、実ダンプにも
  spec補完にも載らない。関数/クラス/引数への移動を聞かれて0件のときは、
  `nvim-treesitter-textobjects` のspec（lazyvimなら
  `~/.local/share/nvim/lazy/` 配下 or dotfilesのplugin設定）を直接読んで答える。
- headless 起動の lua は一時ファイル経由（`luafile`）で渡し argv を極小化。
  環境変数が肥大化したセッションでも `posix_spawn` の `E2BIG` を踏みにくくしている。
- アクティブなdistroの**dotfiles設定ディレクトリだけ**をgrepして自作キーを特定する。
  この配下には framework 本体（`~/.local/share/nvim`）は含まれないので、
  ここで見つかる lhs は必然的にユーザーのカスタム → ★ で注釈。
- ダンプ結果はdistroごとにキャッシュ（1h TTL + config変更で自動失効）。初回のみ約3秒、
  以降 ~0.1秒。`--refresh` で強制再取得。

## 使い方

ヘルパースクリプトを実行する（**cwd不問**、絶対パスで呼ぶ）:

```bash
SC="$HOME/.claude/skills/keymap-help/scripts/nvim-keymaps.sh"
# symlink破損時はdotfiles実体にfallback
[ -f "$SC" ] || SC="$HOME/go/github.com/esh2n/dotfiles/domains/dev/config/claude-profiles/base/skills/keymap-help/scripts/nvim-keymaps.sh"

bash "$SC"                    # 全キーマップ (customは★)
bash "$SC" git                # "git" を含むlhs/説明を横断検索
bash "$SC" find files         # 複数語はAND検索
bash "$SC" -c                 # dotfilesでカスタムしたキーだけ
bash "$SC" -c herdr           # 自作キーの中から "herdr" 検索
bash "$SC" -k '<leader>ff'    # このキーの動作は？(完全一致)
bash "$SC" -m v git           # visualモードに絞って検索
bash "$SC" --distro           # 今どのdistroが有効か + 設定パス
bash "$SC" --refresh          # ダンプ再取得
bash "$SC" --raw              # TSV出力 (mode\tlhs\tdesc\tcustom) — 加工用
```

スクリプトが `~/.claude/skills/` 経由で見つからない場合は dotfiles 内の実体を使う:
`domains/dev/config/claude-profiles/base/skills/keymap-help/scripts/nvim-keymaps.sh`

## 応答方針（agent向け）

ユーザーが nvim のキーバインド・ショートカット・keymap について聞いたら:

1. まず `nvim-keymaps.sh <query>` で調べる。「自分がカスタムしたやつ」を聞かれたら `-c`。
   descは英語なので、日本語で聞かれたら英語キーワード（next/function/buffer等）に変換して検索。0件なら同義語（func/method/motion等）も試す。
2. 結果をそのまま貼るのではなく、**関連するものを絞って提示**する。★付き（自作）を優先的に案内。
3. 該当0件なら自分で `--refresh` を実行して再検索 → それでも0件なら同義語で再検索 → 最後は `--distro` が示すconfig dirのlazy specを直接調べる（上記「既知の穴」参照）。ユーザーに操作を促して終わりにしない。
4. 出力の見方: `★` = dotfiles自作 / 列は `mode  lhs  説明`（説明が無いキーはrhsコマンドが表示される）。mode は n=normal, i=insert,
   v=visual, x=visual-block系, o=operator, t=terminal, c=command。

### sandbox で spawn が失敗したときの fallback（重要）

Bash 実行が **`E2BIG` / `posix_spawn` / sandbox 関連の spawn エラー**で失敗した場合、
script のバグではなく **Claude Code のサンドボックスがコマンドをラップした際の argv 肥大**
（巨大 monorepo で seatbelt プロファイルが膨れる）が原因。script 本体は実行前に落ちている。

このとき、**同じコマンドを Bash tool の `dangerouslyDisableSandbox: true` を付けて再実行**する。
その1コマンドだけサンドボックス外で走り、プロジェクトの sandbox 設定自体は変更しない。

- この skill は**読み取り専用**（nvim 設定を読む + headless nvim + 自分のキャッシュ `~/.cache/keymap-help/` に書くだけ）なので、この用途に限りサンドボックス外実行は低リスク。
- 恒久対策を望むユーザーには、プロジェクトの sandbox `excludedCommands` に
  `bash *nvim-keymaps.sh*` 等を追加する方法を案内してもよい（sandbox は有効なまま、この
  スクリプトだけ除外）。sandbox 全体を `enabled: false` にするのは勧めない。

## 出力例

```
# active: lazyvim | custom only (3件)  ★=dotfilesでカスタム

★  n   <leader>zf              herdr: send file path to agent
★  v   <leader>zl              herdr: send file path + line range to agent
★  x   <leader>zl              herdr: send file path + line range to agent
```

## 前提

- `nvim` が PATH にあること。
- headless起動で設定が正常にロードできること（壊れている場合はエラーを表示）。
