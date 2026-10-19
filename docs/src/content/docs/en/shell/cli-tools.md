---
title: CLI Tools
description: Modern replacements for standard Unix commands.
---

## Shell

Zsh is the only shell. Aliases and environment variables live in `home/shared/zsh`.

## Tool list

| Tool | Replaces |
|------|----------|
| eza | `ls` — with colors and icons |
| bat | `cat` — with syntax highlighting |
| sk (skim) | fuzzy finder |
| zoxide | `cd` — jumps based on usage history |
| atuin | shell history search and sync |
| yazi | terminal file manager |
| vivid | LS_COLORS generator |
| btop | system monitor |
| pay-respects | auto-corrects your last command |

## Common shortcuts

| Key | What it does |
|-----|-------------|
| `Ctrl+R` | Search history (atuin) |
| `y` | Open file manager (yazi, auto-cd on exit) |
| `z <dir>` | Jump to directory (zoxide) |
| `zi` | Pick directory interactively (zoxide) |
| `btop` | Launch system monitor |
| `f` | Fix and re-run last command (pay-respects) |

Gray text appears as you type showing suggestions (zsh-autosuggestions).

## Prompt

Starship is the Zsh prompt. It shows git status, language versions, command duration, and error codes.
