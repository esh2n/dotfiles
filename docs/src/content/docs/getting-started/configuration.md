---
title: 構成
description: 設定ファイルの置き場所、template、環境変数、個人設定。
---

## 設定ファイルの置き場所

各アプリの設定は、そのアプリのモジュールの隣にあります（`home/<os>/<app>/config/`）。`~/.config/<app>` などはそこへのリンクなので、編集はそのまま次の起動から効きます。構成の作り直しは要りません。

## Template

VS Code の `settings.json`、mise の `config.toml`、`~/.gitconfig` のように環境変数を読めない設定は `*.template` で管理します。切り替えのたびに `dotctl templates render` が隣に展開し、`{{HOME}}`、`{{USER}}`、`{{DOTFILES_ROOT}}` を埋めます。展開したファイルは git に含めません。

## 環境変数

WezTerm の天気 widget には OpenWeather の API key が要ります。checkout の root に `.env` を作ります。

```bash
OPENWEATHER_API_KEY=your-api-key
```

読む順番: 環境変数 `OPENWEATHER_API_KEY` → `$DOTFILES_ROOT/.env` → `~/dotfiles/.env` → 設定ディレクトリからの相対パス。`DOTFILES_ROOT` は zsh が `~/.zshrc` のリンク先から決めます。

## 個人設定

| File | 用途 |
|------|------|
| `~/.config/git/config.local` | Git の名前と email（`.env` の `GIT_USER_NAME` / `GIT_USER_EMAIL` から `make up` が書く） |
| `home/shared/git/config/conditional/*.conf` | ディレクトリごとの Git 設定（機械ごと、追跡しない） |
| `~/.config/jj/conf.d/user.toml` | Jujutsu の user 設定 |
| `~/.zshrc.local` | この機械だけの zsh 設定 |

## Directory 構成

```text
dotfiles/
├── flake.nix, flake.lock    # flake: darwinConfigurations.mac、homeConfigurations.linux、packages
├── bootstrap.sh             # make up: Nix が無ければ入れて dotctl up に渡す
├── lib/                     # facts（唯一の不純な読み取り）、組み立て、常駐サービス、setup の手順
├── roles/                   # 役割ごとに何を有効にするか
├── system/darwin/           # nix-darwin (defaults、Homebrew、browser)
├── home/                    # home-manager。一アプリ一ディレクトリ、設定はモジュールの隣
│   ├── shared/              #   両 OS
│   ├── darwin/              #   macOS だけ
│   └── linux/               #   Omarchy だけ
├── pkgs/                    # ここでビルドするもの (dotctl など)
├── overlays/                # 上流の package の版固定・調整
├── harness/                 # coding agent のハーネス (jig、rules、skills、agents、policy、tools)
├── tests/                   # bats
└── docs/                    # この site
```
