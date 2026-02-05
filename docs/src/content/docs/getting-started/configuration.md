---
title: 構成
description: Symlink、template system、環境変数について。
---

## Symlink の管理

```bash
# symlink を再作成
./core/config/manager.sh link

# template を処理
./core/config/manager.sh template
```

## Template system

VSCode の `settings.json` や Mise の `config.toml` など、環境変数を直接使えない設定ファイルがある。こうしたファイルは `.template` で管理し、`{{HOME}}` を placeholder として埋め込んでいる。

```bash
# template から設定ファイルを生成
./core/config/manager.sh template
```

`{{HOME}}` は実際の home directory に置換される。生成ファイルは git に含まず、`.template` だけを track する。

## 環境変数

WezTerm の天気 widget には OpenWeather API key が必要。

dotfiles root に `.env` を作成する。

```bash
OPENWEATHER_API_KEY=your-api-key
```

読み込み先の優先順位:
- 環境変数 `OPENWEATHER_API_KEY`
- `$DOTFILES_ROOT/.env`
- `~/dotfiles/.env`
- 設定 directory からの相対 path

Lua ベースの設定 (WezTerm) では `DOTFILES_ROOT` を shell 設定に追加する。

```bash
export DOTFILES_ROOT="$HOME/go/github.com/esh2n/dotfiles/dotfiles"
```

## 個人設定

user 固有の設定は以下に配置する。

| File | 用途 |
|------|------|
| `~/.config/git/config.local` | Git の個人設定 |
| `~/.config/jj/conf.d/user.toml` | Jujutsu の user 設定 (名前、email) |
| `domains/dev/home/.zshenv` | shell 環境変数 |

## Directory 構成

```text
dotfiles/
├── core/          # installer, config manager, utilities
├── domains/       # domain 別の設定
│   ├── creative/  # media tools, wallpaper
│   ├── dev/       # Neovim, terminal, shell, languages
│   ├── infra/     # network, security
│   ├── system/    # fonts, colors, themes
│   └── workspace/ # window manager, status bar
└── specs/         # architecture docs
```
