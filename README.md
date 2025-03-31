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

#### WSLとPowerShell間の切り替え

- **PowerShellからWSLに入る方法**:
  ```powershell
  # PowerShellからWSLに入る
  wsl
  ```

- **WSLからPowerShellに戻る方法**:
  ```bash
  # WSLからPowerShellに戻る（WSLを終了）
  exit
  ```
  
  または、WSLを終了せずに新しいPowerShellウィンドウを開く場合:
  ```bash
  # WSL内から新しいPowerShellウィンドウを開く
  powershell.exe
  ```

- **Windows Terminalを使用している場合**:
  - Ctrl+Shift+T または "+" ボタンで新しいタブを開き、ドロップダウンメニューからPowerShellを選択

#### WSL環境からPowerShellスクリプト（.ps1）を実行する方法

WSL環境から直接PowerShellスクリプトを実行することはできませんが、以下の方法でWindows側のPowerShellを呼び出して実行できます：

1. **WSL内から一時的にPowerShellを呼び出して実行する**:
   ```bash
   # WSL内から実行（カレントディレクトリのスクリプトを実行）
   powershell.exe -ExecutionPolicy Bypass -File ./install-windows.ps1
   
   # または絶対パスを指定する場合（例：C:\Users\username\dotfiles\install-windows.ps1）
   powershell.exe -ExecutionPolicy Bypass -File $(wslpath -w ./install-windows.ps1)
   ```
   
   `wslpath -w`は、WSLパスをWindowsパスに変換するコマンドです。

2. **管理者権限が必要な場合**:
   WSL内から管理者権限のPowerShellを直接起動することはできないため、以下の手順を使用します：
   
   a. まず新しいPowerShellウィンドウを開く:
   ```bash
   powershell.exe
   ```
   
   b. 開いたPowerShellウィンドウで、以下を実行して管理者権限で新しいPowerShellウィンドウを起動:
   ```powershell
   Start-Process powershell -Verb RunAs
   ```
   
   c. 管理者権限のウィンドウでスクリプトに移動して実行:
   ```powershell
   cd C:\path\to\dotfiles
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   .\install-windows.ps1
   ```

#### WSLから実行する際のトラブルシューティング

WSL内部から`powershell.exe`を使用して`install-windows.ps1`を実行する際に、いくつかの問題が発生することがあります：

1. **Ubuntu/WSLディストリビューションの検出エラー**:
   ```
   Error: Installing Ubuntu distribution...
   Wsl/InstallDistro/Service/RegisterDistro/ERROR_ALREADY_EXISTS
   ```
   
   **解決策**:
   - このエラーはWSLディストリビューションが既に存在する場合に発生します
   - スクリプトが「Y」と入力するように促した場合、続行してください
   - または、Windows PowerShellから直接実行することをお勧めします

2. **日本語文字化けの問題**:
   WSLからPowerShellスクリプトを実行すると、出力がUTF-8で適切に処理されず文字化けすることがあります。
   
   **解決策**:
   - Windows側のPowerShellから直接実行する
   - または、以下の方法で出力エンコーディングを指定：
     ```bash
     powershell.exe -ExecutionPolicy Bypass -Command "& { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; & $(wslpath -w ./install-windows.ps1) }"
     ```

3. **Go関連のエラー**:
   ```
   go: GOMODCACHE entry is relative; must be absolute path: "${HOME}/go/pkg/mod"
   ```
   
   **解決策**:
   - このエラーは無視しても問題ありません（スクリプトの後半で自動的に修正されます）
   - または、手動で環境変数を修正する場合：
     ```bash
     echo 'export GOMODCACHE="$HOME/go/pkg/mod"' >> ~/.zshrc
     source ~/.zshrc
     ```

**注意**: 最も確実な方法は、WSLを起動せずにWindows側のPowerShellから直接`install-windows.ps1`を実行し、その後WSL内で`install.sh`を実行することです。

#### Windows環境のスクリプト使い分け（重要）

Windows環境では、`.ps1`スクリプトと`.sh`スクリプトを使い分ける必要があります：

- **install-windows.ps1**（PowerShellスクリプト）
  - **目的**: Windowsネイティブ環境（WSL外）用のセットアップ
  - **実行環境**: Windows PowerShell または Windows Terminal内のPowerShell
  - **機能**:
    - WezTerm、VSCode、Cursorなどのツールをインストール
    - Windows固有の設定を構成

