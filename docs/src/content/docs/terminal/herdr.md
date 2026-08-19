---
title: Herdr
description: コーディングエージェント向けターミナルマルチプレクサ Herdr の設定と使い方。
---

[Herdr](https://herdr.dev) は、コーディングエージェント（Claude Code / Codex / OpenCode など）を
1 つのターミナルから扱うためのマルチプレクサ。tmux に近い操作感のまま、各ペインで動くエージェントの
状態（working / blocked / idle）を認識し、SSH 越しのリモートマシンでも同じセッションを扱える。

- 設定ファイル: `~/.config/herdr/config.toml`（dotfiles では `domains/dev/config/herdr/config.toml`）
- インストール: `homebrew.nix` の `brew "herdr"`（nixpkgs 未収録のため Homebrew 経由）
- prefix key は tmux / Zellij / WezTerm と統一で `Ctrl+q`

## 概念

Workspace（リポジトリ単位）> Tab（作業 / エージェント単位）> Pane（実ターミナル）の 3 階層。
あるペインでエージェントを起動すると、Herdr がそれを **agent ペイン**として認識し、
サイドバーに状態を表示する。

## 起動

```bash
herdr          # 起動 / デフォルトセッションに接続
```

プロジェクトの `cd` 先で起動するとそのリポジトリ用に立ち上がる。デタッチしてもサーバ側で
セッションとエージェントは動き続け、再度 `herdr` で再接続できる。

## Keybindings

prefix key は `Ctrl+q`。`Ctrl+q` → `x` は「prefix を押してから x」の意味。

### Prefix なし

| Key | 操作 |
|-----|------|
| `Alt+l` / `Alt+h` | 次 / 前の tab（tmux の `M-l`/`M-h` に合わせて設定） |
| `Alt+j` / `Alt+k` | 次 / 前の Workspace（サイドバーの縦軸に対応） |

### Prefix mode (`Ctrl+q` →)

| Key | 操作 |
|-----|------|
| `c` | 新規 tab |
| `1`–`9` | tab 1–9 に切替 |
| `Shift+t` | tab 名変更 |
| `\` | 縦分割（左右） |
| `-` | 横分割（上下） |
| `h`/`j`/`k`/`l` | pane 間の focus 移動 |
| `p` | 直前の pane へ戻る（2 pane 間の往復に） |
| `Alt+1`–`Alt+9` | サイドバーの N 番目の agent へ直接ジャンプ |
| `z` | pane をズーム |
| `r` | リサイズモード（`h`/`j`/`k`/`l` でサイズ調整） |
| `x` | pane を閉じる |
| `[` | コピーモード |
| `e` | スクロールバックを `$EDITOR` で開く（長い出力の検索・コピーに） |
| `g` | goto（インクリメンタル検索で Workspace / tab へ飛ぶ） |
| `o` | 最後に通知を出した agent の pane へジャンプ |
| `Shift+n` | 新規 Workspace |
| `Shift+g` | git worktree を作成して Workspace として開く（下記） |
| `w` | Workspace 選択 |
| `Shift+p` | pane 名変更（ボーダーの agent ラベルを上書き） |
| `b` | サイドバー開閉 |
| `s` | アプリ内設定画面 |
| `q` | デタッチ（裏で継続） |
| `Shift+r` | 設定を再読み込み |
| `?` | アプリ内ヘルプ |

dotfiles で変えているのは `\`/`-`/`Alt+h`/`Alt+l`/`Alt+j`/`Alt+k`/`p`/`Alt+1..9` と後述の popup。
それ以外は Herdr のデフォルト（既に tmux 風）。全一覧は `herdr --default-config` で確認できる。

## Popup（floating / 一時ウィンドウ）

タブのレイアウトを崩さずに浮かせるターミナル。任意の pane を後から float 化する
トグルはなく、`[[keys.command]]` で「このコマンドをこのキーで開く」を事前定義する方式。
type は 3 種類：

- `popup` — セッションモーダルな浮きターミナル。閉じれば元の画面にそのまま戻る
- `pane` — 一時 pane。コマンド終了で自動的に閉じる
- `shell` — 画面を出さずバックグラウンド実行

dotfiles では popup を 4 つ定義している：

| Key | 開くもの | サイズ |
|-----|---------|--------|
| `Alt+e` | nvim | 92% |
| `Alt+g` | lazygit | 90% |
| `f` | yazi | 85% |
| `t` | スクラッチシェル | 70%×60% |

popup は cwd を引き継がないため、各コマンドが `HERDR_ACTIVE_PANE_CWD`
（Herdr がフォーカス中 pane の cwd として export する変数）へ自分で `cd` している。
新しい popup を足すときも同じパターンで：

```toml
[[keys.command]]
key = "prefix+alt+b"
type = "popup"
command = "btop"
width = "85%"
height = "85%"
```

## git worktree 統合

`Ctrl+q` → `Shift+g` で現リポジトリの worktree を新規作成し、そのまま Workspace として開く。
ブランチごとに独立した作業コピーを 1 キーで用意できるので、エージェントの並行作業に向く。
worktree 本体は `~/.herdr/worktrees` に置かれる。

## Neovim 連携

Herdr のペイン内で Neovim を開いているときだけ有効になる（通常のターミナルや tmux/zellij では
キーマップ自体が登録されず無影響）。lazyvim / custom / nvchad / astrovim の全ディストロに対応。

| Key | 動作 |
|-----|------|
| `<leader>zf`（ノーマル） | 現在ファイルのパスを、同じ tab の最初のエージェントに送る（`@path`） |
| `<leader>zl`（ビジュアル選択後） | パス + 選択行範囲を送る（`@path#L10-22`） |

テキストを**挿入するだけで Enter は押さない**ため、`@path` が入った後に続けて指示を書いて自分で送信する。
`HERDR_ENV` などの環境変数（Herdr がペインに export）を使って対象エージェントを特定している。

## 通知

エージェントが完了 / 入力待ちになるとデスクトップ通知が出る。

```toml
[ui.toast]
delivery = "terminal"   # Ghostty / WezTerm 経由。SSH 越しでもローカル端末に届く
```

音は既定で ON（`[ui.sound] enabled = true`）。共有マシンでは `enabled = false` にする。

## 日本語 IME 対策

`[experimental]` で 2 つ有効化している（いずれも macOS 向け）：

- `switch_ascii_input_source_in_prefix` — IME が prefix 後のキーを飲み込むため、
  prefix モード中だけ入力ソースを ASCII に切り替え、抜けたら元に戻す
- `reveal_hidden_cursor_for_cjk_ime` — Claude Code / Codex が独自カーソルを描くせいで
  IME 変換候補ウィンドウが迷子になるのを防ぐ。外側ターミナルに実カーソルを見せる
  （`cjk_ime_agents = ["claude", "codex"]` に限定し、vim のノーマルモードに
  二重カーソルが出ないようにしている）

## CLI

```bash
herdr pane list                       # ペイン一覧（JSON、agent フィールドで判別）
herdr pane send-text <pane_id> "text" # ペインにテキスト挿入
herdr pane split --direction right    # 分割
herdr --default-config                # デフォルト設定を出力
herdr --help
```

## リモート / セッション継続

デタッチ（`Ctrl+q` → `q`）してもサーバ上でエージェントは動き続ける。リモートに SSH して
`herdr` を起動すれば、そのマシンのセッションを同じ操作感で扱える。
