---
title: Install
description: dotfiles の install 手順と package 管理。
---

## Setup

```bash
cd dotfiles
./core/install/installer.sh
```

| Option | 説明 |
|--------|------|
| `--force` | 古い symlink を削除してから link |
| `-h, --help` | help を表示 |

```bash
# 通常の install
./core/install/installer.sh

# Clean install (古い symlink を削除してから link)
./core/install/installer.sh --force
```

installer は以下を順に実行する。

1. Homebrew と Nix を install (未導入の場合)
2. nix-darwin の設定を適用 (package はすべて Nix 経由)
3. mise で言語 runtime を setup
4. 古い symlink を検出
5. 設定ファイルの symlink を作成
6. 既存ファイルを backup (直近 7 世代を保持)

## Package 管理 (Nix)

全 package は Nix flake で管理。install 先の優先順位は以下のとおり。

1. **nixpkgs** — main の package source
2. **overlays** — nixpkgs にない package を独自定義
3. **brew-nix** — brew-nix で動く GUI アプリ
4. **nix-darwin homebrew** — GUI アプリの fallback / Homebrew 限定の CLI
5. **cargo install** — 他で手に入らない Rust tool

| File | 役割 |
|------|------|
| `core/nix/flake.nix` | Nix flake の entry point |
| `core/nix/darwin.nix` | macOS の system 設定 |
| `core/nix/overlays.nix` | custom package 定義 |
| `domains/*/packages/home.nix` | domain ごとの user package |
| `domains/*/packages/homebrew.nix` | domain ごとの Homebrew fallback |

## Package の更新

設定を変更したら以下の command で反映する。

```bash
# package 変更後の quick update
./core/nix/update.sh

# Full rebuild (時間はかかるが確実)
./core/nix/update.sh --rebuild

# npm package 追加後の更新
./core/nix/update.sh --node2nix
```

### npm package の追加 (node2nix)

1. `domains/dev/packages/node2nix/package.json` を編集
2. `./core/nix/update.sh --node2nix` を実行

```json title="package.json"
{
  "dependencies": {
    "@anthropic-ai/claude-code": "*",
    "aicommits": "^1.0.0"
  }
}
```

## Backup

既存の設定ファイルは自動で backup される。

- 形式: `{filename}.backup.{timestamp}`
- 例: `.zshrc.backup.20250123_012345`
