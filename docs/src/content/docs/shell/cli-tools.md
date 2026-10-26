---
title: CLI Tools
description: 標準 command を置き換える modern な CLI tool 群。
---

## Shell

shellはZshだけを使う。aliasと環境変数は`home/shared/zsh`にまとまっている。

## Tool一覧

| Tool | 役割 |
|------|------|
| eza | `ls`の代替。color表示とicon付き |
| bat | `cat`の代替。syntax highlight付き |
| sk (skim) | fuzzy finder |
| zoxide | `cd`の代替。使用履歴から賢くjump |
| atuin | shell historyの検索と同期 |
| yazi | terminal file manager |
| vivid | LS_COLORSの生成 |
| btop | system monitor |
| pay-respects | 直前のcommand missを自動修正 |

## よく使うkey操作

| 操作 | 説明 |
|------|------|
| `Ctrl+R` | history検索 (atuin) |
| `y` | file managerを開く (yazi、終了時に自動cd) |
| `z <dir>` | directoryにjump (zoxide) |
| `zi` | directoryをinteractiveに選択 (zoxide) |
| `btop` | system monitorを起動 |
| `f` | 直前のcommandを修正して再実行 (pay-respects) |

入力中はgrayのtextでsuggestが表示される (zsh-autosuggestions)。

## Prompt

StarshipをZshのpromptとして使用。Gitのstatus、言語version、command実行時間、error codeなどが表示される。詳細は [Starship](/dotfiles/shell/starship/) を参照。
