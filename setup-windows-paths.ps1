# Windows環境用設定ファイル配置スクリプト
# このスクリプトはWindows環境でWSLのdotfilesリポジトリから設定ファイルをWindows側に適切に配置します
# 管理者権限で実行することを推奨します
#
# 実行方法:
# 1. Windows PowerShellから直接実行（推奨）: .\setup-windows-paths.ps1
# 2. WSL内からWindows PowerShellを呼び出し: powershell.exe -ExecutionPolicy Bypass -File "$PWD/setup-windows-paths.ps1"
# 3. WSL内のPowerShell Core (pwsh)から実行: pwsh -File ./setup-windows-paths.ps1

# 実行環境がWSLかどうかを判定
$isRunningInWSL = $false
try {
    # WSL環境では$env:WSL_DISTROが定義されているか、/proc/versionに特定の文字列が含まれる
    if ($env:WSL_DISTRO -or (Test-Path "/proc/version")) {
        if (Test-Path "/proc/version") {
            $procVersion = Get-Content "/proc/version" -ErrorAction SilentlyContinue
            if ($procVersion -match "Microsoft|WSL") {
                $isRunningInWSL = $true
                Write-Host "WSL環境で実行されていることを検出しました" -ForegroundColor Cyan
            }
        } else {
            $isRunningInWSL = $true
            Write-Host "WSL環境変数を検出しました" -ForegroundColor Cyan
        }
    }
} catch {
    # エラーが発生した場合はWSLではないと判断
    $isRunningInWSL = $false
}

# 自身のスクリプトパスを取得してdotfilesディレクトリを特定
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$dotfilesDir = $scriptPath

# WSL環境から実行されている場合のパス変換を行う
if ($isRunningInWSL) {
    try {
        # WindowsユーザープロファイルへのパスをWSLパスから特定
        $winUserProfile = [System.Environment]::GetFolderPath('UserProfile')
        
        if (-not $winUserProfile) {
            # バックアッププラン: WSLからWindows側のユーザープロファイルを特定する
            $winUserProfile = "$env:USERPROFILE"
            if (-not $winUserProfile) {
                # さらにバックアップ: 典型的なWindows側のパスを推測
                if ($env:USERNAME) {
                    $winUserProfile = "C:\Users\$env:USERNAME"
                } else {
                    Write-Host "警告: Windows側のユーザープロファイルパスを特定できませんでした。" -ForegroundColor Yellow
                    Write-Host "C:\Users\[ユーザー名] を使用します。必要に応じて手動で設定を配置してください。" -ForegroundColor Yellow
                    $winUserProfile = "C:\Users\$env:USER"
                }
            }
        }
        
        # スクリプトの実行がWSLからの場合の追加情報を表示
        Write-Host "WSL環境から実行されています。Windows側のユーザープロファイルパス: $winUserProfile" -ForegroundColor Cyan
    } catch {
        Write-Host "WSLパス変換中にエラーが発生しました: $_" -ForegroundColor Red
    }
}

# バックアップ用関数
function Backup-Config {
    param (
        [string]$Path
    )
    
    if (Test-Path $Path) {
        $backupDir = Join-Path $env:USERPROFILE ".dotfiles_backup\$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        if (-not (Test-Path $backupDir)) {
            New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
        }
        
        $fileName = Split-Path -Leaf $Path
        $backupPath = Join-Path $backupDir $fileName
        
        Write-Host "バックアップ作成中: $Path -> $backupPath"
        Copy-Item -Path $Path -Destination $backupPath -Force -Recurse
    }
}

