#!/bin/bash
# WSLからWindows環境のHackGen Nerd Fontをインストールするためのスクリプト

echo "WSL用HackGen Nerd Fontインストーラー"
echo "======================================"
echo ""

# 現在のディレクトリのWindowsパスを取得
WIN_PATH=$(wslpath -w "$(pwd)")

echo "Windowsバッチファイルを管理者権限で実行します..."
echo "インストール完了後にフォントが利用可能になります。"
echo ""

# バッチファイルの存在確認
if [ ! -f "./install-hackgen-font.bat" ]; then
    echo "エラー: install-hackgen-font.batが見つかりません。"
    exit 1
fi

# Windowsバッチファイルを実行
cmd.exe /c "start /wait cmd.exe /c \"${WIN_PATH}\\install-hackgen-font.bat\""

echo ""
echo "インストールプロセスが完了しました。"
echo "WezTermを再起動して、新しいフォントが適用されていることを確認してください。"