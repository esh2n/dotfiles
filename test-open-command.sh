#!/bin/bash
# Test script for the 'open' command
# This script helps verify that the 'open' command works properly
# after running the utilities setup script

set -e

# Terminal colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BLUE}${BOLD}Testing 'open' Command Functionality${NC}"
echo -e "${BLUE}${BOLD}=================================${NC}\n"

# Create a test directory
TEST_DIR="/tmp/open-test-dir"
mkdir -p "$TEST_DIR"
echo "<html><body><h1>Test HTML File</h1><p>This is a test.</p></body></html>" > "$TEST_DIR/test.html"
echo "console.log('Test JavaScript file');" > "$TEST_DIR/test.js"

# Function to test opening a directory
test_directory() {
  echo -e "\n${YELLOW}${BOLD}Test 1: Opening a directory${NC}"
  echo -e "${YELLOW}This will attempt to open a file browser at ${TEST_DIR}${NC}"
  echo -e "Press Enter to continue or Ctrl+C to cancel..."
  read -r
  
  echo -e "${BLUE}Running: open ${TEST_DIR}${NC}"
  if open "$TEST_DIR"; then
    echo -e "${GREEN}✓ Directory test completed${NC}"
  else
    echo -e "${RED}✗ Directory test failed${NC}"
    echo -e "${YELLOW}See error messages above for troubleshooting${NC}"
  fi
}

# Function to test opening an HTML file
test_html_file() {
  echo -e "\n${YELLOW}${BOLD}Test 2: Opening an HTML file${NC}"
  echo -e "${YELLOW}This will attempt to open ${TEST_DIR}/test.html in a browser${NC}"
  echo -e "Press Enter to continue or Ctrl+C to cancel..."
  read -r
  
  echo -e "${BLUE}Running: open ${TEST_DIR}/test.html${NC}"
  if open "${TEST_DIR}/test.html"; then
    echo -e "${GREEN}✓ HTML file test completed${NC}"
  else
    echo -e "${RED}✗ HTML file test failed${NC}"
    echo -e "${YELLOW}See error messages above for troubleshooting${NC}"
  fi
}

# Function to test opening a URL
test_url() {
  echo -e "\n${YELLOW}${BOLD}Test 3: Opening a URL${NC}"
  echo -e "${YELLOW}This will attempt to open https://example.com in a browser${NC}"
  echo -e "Press Enter to continue or Ctrl+C to cancel..."
  read -r
  
  echo -e "${BLUE}Running: open https://example.com${NC}"
  if open "https://example.com"; then
    echo -e "${GREEN}✓ URL test completed${NC}"
  else
    echo -e "${RED}✗ URL test failed${NC}"
    echo -e "${YELLOW}See error messages above for troubleshooting${NC}"
  fi
}

# Run the tests
test_directory
test_html_file
test_url

echo -e "\n${BLUE}${BOLD}Testing Complete${NC}"
echo -e "${YELLOW}Clean up temporary files? [Y/n] ${NC}"
read -r cleanup
cleanup=${cleanup:-Y}
if [[ "$cleanup" =~ ^[Yy]$ ]]; then
  rm -rf "$TEST_DIR"
  echo -e "${GREEN}Temporary files removed${NC}"
fi

# Final message
echo -e "\n${GREEN}${BOLD}If all tests passed, your 'open' command is working correctly!${NC}"
echo -e "${YELLOW}If you encountered any issues, please review the error messages and consider:${NC}"
echo -e "  1. Running the utilities setup script again: ${BOLD}./linux-utils-setup.sh${NC}"
echo -e "  2. Checking your shell configuration for any conflicts"
echo -e "  3. Ensuring you have the required packages installed\n"