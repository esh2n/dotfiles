# dotfiles

これは@esh2nのdotfilesリポジトリです。macOS、Linux、およびWindows（WSL）環境向けの設定ファイルが含まれています。

## インストール方法

### macOS / Linux

```bash
# リポジトリをクローン
git clone https://github.com/esh2n/dotfiles.git
cd dotfiles

# インストールスクリプトを実行
./install.sh
```

### Windows (WSL)

WSL環境では、2つのステップでインストールする必要があります：

1. WSL内でLinux用の設定をインストール：

```bash
# リポジトリをクローン
git clone https://github.com/esh2n/dotfiles.git
cd dotfiles

# WSL内の設定をインストール
./install.sh
```

2. Windows側の設定をインストール：

**方法A: Windows PowerShellから直接実行（推奨）:**

```powershell
# 管理者権限でPowerShellを開き、以下を実行
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# dotfilesディレクトリに移動して以下を実行
.\setup-windows-paths.ps1
```

**方法B: WSL内からWindows PowerShellを呼び出す:**

```bash
# WSL内から実行
powershell.exe -ExecutionPolicy Bypass -File "$PWD/setup-windows-paths.ps1"
```

**方法C: WSL内でPowerShell Coreを使用（事前にインストールが必要）:**

```bash
# PowerShell Coreのインストール（初回のみ）
sudo apt-get update
sudo apt-get install -y wget apt-transport-https software-properties-common
wget -q "https://packages.microsoft.com/config/ubuntu/$(lsb_release -rs)/packages-microsoft-prod.deb"
sudo dpkg -i packages-microsoft-prod.deb
sudo apt-get update
sudo apt-get install -y powershell

# スクリプト実行
pwsh -File ./setup-windows-paths.ps1
```

もしくは、Windowsネイティブ環境のセットアップを行う場合：

```powershell
# 管理者権限でPowerShellを開き、以下を実行
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# dotfilesディレクトリに移動して以下を実行
.\install-windows.ps1
```

## 含まれる設定

- Zsh設定（`.zshrc`, `.zshenv`など）
- Fish Shell設定
- Neovim設定
- WezTerm設定
- Git設定
- Starship（クロスプラットフォームのプロンプト）
- VSCode/Cursor設定と拡張機能
- tmux設定
- その他各種ツール設定

## 環境別セットアップの詳細

### Windows用スクリプト説明

#### 1. `setup-windows-paths.ps1`

このスクリプトはWindows環境用の設定ファイルのパスを設定します。

**用途**: WSL環境とWindows環境の間で設定ファイルを同期します。

**実行方法**:

- **Windows PowerShellから直接実行（推奨）**:
   ```powershell
   .\setup-windows-paths.ps1
   ```

- **WSLから実行**:
   ```bash
   powershell.exe -ExecutionPolicy Bypass -File "$PWD/setup-windows-paths.ps1"
   ```

#### 2. `install-vscode-extensions.ps1`

このスクリプトはVS CodeとCursorの拡張機能をインストールします。

**パラメータ**:
- `-VSCodeOnly`: VS Code拡張機能のみをインストール
- `-CursorOnly`: Cursor拡張機能のみをインストール
- パラメータなし: 両方の拡張機能をインストール

**実行方法**:

- **Windows PowerShellから直接実行（推奨）**:
   ```powershell
   # 両方の拡張機能をインストール
   .\install-vscode-extensions.ps1
   
   # VS Code拡張機能のみをインストール
   .\install-vscode-extensions.ps1 -VSCodeOnly
   
   # Cursor拡張機能のみをインストール
   .\install-vscode-extensions.ps1 -CursorOnly
   ```

- **WSLから実行**:
   ```bash
   # 両方の拡張機能をインストール
   powershell.exe -ExecutionPolicy Bypass -File "$PWD/install-vscode-extensions.ps1"
   
   # VS Code拡張機能のみをインストール
   powershell.exe -ExecutionPolicy Bypass -File "$PWD/install-vscode-extensions.ps1" -VSCodeOnly
   
   # Cursor拡張機能のみをインストール
   powershell.exe -ExecutionPolicy Bypass -File "$PWD/install-vscode-extensions.ps1" -CursorOnly
   ```
