# Cross-Platform Dotfiles

このdotfilesリポジトリは、macOS、Linux、Windows、WSLの全ての環境で一貫した開発環境を提供します。

## セットアップ手順

### 重要：各環境で正しいインストールスクリプトを使用してください

#### macOS / Linux / WSL環境

```bash
# WSLやLinuxなどのUNIX系環境では、このbashスクリプトを使用します
./install.sh
```

#### Windows環境 (PowerShell)

```powershell
# 管理者権限のPowerShellで実行します
# WSL2のインストールとセットアップを含みます
.\install-windows.ps1
```

## 各環境での注意事項

### WSL環境

- **重要**: WSLでは必ず**通常ユーザー**として`install.sh`を実行してください。rootユーザーでは実行しないでください
  ```bash
  # 良い例: 通常ユーザーとして実行
  ./install.sh
  
  # 悪い例: rootとして実行しない
  sudo ./install.sh  # これはHomebrewのインストールを失敗させます
  ```

- **新規WSLユーザーの作成方法**:
  ```bash
  # WSLでrootしかユーザーがない場合は、新しいユーザーを作成してください
  sudo adduser your_username
  # 新しいユーザーをsudoグループに追加
  sudo usermod -aG sudo your_username
  # 新しいユーザーに切り替え
  su - your_username
  # このユーザーでインストールスクリプトを実行
  ```

- **Homebrewのパス設定**: インストール後に次のコマンドを実行してHomebrewをPATHに追加してください:
  ```bash
  # Homebrewのパスを追加
  eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
  
  # 一時的なパス設定だけでなく永続的に設定する場合
  echo '# Homebrew' >> ~/.bashrc
  echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> ~/.bashrc
  
  # zshを使用している場合は.zshrcにも追加
  echo '# Homebrew' >> ~/.zshrc
  echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> ~/.zshrc
  ```

- **WSL内での設定**: WSL環境では必ず `install.sh` を使用してください（PowerShellスクリプトは使用しないでください）
- **初回セットアップ**: Windows側で先に `install-windows.ps1` を実行して、WSL2とUbuntuをセットアップしてから、WSL内で `install.sh` を実行することをお勧めします
- **Linuxアプリケーション**: WSLでより良い環境を構築するには、追加のLinuxネイティブパッケージをインストールしてください:
  ```bash
  ./packages/linux_apps.sh
  ```

### Windows環境

- **管理者権限**: `install-windows.ps1` は管理者権限のPowerShellで実行する必要があります
- **WSL2とUbuntu**: このスクリプトはWSL2とUbuntuの両方をインストールします
- **再起動**: WSL2のインストール後にシステムの再起動が必要な場合があります
- **Windows Terminal**: 開発に最適化されたWindows Terminal設定が自動的に適用されます
- **開発ツール**: Git、Windows Terminal、VSCodeなどの主要な開発ツールが自動的にインストールされます

### macOS環境

- **Homebrew**: macOS環境では、Homebrewが自動的にインストールされます
- **sketchybar**: macOS専用のツールが自動的に設定されます
- **mise**: 複数の言語とバージョンを管理するツールがセットアップされます

### Linux環境

- **Homebrew**: Linuxでも必要に応じてHomebrewがインストールされます
- **ネイティブパッケージ**: `packages/linux_apps.sh` を使用して、apt経由で最適化されたLinuxネイティブパッケージをインストールできます
- **Docker**: 必要に応じてDockerをセットアップするオプションが提供されます

## インストールされる主要コンポーネント

- **シェル設定**: Zsh、Fish
- **エディタ**: Neovim、Helix、VSCode/Cursor設定
- **ターミナル**: Tmux、WezTerm
- **開発ツール**: Git、Ruby、Python、Node.js、Go、Rust、その他の言語ツール

## カスタマイズ

- **OSごとの設定**: 各OSに最適化された設定が自動的に適用されます
- **パッケージ管理**: OS別のBrewfileが使用されます
  - macOS: `packages/Brewfile`
  - Linux/WSL: `packages/Brewfile.linux`

## ファイル構成

```
dotfiles/
├── install.sh                # macOS/Linux/WSL用メインインストーラ
├── install-windows.ps1       # Windows用インストーラ（WSL2セットアップ含む）
├── packages/
│   ├── Brewfile              # macOS用Brewfile
│   ├── Brewfile.linux        # Linux/WSL用Brewfile
│   ├── linux_apps.sh         # Linux/WSL用追加パッケージインストーラ
│   ├── cargo.txt             # Rustパッケージリスト
│   ├── go.txt                # Goパッケージリスト
│   ├── npm.txt               # NPMパッケージリスト
│   └── gem.txt               # Rubyパッケージリスト
├── config/                   # 各種設定ファイル
├── shell/                    # シェル設定
└── git/                      # Git設定
```

## トラブルシューティング

### WSLでrootユーザーでスクリプトを実行してエラーが出る場合

```
Error: Homebrew should not be installed as root. Please run this script as a regular user.
If you're in WSL, make sure to start WSL with a non-root user or create a new user first.
```

Homebrewはrootユーザーとしてインストールできません。通常ユーザーで実行してください。WSLで通常ユーザーを作成するには上記の「新規WSLユーザーの作成方法」を参照してください。

### VSCode/Cursorコマンドラインツールが見つからないエラー

```
VSCode command line tool not found. Skipping VSCode extensions installation.
Cursor command line tool not found. Skipping Cursor extensions installation.
```

VSCode/Cursorのコマンドラインツールがインストールされていません。VSCode/Cursorを開き、コマンドパレット（F1または Cmd+Shift+P / Ctrl+Shift+P）を使用して「Shell Command: Install 'code' command in PATH」を実行してください。

### WSLでPowerShellスクリプトを実行しようとしてエラーが出る場合

```
./install-windows.ps1: Syntax error: word unexpected (expecting ")")
```

これはWSL内でPowerShellスクリプトを実行しようとしているためのエラーです。WSL環境では代わりに以下を実行してください：

```bash
./install.sh
```

### Homebrewが正しく初期化されない場合（WSL/Linux）

WSL/Linuxで「brew: command not found」エラーが出る場合は、以下のコマンドを実行してHomebrewをPATHに追加してください：

```bash
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
```

または、以下をあなたのシェルプロファイル（~/.bashrc、~/.zshrc等）に追加してください：

```bash
# Homebrew
if [ -d "/home/linuxbrew/.linuxbrew" ]; then
  eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
fi
```

### WSL2のインストールに問題がある場合

Windows環境でWSL2のインストールに問題がある場合は、以下のMicrosoftの公式ドキュメントを参照してください：

[WSL2のインストールマニュアル](https://learn.microsoft.com/ja-jp/windows/wsl/install-manual)

その後、再度 `install-windows.ps1` を実行してください。