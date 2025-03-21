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

### Linux/WSL環境の追加セットアップ

Linux/WSL環境では、Homebrewでインストールされるパッケージに加えて、ネイティブのLinuxパッケージを`apt`でインストールすることができます。この追加セットアップを行うには：

```bash
# install.sh実行後に実行してください
./packages/linux_apps.sh
```

このスクリプトは以下の機能を提供します：
- 基本的なビルドツールと開発ライブラリのインストール
- シェルツール（zsh, fish, tmux）のインストール
- Dockerの適切な設定（オプション）
- WSL用のロケール設定
- 開発用フォントのインストール（通常のLinux環境のみ）

## Windows環境でインストールすべきアプリケーション

WSL環境では、GUIアプリケーションは通常Windows側にインストールして使用します。以下のアプリケーションはBrewfileに含まれているものから、Windows環境で手動インストールが推奨されるものです：

### 開発ツール
- [Visual Studio Code](https://code.visualstudio.com/download) または [Cursor](https://cursor.sh/)
- [WezTerm](https://wezfurlong.org/wezterm/install/windows.html)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Postman](https://www.postman.com/downloads/)
- [Android Studio](https://developer.android.com/studio)
- [DevToys](https://devtoys.app/)
- [Unity Hub](https://unity.com/download)
- [Epic Games Launcher](https://store.epicgames.com/en-US/download) (Unreal Engine用)

### AI/MLツール
- [Ollama](https://ollama.ai/download)

### ブラウザ
- [Google Chrome](https://www.google.com/chrome/)
- [Firefox](https://www.mozilla.org/firefox/new/)
- [Brave Browser](https://brave.com/download/)

### コミュニケーション＆生産性
- [Slack](https://slack.com/downloads/windows)
- [Discord](https://discord.com/download)
- [Notion](https://www.notion.so/desktop)
- [Obsidian](https://obsidian.md/download)
- [PowerToys](https://learn.microsoft.com/ja-jp/windows/powertoys/install) (Raycastの代替)
- [1Password](https://1password.com/downloads/)
- [FancyWM](https://apps.microsoft.com/detail/9p1741lkhbf4) (Magnetの代替)
- [OneDrive](https://www.microsoft.com/microsoft-365/onedrive/download)
- [LINE](https://line.me/ja/download)
- [Nebo](https://www.nebo.app/download)

### デザインツール
- [Figma](https://www.figma.com/downloads/)
- [Blender](https://www.blender.org/download/)
- [DaVinci Resolve](https://www.blackmagicdesign.com/products/davinciresolve/)

### メディア
- [VLC](https://www.videolan.org/vlc/download-windows.html)
- [OBS Studio](https://obsproject.com/download)
- [Spotify](https://www.spotify.com/download/windows/)

### システムツール
- [Windows Terminal](https://aka.ms/terminal)
- [Cloudflare WARP](https://1.1.1.1/download)

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
## WSL固有の設定

WSLで「warning: setlocale: LC_ALL: cannot change locale (en_US.UTF-8)」というエラーが表示される場合、以下のスクリプトを実行して修正できます：

```bash
# WSLコンソール内で実行
./wsl-locale-fix.sh
```

適用後はWSLセッションを再起動してください（ターミナルを閉じて再度開くか、PowerShellから`wsl --shutdown`を実行）。

## 開発ツールとバージョン管理

このリポジトリでは様々なプログラミング言語やツールのバージョン管理に [mise](https://github.com/jdx/mise) を使用しています。

インストールスクリプト実行時に`config/mise/config.toml`で設定された言語やツールが自動的にインストールされます。