#!/bin/bash

# このスクリプトは入れ子になったシンボリックリンクの問題を根本から解決します
set -euo pipefail

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DOTFILES_DIR"

echo "入れ子になったシンボリックリンクを徹底的に修正しています..."

# 1. 問題のリポジトリディレクトリを特定
PROBLEM_DIRS=(
  "config/aerospace"
  "config/borders"
  "config/sketchybar"
  "config/nvim"
  "config/wezterm"
  "config/helix"
  "config/mise"
)

# 2. ホームディレクトリの対応する場所を削除
for dir in "${PROBLEM_DIRS[@]}"; do
  base_name=$(basename "$dir")
  target="$HOME/.config/$base_name"
  
  echo "クリーニング: $target"
  if [ -e "$target" ] || [ -L "$target" ]; then
    echo "  - 削除: $target"
    rm -rf "$target"
  fi
done

# 3. リポジトリディレクトリ内の入れ子になったシンボリックリンクを削除
for dir in "${PROBLEM_DIRS[@]}"; do
  base_name=$(basename "$dir")
  nested_link="$DOTFILES_DIR/$dir/$base_name"
  
  if [ -e "$nested_link" ] || [ -L "$nested_link" ]; then
    echo "  - 入れ子リンクを削除: $nested_link"
    rm -f "$nested_link"
  fi
  
  # サブディレクトリも確認
  if [ -d "$DOTFILES_DIR/$dir" ]; then
    echo "  - ディレクトリ内を確認: $DOTFILES_DIR/$dir"
    find "$DOTFILES_DIR/$dir" -type l -name "$base_name" -exec rm -f {} \;
  fi
done

# 4. git statusで確認
echo "-----------------------------"
echo "現在のGit Status:"
git status --short | grep "??" || echo "入れ子シンボリックリンクが検出されませんでした！"

# 5. シンボリックリンクを再作成（クリーンな状態から）
echo "-----------------------------"
echo "シンボリックリンクを手動で再作成します："

for dir in "${PROBLEM_DIRS[@]}"; do
  base_name=$(basename "$dir")
  src="$DOTFILES_DIR/$dir"
  dest="$HOME/.config/$base_name"
  
  echo "作成: $src -> $dest"
  ln -sf "$src" "$dest"
done

echo "-----------------------------"
echo "処理完了。入れ子リンクの問題は解消されたはずです。"
echo "確認するには再度 'git status' を実行してください。"