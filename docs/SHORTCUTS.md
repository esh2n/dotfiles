# Zshショートカット一覧

## ファイル操作系

| キー | 説明 | コマンド |
|------|------|----------|
| `Ctrl + ]` | プロジェクトディレクトリに移動 | `sk_select_src` |
| `Ctrl + v` | プロジェクト内のファイルを選択 | `sk_select_file_within_project` |
| `Ctrl + b` | カレントディレクトリ以下のファイルを選択 | `sk_select_file_below_pwd` |
| `Ctrl + e` | ディレクトリを変更 | `sk_change_directory` |
| `Ctrl + g` | zoxideを使用してディレクトリを変更 | `sk_change_directory` |

## 履歴系

| キー | 説明 | コマンド |
|------|------|----------|
| `Ctrl + r` | コマンド履歴を検索 | `sk_select_history` |
| `Ctrl + p` | 履歴の前方検索 | `history-beginning-search-backward-end` |
| `Ctrl + n` | 履歴の後方検索 | `history-beginning-search-forward-end` |

## 移動系

| キー | 説明 | コマンド |
|------|------|----------|
| `Alt + →` | 単語単位で前に移動 | `forward-word` |
| `Alt + ←` | 単語単位で後ろに移動 | `backward-word` |

## Vimモード

| キー | 説明 | コマンド |
|------|------|----------|
| `gg` | 行頭に移動（Vimモード時） | `beginning-of-line` |
| `G` | 行末に移動（Vimモード時） | `end-of-line` |

## エイリアス

よく使用するエイリアスも合わせて記載します：

| エイリアス | 説明 | コマンド |
|------------|------|----------|
| `vv` | ファイルを選択してVimで開く | `sk_edit_file` |
| `c` | ディレクトリを変更 | `sk_change_directory` |
| `b` | カレントディレクトリ以下のファイルを選択 | `sk_select_file_below_pwd` |
| `ghl` | ghqで管理しているリポジトリに移動 | `cd $(ghq root)/$(fast_ghl | sk)` |

## 注意事項

- これらのショートカットの多くは`sk`（skim）というファジーファインダーを利用しています
- Vimモードが有効になっているため、`ESC`キーでコマンドモードに切り替えることができます
- モードの状態は右プロンプトに表示されます（`INSERT`/`NORMAL`） 