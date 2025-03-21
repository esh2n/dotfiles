#!/bin/bash
# Test script for the 'open' command functionality
# Tests opening directories, HTML files, and URLs

# Terminal colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Header
echo -e "${BLUE}${BOLD}Testing 'open' command functionality${NC}"
echo -e "${BLUE}${BOLD}=================================${NC}\n"

# Detect environment
if grep -qi microsoft /proc/version 2>/dev/null || grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; then
    echo -e "${YELLOW}WSL environment detected${NC}"
    ENV_TYPE="WSL"
else
    echo -e "${YELLOW}Standard Linux environment detected${NC}"
    ENV_TYPE="Linux"
fi

# Create a temporary HTML file for testing
TEST_DIR="$(pwd)/test_open_dir"
TEST_HTML="$TEST_DIR/test.html"

mkdir -p "$TEST_DIR"

cat > "$TEST_HTML" << EOF
<!DOCTYPE html>
<html>
<head>
    <title>Open Command Test</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f4f4f4;
            color: #333;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #2c3e50;
        }
        .success {
            color: #27ae60;
            font-weight: bold;
        }
        .info {
            margin-top: 20px;
            padding: 10px;
            background-color: #e8f4f8;
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Open Command Test</h1>
        <p class="success">SUCCESS! Your HTML file opened correctly.</p>
        <p>If you're seeing this page, the 'open' command is working properly for HTML files.</p>
        <div class="info">
            <p><strong>Environment:</strong> $ENV_TYPE</p>
            <p><strong>Test file:</strong> $TEST_HTML</p>
            <p><strong>Date & Time:</strong> $(date)</p>
        </div>
    </div>
</body>
</html>
EOF

echo -e "${BOLD}Test 1:${NC} Opening a directory\n"
echo -e "Command: ${YELLOW}open $TEST_DIR${NC}"
echo -e "Press Enter to continue or Ctrl+C to cancel..."
read

echo -e "Opening test directory..."
open "$TEST_DIR"
DIR_RESULT=$?

if [ $DIR_RESULT -eq 0 ]; then
    echo -e "\n${GREEN}✓ Directory opened successfully${NC}"
else
    echo -e "\n${RED}✗ Failed to open directory (exit code: $DIR_RESULT)${NC}"
    echo -e "${YELLOW}Try running the setup script:${NC}"
    echo -e "    ./linux-utils-setup.sh"
fi

echo -e "\nPress Enter to continue to the next test..."
read

echo -e "\n${BOLD}Test 2:${NC} Opening an HTML file\n"
echo -e "Command: ${YELLOW}open $TEST_HTML${NC}"
echo -e "Press Enter to continue or Ctrl+C to cancel..."
read

echo -e "Opening test HTML file..."
open "$TEST_HTML"
HTML_RESULT=$?

if [ $HTML_RESULT -eq 0 ]; then
    echo -e "\n${GREEN}✓ HTML file opened successfully${NC}"
else
    echo -e "\n${RED}✗ Failed to open HTML file (exit code: $HTML_RESULT)${NC}"
    echo -e "${YELLOW}Try running the setup script:${NC}"
    echo -e "    ./linux-utils-setup.sh"
fi

echo -e "\nPress Enter to continue to the next test..."
read

echo -e "\n${BOLD}Test 3:${NC} Opening a URL\n"
echo -e "Command: ${YELLOW}open https://github.com/esh2n/dotfiles${NC}"
echo -e "Press Enter to continue or Ctrl+C to cancel..."
read

echo -e "Opening URL..."
open "https://github.com/esh2n/dotfiles"
URL_RESULT=$?

if [ $URL_RESULT -eq 0 ]; then
    echo -e "\n${GREEN}✓ URL opened successfully${NC}"
else
    echo -e "\n${RED}✗ Failed to open URL (exit code: $URL_RESULT)${NC}"
    echo -e "${YELLOW}Try running the setup script:${NC}"
    echo -e "    ./linux-utils-setup.sh"
fi

# Summary
echo -e "\n${BLUE}${BOLD}Test Summary${NC}"
echo -e "=============\n"

PASSED=0
TOTAL=3

if [ $DIR_RESULT -eq 0 ]; then
    echo -e "${GREEN}✓ Directory test passed${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ Directory test failed${NC}"
fi

if [ $HTML_RESULT -eq 0 ]; then
    echo -e "${GREEN}✓ HTML file test passed${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ HTML file test failed${NC}"
fi

if [ $URL_RESULT -eq 0 ]; then
    echo -e "${GREEN}✓ URL test passed${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ URL test failed${NC}"
fi

echo -e "\nPassed $PASSED/$TOTAL tests"

if [ $PASSED -eq 3 ]; then
    echo -e "\n${GREEN}${BOLD}All tests passed! The 'open' command is working correctly.${NC}"
else
    echo -e "\n${YELLOW}${BOLD}Some tests failed. Run the setup script to fix any issues:${NC}"
    echo -e "    ./linux-utils-setup.sh"
    
    if [ "$ENV_TYPE" = "WSL" ]; then
        echo -e "\n${YELLOW}WSL-specific tips:${NC}"
        echo -e "1. Make sure wslu is installed: ${BOLD}sudo apt install wslu${NC}"
        echo -e "2. Try using wslview directly: ${BOLD}wslview .${NC}"
        echo -e "3. Restart your WSL session: In PowerShell run ${BOLD}wsl --shutdown${NC}, then reopen WSL"
    else
        echo -e "\n${YELLOW}Linux-specific tips:${NC}"
        echo -e "1. Try setting the BROWSER environment variable: ${BOLD}export BROWSER=firefox${NC} (or your browser of choice)"
        echo -e "2. Update the desktop database: ${BOLD}update-desktop-database${NC}"
        echo -e "3. Install a file manager: ${BOLD}sudo apt install thunar${NC} (or your package manager equivalent)"
    fi
fi

echo -e "\n${YELLOW}Do you want to clean up the test files?${NC} [Y/n] "
read -r clean_response
case "$clean_response" in
    [nN]*)
        echo -e "Test files kept in ${BOLD}$TEST_DIR${NC}"
        ;;
    *)
        rm -rf "$TEST_DIR"
        echo -e "${GREEN}✓ Test files cleaned up${NC}"
        ;;
esac

echo -e "\n${BLUE}${BOLD}Test completed.${NC}\n"