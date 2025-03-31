# VS Code および Cursor 拡張機能インストールスクリプト
# このスクリプトは dotfiles リポジトリ内の拡張機能リストからVS CodeとCursorの拡張機能を一括インストールします

# スクリプトのあるディレクトリを取得
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$extensionsFile = "$scriptDir\config\vscode\extensions.txt"

# 管理者権限チェック（必須ではないが推奨）
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin) {
    Write-Host "注意: 管理者権限なしで実行しています。一部の拡張機能のインストールが失敗する可能性があります。" -ForegroundColor Yellow
}

# コマンドが存在するか確認する関数
function Test-Command {
    param ($command)
    return (Get-Command $command -ErrorAction SilentlyContinue)
}

# 拡張機能をインストールする関数
function Install-Extensions {
    param (
        [string]$CommandName,
        [string]$DisplayName
    )
    
    if (-not (Test-Command $CommandName)) {
        Write-Host "$DisplayName が見つかりません。拡張機能はインストールされません。" -ForegroundColor Red
        return $false
    }
    
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "$DisplayName 拡張機能のインストールを開始します..." -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    # 一時ファイルを作成
    $tempExtFile = "$env:TEMP\${CommandName}_extensions_temp.txt"
    
    # コンテンツを一時ファイルにコピー
    Copy-Item -Path $extensionsFile -Destination $tempExtFile -Force
    
    if (-not (Test-Path $tempExtFile)) {
        Write-Host "一時ファイルの作成に失敗しました: $tempExtFile" -ForegroundColor Red
        return $false
    }
    
    $extensions = Get-Content -Path $tempExtFile
    
    # カレントディレクトリを保存
    $currentDir = Get-Location
    # ユーザーホームディレクトリに移動（UNCパスの問題を回避）
    Set-Location $env:USERPROFILE
    
    $successCount = 0
    $failCount = 0
    $startTime = Get-Date
    
    foreach ($extension in $extensions) {
        if ([string]::IsNullOrWhiteSpace($extension)) { continue }
        
        Write-Host "インストール中: $extension" -NoNewline
        
        try {
            $process = Start-Process -FilePath $CommandName -ArgumentList "--install-extension", "$extension", "--force" -NoNewWindow -Wait -PassThru
            
            if ($process.ExitCode -eq 0) {
                Write-Host " [成功]" -ForegroundColor Green
                $successCount++
            } else {
                Write-Host " [失敗] (終了コード: $($process.ExitCode))" -ForegroundColor Red
                $failCount++
            }
        }
        catch {
            # 例外オブジェクトを一時変数に格納してから参照（WSLパス問題対策）
            $errorMessage = ""
            try {
                $errorMessage = $_.Exception.Message
            } catch {
                $errorMessage = "不明なエラー"
            }
            # エラーメッセージをフォーマット文字列で構築（WSLパス対応）
            $message = " [エラー] {0}" -f $errorMessage
            Write-Host $message -ForegroundColor Red
            $failCount++
        }
    }
    
    # 元のディレクトリに戻る
    Set-Location $currentDir
    
    # 一時ファイルを削除
    Remove-Item -Path $tempExtFile -Force
    
    $endTime = Get-Date
    $duration = $endTime - $startTime
    
    Write-Host "----------------------------------------" -ForegroundColor Cyan
    Write-Host "$DisplayName 拡張機能のインストール完了" -ForegroundColor Cyan
    Write-Host "成功: $successCount, 失敗: $failCount" -ForegroundColor $(if ($failCount -eq 0) { "Green" } else { "Yellow" })
    Write-Host "所要時間: $($duration.Minutes)分 $($duration.Seconds)秒" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    
    return $true
}

# メイン処理
if (-not (Test-Path $extensionsFile)) {
    Write-Host "拡張機能リストファイルが見つかりません: $extensionsFile" -ForegroundColor Red
    exit 1
}

Write-Host "拡張機能リストファイルを読み込みました: $extensionsFile" -ForegroundColor Green
$extensionCount = (Get-Content $extensionsFile | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Measure-Object).Count
Write-Host "インストール予定の拡張機能数: $extensionCount" -ForegroundColor Cyan
Write-Host ""

# VS Code 拡張機能のインストール
$vsCodeResult = Install-Extensions -CommandName "code" -DisplayName "Visual Studio Code"

# Cursor 拡張機能のインストール
$cursorResult = Install-Extensions -CommandName "cursor" -DisplayName "Cursor"

# 結果サマリー
Write-Host "========================================" -ForegroundColor Green
Write-Host "拡張機能インストール完了" -ForegroundColor Green
Write-Host "----------------------------------------" -ForegroundColor Green

if ($vsCodeResult) {
    Write-Host "VS Code: インストール完了" -ForegroundColor Green
} else {
    Write-Host "VS Code: インストールスキップ（未インストールまたはPATHに存在しない）" -ForegroundColor Yellow
}

if ($cursorResult) {
    Write-Host "Cursor: インストール完了" -ForegroundColor Green
} else {
    Write-Host "Cursor: インストールスキップ（未インストールまたはPATHに存在しない）" -ForegroundColor Yellow
}

Write-Host "========================================" -ForegroundColor Green
Write-Host "拡張機能の再インストールが必要な場合は、このスクリプトを再度実行してください。" -ForegroundColor Cyan
Write-Host "問題が解決しない場合は、READMEの「Windows環境での拡張機能インストールの問題解決」セクションを参照してください。" -ForegroundColor Cyan