- **install.sh**（Bashスクリプト）
  - **目的**: WSL (Windows Subsystem for Linux)内の環境設定
  - **実行環境**: WSL内のLinux環境（Ubuntu等）
  - **機能**:
    - WSL内の設定ファイルをセットアップ
    - WSL経由でWindowsの設定ファイルも配置

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
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\install-windows.ps1
```

**注意**: `install-windows.ps1`はWSL内部から実行しないでください。このスクリプトはWindowsネイティブのPowerShell環境用です。

#### 推奨セットアップ手順（完全版）

Windows環境で最適な結果を得るには、次の順序でセットアップすることをお勧めします：

1. **まずWindows側の設定**
   ```powershell
   # 管理者権限でPowerShellを開いて実行
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   .\install-windows.ps1
   ```
   これにより、WezTerm、VSCode、Cursorなどの必要なアプリケーションがインストールされます。

2. **次にWSL内の設定**
   ```bash
   # WezTermやWindows Terminalなどを使ってWSLを起動し、実行
   cd ~/go/github.com/esh2n/dotfiles
   ./install.sh
   ```
   これにより、WSL内の設定と、Windows側の設定ファイルが適切に配置されます。

#### 設定更新時の使い分け（重要）

- **Windows側のアプリケーションをインストール/更新する場合**:
  ```powershell
  # Windows PowerShellから実行（WSLがあってもなくても）
  .\install-windows.ps1
  ```
  これは、WSLが既にある場合でも、Windows側のアプリケーション（WezTerm、VSCode、Cursorなど）を
  インストールまたは更新したい場合に使用します。

- **WSL内の設定と関連するWindows設定を更新する場合**:
  ```bash
  # WSLコンソール内で実行
  ./install.sh
  ```
  これは、WSL内の環境設定と、WSLからアクセス可能なWindows側の設定ファイルを更新します。

- **設定ファイルだけを更新したい場合**:
  ```bash
  # WSLコンソール内で実行
  ./shell/create_symlinks.sh
  ```
  これは、主に設定ファイルのシンボリックリンクや配置のみを更新します。

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
## Linux/WSL環境のユーティリティ設定

### ロケール問題の修正とユーティリティーのインストール

Linux/WSLで以下のような問題が発生した場合は、ユーティリティーセットアップスクリプトを実行してください：

- ロケールの警告（「warning: setlocale: LC_ALL: cannot change locale (en_US.UTF-8)」）
- `open` コマンドでディレクトリやファイルが開けない問題
- WSL環境ではWindowsとの統合機能の問題

```bash
# Linux/WSLコンソール内で実行（包括的なセットアップ）
./linux-utils-setup.sh
```

このスクリプトはWSLと標準Linuxの両方をサポートしており、環境を自動検出して以下を行います：
1. ロケール設定の修正（en_US.UTF-8）
2. WSL環境のみ：WSL統合ユーティリティー（wslu）のインストール
3. xdg-utilsとdesktop-file-utilsのインストール
4. Linux環境のみ：ファイルブラウザが存在しない場合はインストール
5. デスクトップデータベースの更新
旧式のスクリプトは引き続き利用可能です（WSLのロケールのみ修正）：

```bash
# WSLコンソール内で実行（ロケールのみ修正）
./wsl-locale-fix.sh
```

適用後はシェルセッションを再起動してください（ターミナルを閉じて再度開くか、WSLの場合はPowerShellから`wsl --shutdown`を実行）。

### クロスプラットフォームな `open` コマンド

このdotfilesには、macOS、Linux、WSLで同じように動作する改良された `open` コマンドが含まれています。このコマンドは自動的にプラットフォームを検出し、適切な方法でファイルやディレクトリを開きます：

```bash
# ファイルを開く
open filename.txt

# 現在のディレクトリを開く
open .

# URLを開く
open https://github.com
```

各環境では以下のように動作します：
- **macOS**: ネイティブの `open` コマンドを使用
- **WSL**: Windowsのエクスプローラーまたはデフォルトアプリを使用
- **Linux**: `xdg-open` を使用、ファイルマネージャーにフォールバック

問題が発生した場合は `linux-utils-setup.sh` を実行して必要なユーティリティーをインストールしてください。

#### 拡張セットアップスクリプト

最小限のLinux環境や特殊なWSL設定で問題が発生する場合は、拡張版のセットアップスクリプトを使用できます：

```bash
# より包括的なセットアップ
./linux-utils-setup-enhanced.sh
```

拡張版スクリプトは以下の追加機能を提供します：
- ブラウザが存在しない場合は自動インストール
- ファイルマネージャーが存在しない場合は自動インストール
- MIME関連付けの明示的な設定（ディレクトリとHTML用）
- WSL環境用のバックアップスクリプトの作成
- HTMLファイルがVimで開く問題の修正ガイダンス

#### よくある問題の解決方法

1. **ディレクトリが開けない場合**：
   ```
   No applications found for mimetype: inode/directory
   ```
   拡張セットアップスクリプトを実行すると、ファイルマネージャーをインストールし、適切なMIME関連付けを設定します。

2. **HTMLファイルがVimで開く場合**：
   ```
   Opening "/path/to/file.html" with Vim (text/html)
   ```
   以下を`.zshrc`または`.bashrc`に追加してください：
   ```bash
   export BROWSER=firefox  # または使用しているブラウザ
   ```

#### openコマンドのテスト

`open` コマンドの機能をインタラクティブにテストするには、以下のスクリプトを実行できます：

```bash
# openコマンドの機能をテスト
./test-open-command.sh
```

このテストスクリプトは以下を確認します：
- ディレクトリを開く機能
- HTMLファイルを開く機能
- URLを開く機能
```

## 開発ツールとバージョン管理

このリポジトリでは様々なプログラミング言語やツールのバージョン管理に [mise](https://github.com/jdx/mise) を使用しています。

インストールスクリプト実行時に`config/mise/config.toml`で設定された言語やツールが自動的にインストールされます。