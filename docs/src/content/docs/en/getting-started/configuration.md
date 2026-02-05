---
title: Configuration
description: Symlink management, templates, and environment variables.
---

## Symlink management

```bash
# Re-create symlinks
./core/config/manager.sh link

# Process templates
./core/config/manager.sh template
```

## Template system

Some config files (VSCode `settings.json`, Mise `config.toml`) can't use environment variables directly. These use `.template` files with `{{HOME}}` as a placeholder.

```bash
# Generate config files from templates
./core/config/manager.sh template
```

`{{HOME}}` gets replaced with your actual home directory. Generated files are gitignored — only `.template` files are tracked.

## Environment variables

The WezTerm weather widget needs an OpenWeather API key.

Create `.env` at the dotfiles root:

```bash
OPENWEATHER_API_KEY=your-api-key
```

Lookup order:
- `OPENWEATHER_API_KEY` env var
- `$DOTFILES_ROOT/.env`
- `~/dotfiles/.env`
- Relative paths from config directories

For Lua-based configs (WezTerm), add `DOTFILES_ROOT` to your shell config:

```bash
export DOTFILES_ROOT="$HOME/go/github.com/esh2n/dotfiles/dotfiles"
```

## User-specific config

Personal settings go in these files:

| File | Purpose |
|------|---------|
| `~/.config/git/config.local` | Git identity and preferences |
| `~/.config/jj/conf.d/user.toml` | Jujutsu user settings (name, email) |
| `domains/dev/home/.zshenv` | Shell environment variables |

## Directory layout

```text
dotfiles/
├── core/          # Installer, config manager, utilities
├── domains/       # Domain-specific configurations
│   ├── creative/  # Media tools, wallpapers
│   ├── dev/       # Neovim, terminals, shells, languages
│   ├── infra/     # Network, security
│   ├── system/    # Fonts, colors, themes
│   └── workspace/ # Window managers, status bars
└── specs/         # Architecture docs
```
