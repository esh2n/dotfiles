---
title: Configuration
description: Where configs live, templates, environment variables, personal settings.
---

## Where configs live

Each app's config sits beside its module (`next/home/<os>/<app>/config/`).
`~/.config/<app>` and the like are links to it, so an edit takes effect the
next time the app starts, without a rebuild.

## Templates

Configs that cannot read environment variables — VS Code's `settings.json`,
mise's `config.toml`, `~/.gitconfig` — are kept as `*.template`. Every switch
renders them beside themselves (`dotctl templates render`), filling in
`{{HOME}}`, `{{USER}}` and `{{DOTFILES_ROOT}}`. The rendered files are ignored
by git.

## Environment variables

WezTerm's weather widget needs an OpenWeather API key. Create `.env` at the
checkout's root:

```bash
OPENWEATHER_API_KEY=your-api-key
```

Lookup order: the `OPENWEATHER_API_KEY` variable, `$DOTFILES_ROOT/.env`,
`~/dotfiles/.env`, then paths relative to the config directory.
`DOTFILES_ROOT` is set by zsh from where `~/.zshrc` links to.

## Personal settings

| File | Purpose |
|------|---------|
| `~/.config/git/config.local` | Git name and email (written by `make up` from `.env`'s `GIT_USER_NAME` / `GIT_USER_EMAIL`) |
| `next/home/shared/git/config/conditional/*.conf` | per-directory Git settings (machine-local, untracked) |
| `~/.config/jj/conf.d/user.toml` | Jujutsu user settings |
| `~/.zshrc.local` | zsh settings for this machine only |

## Directory layout

```text
dotfiles/
├── next/                 # the flake
│   ├── lib/              #   facts, builders, services, setup steps
│   ├── roles/            #   what each role turns on
│   ├── system/darwin/    #   nix-darwin: defaults, Homebrew, browsers
│   ├── home/             #   home-manager: one directory per app, config beside its module
│   │   ├── shared/       #     both platforms
│   │   ├── darwin/       #     macOS only
│   │   └── linux/        #     Omarchy only
│   └── pkgs/             #   packages built here, dotctl among them
├── domains/dev/          # coding-agent harness (jig) and its configs, moving to harness/
├── tests/                # bats
└── docs/                 # this site
```
