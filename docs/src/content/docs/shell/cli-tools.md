---
title: CLI Tools
description: 標準 command を置き換える modern な CLI tool 群。
---

## Multi-shell 対応

Zsh と Fish の両方で同じ alias と環境変数を使える。共通の設定は shell 間で共有されるため、どちらを使っても同じ体験が得られる。

## Tool 一覧

| Tool | 役割 |
|------|------|
| eza | `ls` の代替。color 表示と icon 付き |
| bat | `cat` の代替。syntax highlight 付き |
| sk (skim) | fuzzy finder |
| zoxide | `cd` の代替。使用履歴から賢く jump |
| atuin | shell history の検索と同期 |
| yazi | terminal file manager |
| vivid | LS_COLORS の生成 |
| btop | system monitor |
| thefuck | 直前の command miss を自動修正 |

## よく使う key 操作

| 操作 | 説明 |
|------|------|
| `Ctrl+R` | history 検索 (atuin) |
| `y` | file manager を開く (yazi、終了時に自動 cd) |
| `z <dir>` | directory に jump (zoxide) |
| `zi` | directory を interactive に選択 (zoxide) |
| `btop` | system monitor を起動 |
| `fuck` | 直前の command を修正して再実行 (thefuck) |

入力中は gray の text で suggest が表示される (zsh-autosuggestions)。

## Prompt

Starship を Zsh / Fish 共通の prompt として使用。Git の status、言語 version、command 実行時間、error code などが表示される。詳細は [Starship](/dotfiles/shell/starship/) を参照。
