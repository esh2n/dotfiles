# HackGen Font Installer for Windows
# このスクリプトはHackGen fontをWindowsにインストールするためのものです

# 管理者権限チェック
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Write-Error "このスクリプトは管理者権限で実行する必要があります。PowerShellを管理者として再起動して試してください。"
    exit 1
}

# 設定
$fontsFolder = "$env:LOCALAPPDATA\Microsoft\Windows\Fonts"
$systemFontsFolder = "$env:windir\Fonts"
$tempFolder = "$env:TEMP\HackGenInstall"

# テンポラリフォルダの作成
if (-not (Test-Path $tempFolder)) {
    New-Item -Path $tempFolder -ItemType Directory -Force | Out-Null
}

# HackGenのダウンロードURLとZIPファイル
$hackGenUrl = "https://github.com/yuru7/HackGen/releases/download/v2.9.0/HackGen_NF_v2.9.0.zip"
$hackGenZip = "$tempFolder\HackGen_NF.zip"

# ダウンロードとインストール関数
function Install-HackGenFont {
    Write-Host "HackGen Nerd Fontをダウンロード中..." -ForegroundColor Cyan
    
    # ダウンロード
    try {
        Invoke-WebRequest -Uri $hackGenUrl -OutFile $hackGenZip
    }
    catch {
        Write-Host "ダウンロード中にエラーが発生しました: $($_.Exception.Message)" -ForegroundColor Red
        return
    }
    
    # 解凍
    Write-Host "HackGen Nerd Fontを解凍中..." -ForegroundColor Cyan
    try {
        Expand-Archive -Path $hackGenZip -DestinationPath $tempFolder -Force
    }
    catch {
        Write-Host "解凍中にエラーが発生しました: $($_.Exception.Message)" -ForegroundColor Red
        return
    }
    
    # フォントファイルを探す
    $fontFiles = Get-ChildItem -Path $tempFolder -Recurse -Filter "*.ttf"
    
    if ($fontFiles.Count -eq 0) {
        Write-Host "フォントファイルが見つかりませんでした。" -ForegroundColor Red
        return
    }
    
    Write-Host "$($fontFiles.Count)個のフォントファイルが見つかりました。インストールを開始します..." -ForegroundColor Green
    
    # フォントのインストール
    foreach ($fontFile in $fontFiles) {
        $fontPath = $fontFile.FullName
        $fontName = $fontFile.Name
        
        # ローカルフォントフォルダにコピー
        try {
            Copy-Item -Path $fontPath -Destination "$fontsFolder\$fontName" -Force -ErrorAction Stop
            
            # レジストリに追加
            New-ItemProperty -Path "HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts" -Name $fontName -Value "$fontsFolder\$fontName" -PropertyType String -Force | Out-Null
            
            Write-Host "インストール成功: $fontName" -ForegroundColor Green
        } 
        catch {
            Write-Host "インストールスキップ: $fontName (すでに使用中またはインストール済み)" -ForegroundColor Yellow
        }
    }
    
    Write-Host "HackGen Nerd Fontのインストールが完了しました。" -ForegroundColor Green
    Write-Host "WezTermや他のアプリケーションを再起動して、新しいフォントを認識させてください。" -ForegroundColor Cyan
    
    # クリーンアップ
    if (Test-Path $hackGenZip) {
        Remove-Item -Path $hackGenZip -Force
    }
}

# メイン実行部分
Write-Host "Windows用HackGen Nerd Fontインストーラー" -ForegroundColor Cyan
Write-Host "このスクリプトはWezTermで日本語を美しく表示するためのHackGenフォントをインストールします" -ForegroundColor Cyan
Write-Host ""

$confirmation = Read-Host "HackGen Nerd Fontをインストールしますか？ (Y/N)"
if ($confirmation -eq 'Y' -or $confirmation -eq 'y') {
    Install-HackGenFont
} else {
    Write-Host "インストールをキャンセルしました。" -ForegroundColor Yellow
}