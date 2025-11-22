# Template System
# テンプレートシステム

## Overview / 概要
Some configuration files (like VSCode's `settings.json` and Mise's `config.toml`) cannot use environment variables or dynamic path resolution. For these files, we use a template system.

一部の設定ファイル（VSCodeの `settings.json` やMiseの `config.toml` など）は、環境変数や動的パス解決を使用できません。これらのファイルにはテンプレートシステムを使用します。

## Template Files / テンプレートファイル
- `domains/editor/config/vscode/settings.json.template`
- `domains/development/config/mise/config.toml.template`

These files use `{{HOME}}` as a placeholder for the user's home directory.

これらのファイルは、ユーザーのホームディレクトリのプレースホルダーとして `{{HOME}}` を使用します。

## Usage / 使用方法

### Generate Config Files / 設定ファイル生成
```bash
./core/config/manager.sh template
```

This will:
1. Find all `*.template` files in `domains/`
2. Replace `{{HOME}}` with your actual home directory
3. Generate the corresponding config files (e.g., `settings.json` from `settings.json.template`)

これにより：
1. `domains/` 内のすべての `*.template` ファイルを検索
2. `{{HOME}}` を実際のホームディレクトリに置換
3. 対応する設定ファイルを生成（例: `settings.json.template` から `settings.json`）

### Generated Files are Ignored / 生成ファイルは無視される
Generated files are listed in `.gitignore` and will NOT be committed to the repository. Only the `.template` files are tracked.

生成されたファイルは `.gitignore` にリストされており、リポジトリにコミットされません。`.template` ファイルのみが追跡されます。

## Environment Variables / 環境変数

### DOTFILES_ROOT
For WezTerm and other Lua-based configs, set the `DOTFILES_ROOT` environment variable:

```bash
export DOTFILES_ROOT="$HOME/go/github.com/esh2n/dotfiles/dotfiles"
```

Add this to your `.zshrc` or shell config.
