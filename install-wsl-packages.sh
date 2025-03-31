#!/bin/bash
# WSL環境でaptパッケージをインストールするスクリプト
# zoxideやfzfなど、Homebrewより直接aptからインストールした方が安定する場合があります

set -e

# Terminal colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Check if we're running in WSL
is_wsl() {
  grep -qi microsoft /proc/version 2>/dev/null || grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null
}

# Check if a package is installed
is_installed() {
  if command -v dpkg &> /dev/null; then
    dpkg -l "$1" &> /dev/null
  else
    command -v "$1" &> /dev/null
  fi
}

# Header
echo -e "${BLUE}${BOLD}WSL環境用 apt パッケージインストーラー${NC}"
echo -e "${BLUE}${BOLD}=====================================${NC}\n"

# Detect environment
if is_wsl; then
  echo -e "${GREEN}WSL環境を検出しました${NC}"
else
  echo -e "${YELLOW}これはWSL環境用のスクリプトです。通常のLinux環境では実行する必要はありません。${NC}"
  echo -e "続行しますか？ (y/N)"
  read -r response
  if [[ ! "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    echo -e "${RED}インストールを中止します${NC}"
    exit 1
  fi
fi

# Check if apt is available
if ! command -v apt-get &> /dev/null; then
  echo -e "${RED}エラー: apt-getが見つかりません。このスクリプトはDebian/Ubuntu系のディストリビューションで実行してください。${NC}"
  exit 1
fi

# Check if the package list exists
APT_PACKAGES_FILE="packages/apt-packages.txt"
if [ ! -f "$APT_PACKAGES_FILE" ]; then
  echo -e "${RED}エラー: $APT_PACKAGES_FILE が見つかりません${NC}"
  exit 1
fi

# Update package list
echo -e "${BLUE}パッケージリストを更新しています...${NC}"
sudo apt-get update

# Install packages
echo -e "${BLUE}パッケージをインストールしています...${NC}"
installed_count=0
skipped_count=0
failed_count=0

# Read the file line by line
while IFS= read -r line || [ -n "$line" ]; do
  # Skip empty lines and comments
  if [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]]; then
    continue
  fi
  
  package=$(echo "$line" | tr -d '[:space:]')
  
  # Skip if already installed
  if is_installed "$package"; then
    echo -e "${YELLOW}既にインストール済み: ${NC}$package"
    skipped_count=$((skipped_count + 1))
    continue
  fi
  
  # Install the package
  echo -e "${BLUE}インストール中: ${NC}$package"
  if sudo apt-get install -y "$package"; then
    echo -e "${GREEN}✓ インストール成功: ${NC}$package"
    installed_count=$((installed_count + 1))
  else
    echo -e "${RED}✗ インストール失敗: ${NC}$package"
    failed_count=$((failed_count + 1))
  fi
done < "$APT_PACKAGES_FILE"

# Summary
echo -e "\n${BLUE}${BOLD}インストール結果${NC}"
echo -e "${GREEN}新規インストール: $installed_count${NC}"
echo -e "${YELLOW}スキップ（既存）: $skipped_count${NC}"
if [ $failed_count -gt 0 ]; then
  echo -e "${RED}インストール失敗: $failed_count${NC}"
fi

# Final message
echo -e "\n${GREEN}${BOLD}WSL環境用パッケージのインストールが完了しました！${NC}"
echo -e "これでzoxideやfzfなどのコマンドがaptから正しくインストールされ、問題なく動作するはずです。"
echo -e "\n新しいzshシェルを開始するには: ${BOLD}exec zsh${NC}"