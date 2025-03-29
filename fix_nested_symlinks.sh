#!/bin/bash

# このスクリプトは入れ子になったシンボリックリンクの問題を解決します
set -euo pipefail

echo "入れ子になったシンボリックリンクを修正しています..."

# 問題のあるディレクトリを配列で定義
PROBLEM_DIRS=(
  "$HOME/.config/aerospace"
  "$HOME/.config/borders"
  "$HOME/.config/sketchybar"
  "$HOME/.config/nvim"
  "$HOME/.config/wezterm"
  "$HOME/.config/helix"
  "$HOME/.config/mise"
)

# 各ディレクトリについて徹底的にクリーンアップ
for dir in "${PROBLEM_DIRS[@]}"; do
  echo "クリーニング: $dir"
  
  # ディレクトリが存在するかチェック
  if [ -e "$dir" ]; then
    echo "  - 既存のパスを強制的に削除しています..."
    rm -rf "$dir"
    echo "  - 削除完了"
  else
    echo "  - パスは存在しません"
  fi
  
  # 親ディレクトリ内のゴミもチェック
  parent_dir=$(dirname "$dir")
  base_name=$(basename "$dir")
  if [ -e "$parent_dir/$base_name/$base_name" ]; then
    echo "  - 入れ子になったパスを削除しています: $parent_dir/$base_name/$base_name"
    rm -rf "$parent_dir/$base_name/$base_name"
  fi
done

echo "クリーンアップが完了しました。現在の状態:"
for dir in "${PROBLEM_DIRS[@]}"; do
  echo -n "$dir: "
  if [ -e "$dir" ]; then
    if [ -L "$dir" ]; then
      echo "シンボリックリンク -> $(readlink -f "$dir")"
    elif [ -d "$dir" ]; then
      echo "ディレクトリ"
    else
      echo "ファイル"
    fi
  else
    echo "存在しません"
  fi
done

echo ""
echo "全てのシンボリックリンクを再作成するには、次のコマンドを実行してください:"
echo "./refresh_symlinks.sh"