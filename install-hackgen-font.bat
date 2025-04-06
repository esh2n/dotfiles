@echo off
REM HackGen Font Installer for Windows - Simple Batch Version
REM このスクリプトはHackGen fontをWindowsにインストールするためのものです

echo HackGen Nerd Fontインストーラー
echo ====================================
echo.

REM 管理者権限チェック
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 管理者権限が必要です。右クリックから「管理者として実行」を選択してください。
    pause
    exit /b 1
)

set TEMP_DIR=%TEMP%\HackGenInstall
set FONTS_DIR=%LOCALAPPDATA%\Microsoft\Windows\Fonts
set DOWNLOAD_URL=https://github.com/yuru7/HackGen/releases/download/v2.9.0/HackGen_NF_v2.9.0.zip
set ZIP_FILE=%TEMP_DIR%\HackGen_NF.zip

REM テンポラリフォルダの作成
if not exist "%TEMP_DIR%" mkdir "%TEMP_DIR%"

echo HackGen Nerd Fontをダウンロード中...
powershell -Command "& {Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%ZIP_FILE%'}"
if %errorlevel% neq 0 (
    echo ダウンロード中にエラーが発生しました。
    pause
    exit /b 1
)

echo ダウンロード完了。解凍中...
powershell -Command "& {Expand-Archive -Path '%ZIP_FILE%' -DestinationPath '%TEMP_DIR%' -Force}"
if %errorlevel% neq 0 (
    echo 解凍中にエラーが発生しました。
    pause
    exit /b 1
)

echo 解凍完了。フォントをインストール中...

REM フォントのインストール
powershell -Command "& { $fontFiles = Get-ChildItem -Path '%TEMP_DIR%' -Recurse -Filter '*.ttf'; foreach ($font in $fontFiles) { Copy-Item -Path $font.FullName -Destination '%FONTS_DIR%\' -Force; echo ('インストール: ' + $font.Name) } }"

echo.
echo HackGen Nerd Fontのインストールが完了しました。
echo WezTermや他のアプリケーションを再起動して、新しいフォントを認識させてください。
echo.

REM クリーンアップ
del "%ZIP_FILE%" 2>nul

pause