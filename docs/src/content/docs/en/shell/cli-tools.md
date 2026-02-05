---
title: CLI Tools
description: Modern replacements for standard Unix commands.
---

## Multi-shell support

Both Zsh and Fish share the same aliases and environment variables. The common config is shared between shells, so you get the same experience regardless of which one you use.

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
| thefuck | auto-corrects your last command |

## Common shortcuts

| Key | What it does |
|-----|-------------|
| `Ctrl+R` | Search history (atuin) |
| `y` | Open file manager (yazi, auto-cd on exit) |
| `z <dir>` | Jump to directory (zoxide) |
| `zi` | Pick directory interactively (zoxide) |
| `btop` | Launch system monitor |
| `fuck` | Fix and re-run last command (thefuck) |

Gray text appears as you type showing suggestions (zsh-autosuggestions).

## Prompt

Starship is the shared prompt for both Zsh and Fish. It shows git status, language versions, command duration, and error codes.
