# dotfiles

クロスプラットフォームで動作する開発環境設定ファイル管理リポジトリです。macOS、Linux、Windows(WSL)をサポートしています。

## サポート環境

- **macOS**: macOS固有の機能（sketchybar、bordersなど）を含む完全サポート
- **Linux**: 主要な開発ツールとシェル設定をサポート
- **Windows (WSL)**: Windows Terminal、VSCode、Windows側のセットアップと、WSL内部での開発環境構築をサポート

## インストール方法

### macOS / Linux

ネイティブのmacOSまたはLinux環境では、シンプルにインストールスクリプトを実行します：

```bash
./install.sh
```

このスクリプトは自動的にOSを検出し、適切なセットアップを実行します。

### Windows (WSL)

#### 方法1: WSL内からのセットアップ (推奨)

既にWSLがインストールされている場合は、WSLセッション内から`install.sh`を実行します：

```bash
# WSLコンソール内で実行
./install.sh
```

#### 方法2: Windowsホストからのセットアップ (WSLがまだ無い場合)

WSLをまだインストールしていない場合は、Windowsの管理者PowerShellから以下を実行します：

```powershell
# Windows PowerShellから実行（管理者権限が必要）
.\install-windows.ps1
```

**注意**: `install-windows.ps1`はWSL内部から実行しないでください。このスクリプトはWindowsネイティブのPowerShell環境用です。

## 構成内容

- Shell設定 (Zsh, Fish)
- エディタ設定 (Neovim, VS Code, Helix)
- ターミナル設定 (WezTerm, tmux)
- Git設定
- 各種開発ツール

## ファイル構造

- `install.sh` - メインインストールスクリプト（macOS, Linux, WSL用）
- `install-windows.ps1` - Windowsホスト用セットアップスクリプト（WSLを設定）
- `config/` - 各種アプリケーション設定
- `shell/` - シェル関連設定
- `packages/` - パッケージ管理リスト
- `git/` - Git設定

## カスタマイズ

個人用の調整が必要な場合は、各設定ファイルを直接編集するか、該当するディレクトリに新しいファイルを追加してください。