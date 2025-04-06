# HackGen Font Installer for Windows - Simplified for WSL compatibility
# このスクリプトはHackGen fontをWindowsにインストールするためのものです

# 設定
$fontsFolder = "$env:LOCALAPPDATA\Microsoft\Windows\Fonts"
$tempFolder = "$env:TEMP\HackGenInstall"
$hackGenUrl = "https://github.com/yuru7/HackGen/releases/download/v2.9.0/HackGen_NF_v2.9.0.zip"
$hackGenZip = "$tempFolder\HackGen_NF.zip"

# ヘルパー関数 - エラーメッセージを表示
function Show-ErrorMessage {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Red
}

# ヘルパー関数 - 成功メッセージを表示
function Show-SuccessMessage {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Green
}

# ヘルパー関数 - 情報メッセージを表示
function Show-InfoMessage {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

# テンポラリフォルダの作成
if (-not (Test-Path $tempFolder)) {
    New-Item -Path $tempFolder -ItemType Directory -Force | Out-Null
}

# フォントをダウンロード
Show-InfoMessage "HackGen Nerd Fontをダウンロード中..."
try {
    Invoke-WebRequest -Uri $hackGenUrl -OutFile $hackGenZip
}
catch {
    Show-ErrorMessage "ダウンロード中にエラーが発生しました: $_"
    exit 1
}

# ZIPを解凍
Show-InfoMessage "HackGen Nerd Fontを解凍中..."
try {
    Expand-Archive -Path $hackGenZip -DestinationPath $tempFolder -Force
}
catch {
    Show-ErrorMessage "解凍中にエラーが発生しました: $_"
    exit 1
}

# フォントファイルを検索
$fontFiles = Get-ChildItem -Path $tempFolder -Recurse -Filter "*.ttf"
if ($fontFiles.Count -eq 0) {
    Show-ErrorMessage "フォントファイルが見つかりませんでした。"
    exit 1
}

Show-InfoMessage "$($fontFiles.Count)個のフォントファイルが見つかりました。インストールを開始します..."

# フォントをインストール
foreach ($fontFile in $fontFiles) {
    $fontPath = $fontFile.FullName
    $fontName = $fontFile.Name
    
    # フォントをコピー
    try {
        Copy-Item -Path $fontPath -Destination "$fontsFolder\$fontName" -Force
        New-ItemProperty -Path "HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts" -Name $fontName -Value "$fontsFolder\$fontName" -PropertyType String -Force | Out-Null
        Show-SuccessMessage "インストール成功: $fontName"
    }
    catch {
        Show-InfoMessage "インストールスキップ: $fontName (すでに使用中またはインストール済み)"
    }
}

# クリーンアップ
if (Test-Path $hackGenZip) {
    Remove-Item -Path $hackGenZip -Force
}

Show-SuccessMessage "HackGen Nerd Fontのインストールが完了しました。"
Show-InfoMessage "WezTermや他のアプリケーションを再起動して、新しいフォントを認識させてください。"