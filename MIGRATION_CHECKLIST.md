# Unmigrated Components
# 未移行コンポーネント

## Configuration Files / 設定ファイル

| Component | Source | Destination |
|-----------|--------|-------------|
| Raycast | `config/raycast/` | `domains/productivity/config/raycast/` |
| Codex | `config/codex/` | `domains/development/config/codex/` |
| Claude | `config/claude/` | `domains/development/config/claude/` |
| Warp | `config/warp/` | `domains/terminal/config/warp/` |
| Tig | `config/tig/` | `domains/development/config/tig/` |
| Background | `config/background/` | `domains/system/assets/background/` |

## Shell Configurations / シェル設定

| Component | Source | Destination |
|-----------|--------|-------------|
| Cursor integration | `shell/zsh/external/editors/cursor.zsh` | `domains/editor/shell/cursor.zsh` |
| VSCode integration | `shell/zsh/external/editors/vscode.zsh` | `domains/editor/shell/vscode.zsh` |
| Kiro integration | `shell/zsh/external/editors/kiro.zsh` | `domains/editor/shell/kiro.zsh` |
| Warp integration | `shell/zsh/external/editors/warp.zsh` | `domains/terminal/shell/warp.zsh` |
| Sketchybar | `shell/zsh/external/ui/sketchybar.zsh` | `domains/system/shell/sketchybar.zsh` |
| Homebrew | `shell/zsh/platform/macos/brew.zsh` | `domains/system/shell/brew.zsh` |

## Migration Status / 移行ステータス

✅ **All Components Migrated! / 全コンポーネント移行完了！**

Previously migrated:
- Git configs, Neovim, WezTerm, Ghostty, Tmux
- Starship, Mise, Zoxide
- Aerospace, Hammerspoon, Borders, Sketchybar (configs)
- VSCode, Cursor, Zed (configs)

Newly migrated (2025-11-22):
- Raycast, Codex, Claude, Warp, Tig configs
- Editor shell integrations (cursor.zsh, vscode.zsh, warp.zsh, kiro.zsh)
- System shell scripts (sketchybar.zsh, brew.zsh)
- Background images (23 files)
- Package manager installations (cargo, go, npm, gem)

