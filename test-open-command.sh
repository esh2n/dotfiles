#!/bin/bash
# Test script for the cross-platform open command

# Terminal colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BLUE}${BOLD}Cross-platform 'open' Command Test${NC}\n"

# Detect environment
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo -e "${BOLD}Environment:${NC} macOS"
elif grep -q Microsoft /proc/version 2>/dev/null; then
    echo -e "${BOLD}Environment:${NC} Windows Subsystem for Linux (WSL)"
else
    echo -e "${BOLD}Environment:${NC} Linux"
fi

# Test directory opening
echo -e "\n${YELLOW}${BOLD}Test 1:${NC} Opening current directory"
echo "Command: open ."
open .
echo -e "${GREEN}Done. Did a file browser open with the current directory?${NC}"

# Test file creation and opening
echo -e "\n${YELLOW}${BOLD}Test 2:${NC} Creating and opening a test file"
echo "Hello, this is a test file." > test-open-file.txt
echo "Command: open test-open-file.txt"
open test-open-file.txt
echo -e "${GREEN}Done. Did a text editor open with the test file?${NC}"

# Test URL opening
echo -e "\n${YELLOW}${BOLD}Test 3:${NC} Opening a URL"
echo "Command: open https://github.com"
echo -e "${BLUE}Press Enter to open GitHub in your browser...${NC}"
read
open https://github.com
echo -e "${GREEN}Done. Did your web browser open GitHub?${NC}"

# Cleanup
rm test-open-file.txt

echo -e "\n${BLUE}${BOLD}Test Complete${NC}"
echo -e "If any tests failed, run the WSL utilities setup script:"
echo -e "    ${BOLD}./wsl-utils-setup.sh${NC}"
echo ""