# ディレクトリがなければ作成する関数
function Ensure-Directory {
    param (
        [string]$Path
    )
    
    if (-not (Test-Path $Path)) {
        Write-Host "ディレクトリを作成: $Path"
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

# 設定選択メニューを表示
function Show-Menu {
    Write-Host "`n==== Windows環境設定セットアップ ====" -ForegroundColor Cyan
    Write-Host "このスクリプトは、WSLのdotfilesからWindows側の設定ファイルを配置します" -ForegroundColor Yellow
    Write-Host "インストールする設定を選択してください:" -ForegroundColor Yellow
    Write-Host "1. すべての設定をインストール"
    Write-Host "2. WezTerm設定のみインストール"
    Write-Host "3. VSCode設定のみインストール"
    Write-Host "4. Cursor設定のみインストール"
    Write-Host "5. Starship設定のみインストール"
    Write-Host "0. 終了"
    
    $choice = Read-Host "選択してください (0-5)"
    return $choice
}

# WezTerm設定をコピー
function Install-WezTermConfig {
    Write-Host "`n==== WezTerm設定のインストール ====" -ForegroundColor Green
    
    # 設定ファイルのパス
    $weztermConfigDir = Join-Path $env:USERPROFILE ".config\wezterm"
    Ensure-Directory $weztermConfigDir
    
    # バックアップを作成
    Backup-Config $weztermConfigDir
    
    # dotfilesからWezTerm設定をコピー
    $sourceWeztermDir = Join-Path $dotfilesDir "config\wezterm"
    
    # メインの設定ファイルをコピー
    Write-Host "WezTerm設定ファイルをコピー中..."
    Copy-Item -Path (Join-Path $sourceWeztermDir "wezterm.lua") -Destination $weztermConfigDir -Force
    
    # サブディレクトリをコピー
    $subDirs = @("lua", "lua\core", "lua\ui", "lua\utils")
    foreach ($subDir in $subDirs) {
        $targetDir = Join-Path $weztermConfigDir $subDir
        Ensure-Directory $targetDir
        
        # サブディレクトリ内のLuaファイルをコピー
        $sourceDir = Join-Path $sourceWeztermDir $subDir
        if (Test-Path $sourceDir) {
            Get-ChildItem -Path $sourceDir -Filter "*.lua" | ForEach-Object {
                $targetFile = Join-Path $targetDir $_.Name
                Write-Host "コピー中: $($_.FullName) -> $targetFile"
                Copy-Item -Path $_.FullName -Destination $targetFile -Force
            }
        }
    }
    
    Write-Host "WezTerm設定のインストールが完了しました" -ForegroundColor Green
}

# VSCode設定をコピー
function Install-VSCodeConfig {
    Write-Host "`n==== VSCode設定のインストール ====" -ForegroundColor Green
    
    # VSCodeの設定ディレクトリ（複数の可能性をチェック）
    $possiblePaths = @(
        (Join-Path $env:APPDATA "Code\User"),
        (Join-Path $env:LOCALAPPDATA "Code\User"),
        (Join-Path $env:USERPROFILE ".vscode")
    )
    
    $installed = $false
    
    foreach ($vscodePath in $possiblePaths) {
        if (Test-Path (Split-Path -Parent $vscodePath)) {
            Ensure-Directory $vscodePath
            
            # 設定ファイルのパス
            $settingsPath = Join-Path $vscodePath "settings.json"
            
            # バックアップを作成
            Backup-Config $settingsPath
            
            # 設定ファイルをコピー
            $sourceSettingsPath = Join-Path $dotfilesDir "config\vscode\settings.json"
            Write-Host "VSCode設定ファイルをコピー中: $sourceSettingsPath -> $settingsPath"
            Copy-Item -Path $sourceSettingsPath -Destination $settingsPath -Force
            
            $installed = $true
            Write-Host "VSCode設定ファイルを $vscodePath にインストールしました" -ForegroundColor Green
        }
    }
    
    if (-not $installed) {
        Write-Host "VSCodeの設定ディレクトリが見つかりませんでした。VSCodeがインストールされているか確認してください。" -ForegroundColor Yellow
    }
}

# Cursor設定をコピー
function Install-CursorConfig {
    Write-Host "`n==== Cursor設定のインストール ====" -ForegroundColor Green
    
    # Cursorの設定ディレクトリ（複数の可能性をチェック）
    $possiblePaths = @(
        (Join-Path $env:USERPROFILE ".cursor\User"),
        (Join-Path $env:APPDATA "Cursor\User"),
        (Join-Path $env:LOCALAPPDATA "Cursor\User")
    )
    
    $installed = $false
    
    foreach ($cursorPath in $possiblePaths) {
        if (Test-Path (Split-Path -Parent (Split-Path -Parent $cursorPath))) {
            Ensure-Directory $cursorPath
            
            # 設定ファイルのパス
            $settingsPath = Join-Path $cursorPath "settings.json"
            $mcpPath = Join-Path $cursorPath "mcp.json"
            
            # バックアップを作成
            Backup-Config $settingsPath
            Backup-Config $mcpPath
            
            # 設定ファイルをコピー
            $sourceSettingsPath = Join-Path $dotfilesDir "config\vscode\settings.json"
            $sourceMcpPath = Join-Path $dotfilesDir "config\cursor\mcp.json"
            
            Write-Host "Cursor設定ファイルをコピー中: $sourceSettingsPath -> $settingsPath"
            Copy-Item -Path $sourceSettingsPath -Destination $settingsPath -Force
            
            Write-Host "Cursor MCP設定ファイルをコピー中: $sourceMcpPath -> $mcpPath"
            Copy-Item -Path $sourceMcpPath -Destination $mcpPath -Force
            
            $installed = $true
            Write-Host "Cursor設定ファイルを $cursorPath にインストールしました" -ForegroundColor Green
        }
    }
    
    if (-not $installed) {
        Write-Host "Cursorの設定ディレクトリが見つかりませんでした。Cursorがインストールされているか確認してください。" -ForegroundColor Yellow
    }
}

# Starship設定をコピー
function Install-StarshipConfig {
    Write-Host "`n==== Starship設定のインストール ====" -ForegroundColor Green
    
    # Starshipの設定ディレクトリ
    $starshipConfigDir = Join-Path $env:USERPROFILE ".config"
    Ensure-Directory $starshipConfigDir
    
    # 設定ファイルのパス
    $starshipConfigPath = Join-Path $starshipConfigDir "starship.toml"
    
    # バックアップを作成
    Backup-Config $starshipConfigPath
    
    # 設定ファイルをコピー
    $sourceStarshipPath = Join-Path $dotfilesDir "config\starship\starship.toml"
    Write-Host "Starship設定ファイルをコピー中: $sourceStarshipPath -> $starshipConfigPath"
    Copy-Item -Path $sourceStarshipPath -Destination $starshipConfigPath -Force
    
    Write-Host "Starship設定ファイルをインストールしました" -ForegroundColor Green
}

# メイン処理
function Main {
    Write-Host "Windows用dotfiles設定スクリプトを開始します..." -ForegroundColor Cyan
    
    $choice = Show-Menu
    
    switch ($choice) {
        "0" {
            Write-Host "スクリプトを終了します" -ForegroundColor Yellow
            return
        }
        "1" {
            Install-WezTermConfig
            Install-VSCodeConfig
            Install-CursorConfig
            Install-StarshipConfig
            
            Write-Host "`n==== 全ての設定のインストールが完了しました ====" -ForegroundColor Green
        }
        "2" {
            Install-WezTermConfig
        }
        "3" {
            Install-VSCodeConfig
        }
        "4" {
            Install-CursorConfig
        }
        "5" {
            Install-StarshipConfig
        }
        default {
            Write-Host "無効な選択です。スクリプトを終了します。" -ForegroundColor Red
            return
        }
    }
    
    Write-Host "`n設定ファイルのインストールが完了しました" -ForegroundColor Cyan
    Write-Host "バックアップは $env:USERPROFILE\.dotfiles_backup に保存されています" -ForegroundColor Cyan
}

# スクリプトを実行
Main