**注意**: WSLからPowerShellスクリプトを実行する場合、以下の問題が発生することがあります：

1. **文字エンコーディングの問題**: 日本語などの非ASCII文字を含むスクリプトが正しく解釈されない場合があります。

2. **署名検証エラー**: VS Code拡張機能のインストール時に「Signature verification was not executed.」エラーが発生する場合があります。これはWSLからWindowsアプリケーションを制御する際のセキュリティ制限によるものです。

**解決策**:
- PowerShellスクリプトは直接Windows環境から実行することを強く推奨します
- VS Code/Cursor拡張機能は、各アプリケーションの拡張機能マーケットプレイスから手動でインストールすることもできます
**注意**: WSLからPowerShellスクリプトを実行する場合、文字エンコーディングの問題が発生することがあります。エラーが発生した場合は、スクリプトを直接Windowsから実行することをお勧めします。

### WSL + Windows環境での設定ファイルパスの違い

Windows環境でWSLを使用する場合、以下の設定ファイルのパスが異なります：

1. **WezTerm**:
   - Windows: `%USERPROFILE%\.config\wezterm\wezterm.lua`
   - WSL: `$HOME/.config/wezterm/wezterm.lua`

2. **VSCode**:
   - Windows: `%APPDATA%\Code\User\settings.json`
   - WSL: `$HOME/.config/Code/User/settings.json`

3. **Cursor**:
   - Windows: `%USERPROFILE%\.cursor\User\settings.json`
   - WSL: `$HOME/.config/Cursor/User/settings.json`

4. **Starship**:
   - Windows: `%USERPROFILE%\.config\starship.toml`
   - WSL: `$HOME/.config/starship.toml`

WSL環境とWindows環境の両方で設定を同期するには、`setup-windows-paths.ps1`スクリプトを使用してください。

### トラブルシューティング

#### WSL環境でWindowsとの設定同期に問題がある場合

1. **管理者権限で実行**
   - `setup-windows-paths.ps1`をWindows側から管理者権限で実行してください
   - コマンド: `powershell -Command "Start-Process PowerShell -Verb RunAs -ArgumentList '-File setup-windows-paths.ps1'"`

2. **WSLからPowerShellスクリプトを実行する際の問題**
   - **エラー: `powershell.exe: command not found`**
      - 解決策: Windowsの`PATH`環境変数にPowerShellのディレクトリが含まれていることを確認
      - 例: `export PATH=$PATH:/mnt/c/Windows/System32/WindowsPowerShell/v1.0/`を`.bashrc`に追加

   - **実行ポリシーの問題**
      - 解決策: `-ExecutionPolicy Bypass`パラメータを使用
      - 例: `powershell.exe -ExecutionPolicy Bypass -File ./setup-windows-paths.ps1`

   - **パス変換の問題**
      - WSLパスとWindowsパスの変換に失敗する場合は、直接Windows PowerShellから実行してください

   - **文字エンコーディングの問題**
      - WSLからPowerShellスクリプトを実行する際に文字化けや構文エラーが発生する場合：
      - 解決策1: Windows PowerShellから直接実行する（最も確実な方法）
      - 解決策2: `-InputFormat utf8 -OutputFormat utf8`パラメータを追加
      - 例: `powershell.exe -ExecutionPolicy Bypass -InputFormat utf8 -OutputFormat utf8 -File "$PWD/setup-windows-paths.ps1"`

3. **個別機能のインストール**
   - 必要な設定のみを選択してインストールできます
   - スクリプトのメニューから希望のオプションを選択してください

4. **バックアップと復元**
   - 設定ファイルのインストール前に自動的にバックアップが作成されます
   - バックアップパス: `%USERPROFILE%\.dotfiles_backup\[日時]`
   - 問題が発生した場合は、このディレクトリから元の設定を復元できます

5. **手動での設定配置**
   - 各種設定ファイルの手動配置場所については、上記の「WSL + Windows環境での注意点」セクションを参照してください
   - スクリプトが失敗する場合は手動でファイルをコピーすることも可能です