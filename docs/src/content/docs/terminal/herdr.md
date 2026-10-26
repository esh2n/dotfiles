---
title: Herdr
description: コーディングエージェント向けターミナルマルチプレクサ Herdr の設定と使い方。
---

[Herdr](https://herdr.dev) は、コーディングエージェント（Claude Code / Codex / OpenCodeなど）を
1つのターミナルから扱うためのマルチプレクサ。tmuxに近い操作感のまま、各ペインで動くエージェントの
状態（working / blocked / idle）を認識し、SSH越しのリモートマシンでも同じセッションを扱える。

- 設定ファイル: `~/.config/herdr/config.toml`（dotfilesでは`home/shared/herdr/config/config.toml`）
- インストール: macOSは`pkgs.herdr`（`home/darwin/herdr/default.nix`）、LinuxはOmarchyの`/usr/bin/herdr`
- prefix keyはtmux / Zellij / WezTermと統一で`Ctrl+q`

## 概念

Workspace（リポジトリ単位）> Tab（作業 / エージェント単位）> Pane（実ターミナル）の3階層。
あるペインでエージェントを起動すると、Herdrがそれを **agentペイン**として認識し、
サイドバーに状態を表示する。

## 起動

```bash
herdr          # 起動 / デフォルトセッションに接続
```

プロジェクトの`cd`先で起動するとそのリポジトリ用に立ち上がる。デタッチしてもサーバ側で
セッションとエージェントは動き続け、再度`herdr`で再接続できる。

## Keybindings

prefix keyは`Ctrl+q`。`Ctrl+q` → `x`は「prefixを押してからx」の意味。

### Prefixなし

| Key | 操作 |
|-----|------|
| `Alt+l` / `Alt+h` | 次 / 前のtab（tmuxの`M-l`/`M-h`に合わせて設定） |
| `Alt+j` / `Alt+k` | 次 / 前のWorkspace（サイドバーの縦軸に対応） |

### Prefix mode (`Ctrl+q` →)

| Key | 操作 |
|-----|------|
| `c` | 新規tab |
| `1`–`9` | tab 1–9に切替 |
| `Shift+t` | tab名変更 |
| `\` | 縦分割（左右） |
| `-` | 横分割（上下） |
| `h`/`j`/`k`/`l` | pane間のfocus移動 |
| `p` | 直前のpaneへ戻る（2 pane間の往復に） |
| `Alt+1`–`Alt+9` | サイドバーのN番目のagentへ直接ジャンプ |
| `z` | paneをズーム |
| `r` | リサイズモード（`h`/`j`/`k`/`l`でサイズ調整） |
| `x` | paneを閉じる |
| `[` | コピーモード |
| `e` | スクロールバックを`$EDITOR`で開く（長い出力の検索・コピーに） |
| `g` | goto（インクリメンタル検索でWorkspace / tabへ飛ぶ） |
| `o` | 最後に通知を出したagentのpaneへジャンプ |
| `Shift+n` | 新規Workspace |
| `Shift+g` | git worktreeを作成してWorkspaceとして開く（下記） |
| `w` | Workspace選択 |
| `Shift+p` | pane名変更（ボーダーのagentラベルを上書き） |
| `b` | サイドバー開閉 |
| `s` | アプリ内設定画面 |
| `q` | デタッチ（裏で継続） |
| `Shift+r` | 設定を再読み込み |
| `?` | アプリ内ヘルプ |

dotfilesで変えているのは`\`/`-`/`Alt+h`/`Alt+l`/`Alt+j`/`Alt+k`/`p`/`Alt+1..9`と後述のpopup。
それ以外はHerdrのデフォルト（既にtmux風）。全一覧は`herdr --default-config`で確認できる。

## Popup（floating / 一時ウィンドウ）

タブのレイアウトを崩さずに浮かせるターミナル。任意のpaneを後からfloat化する
トグルはなく、`[[keys.command]]`で「このコマンドをこのキーで開く」を事前定義する方式。
typeは3種類：

- `popup` — セッションモーダルな浮きターミナル。閉じれば元の画面にそのまま戻る
- `pane` — 一時pane。コマンド終了で自動的に閉じる
- `shell` — 画面を出さずバックグラウンド実行

dotfilesではpopupを4つ定義している：

| Key | 開くもの | サイズ |
|-----|---------|--------|
| `Prefix + Alt+e` | nvim | 92% |
| `Prefix + Alt+g` | lazygit | 90% |
| `Prefix + f` | yazi | 85% |
| `Prefix + t` | スクラッチシェル | 70%×60% |

popupはcwdを引き継がないため、各コマンドが`HERDR_ACTIVE_PANE_CWD`
（Herdrがフォーカス中paneのcwdとしてexportする変数）へ自分で`cd`している。
新しいpopupを足すときも同じパターンで：

```toml
[[keys.command]]
key = "prefix+alt+b"
type = "popup"
command = "btop"
width = "85%"
height = "85%"
```

## git worktree統合

`Ctrl+q` → `Shift+g`で現リポジトリのworktreeを新規作成し、そのままWorkspaceとして開く。
ブランチごとに独立した作業コピーを1キーで用意できるので、エージェントの並行作業に向く。
worktree本体は`~/.herdr/worktrees`に置かれる。

## Neovim連携

Herdrのペイン内でNeovimを開いているときだけ有効になる（通常のターミナルやtmux/zellijでは
キーマップ自体が登録されず無影響）。lazyvim / custom / nvchad / astrovimの全ディストロに対応。

| Key | 動作 |
|-----|------|
| `<leader>zf`（ノーマル） | 現在ファイルのパスを、同じtabの最初のエージェントに送る（`@path`） |
| `<leader>zl`（ビジュアル選択後） | パス + 選択行範囲を送る（`@path#L10-22`） |

テキストを**挿入するだけでEnterは押さない**ため、`@path`が入った後に続けて指示を書いて自分で送信する。
`HERDR_ENV`などの環境変数（Herdrがペインにexport）を使って対象エージェントを特定している。

## 通知

エージェントが完了 / 入力待ちになるとデスクトップ通知が出る。

```toml
[ui.toast]
delivery = "terminal"   # Ghostty / WezTerm 経由。SSH 越しでもローカル端末に届く
```

音は既定でON（`[ui.sound] enabled = true`）。共有マシンでは`enabled = false`にする。

## 日本語IME対策

`[experimental]`で2つ有効化している（いずれもmacOS向け）：

- `switch_ascii_input_source_in_prefix` — IMEがprefix後のキーを飲み込むため、
  prefixモード中だけ入力ソースをASCIIに切り替え、抜けたら元に戻す
- `reveal_hidden_cursor_for_cjk_ime` — Claude Code / Codexが独自カーソルを描くせいで
  IME変換候補ウィンドウが迷子になるのを防ぐ。外側ターミナルに実カーソルを見せる
  （`cjk_ime_agents = ["claude", "codex"]`に限定し、vimのノーマルモードに
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

デタッチ（`Ctrl+q` → `q`）してもサーバ上でエージェントは動き続ける。リモートにSSHして
`herdr`を起動すれば、そのマシンのセッションを同じ操作感で扱える。
