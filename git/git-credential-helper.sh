#!/bin/bash

# Automatically switches GitHub account based on directory context
# Usage: git-credential-helper.sh [account-name]

ACCOUNT=""
if [ $# -ge 1 ]; then
    if [[ "$1" != "get" && "$1" != "store" && "$1" != "erase" ]]; then
        ACCOUNT="$1"
        shift
    fi
fi

if [ -z "$ACCOUNT" ]; then
    PWD=$(pwd)
    if [[ "$PWD" == *"/eightcard/"* ]]; then
        ACCOUNT="esh3n"
    elif [[ "$PWD" == *"/sansaninc/"* ]]; then
        ACCOUNT="shunya-endo_sansan"
    else
        ACCOUNT="esh2n"
    fi
fi

if [ -n "$ACCOUNT" ]; then
    unset GH_TOKEN  # Prevents gh auth switch issues
    
    CURRENT_ACCOUNT=$(gh auth status 2>&1 | grep "Active account: true" -B 1 | head -1 | awk '{print $6}')
    
    if [ "$CURRENT_ACCOUNT" != "$ACCOUNT" ]; then
        gh auth switch -u "$ACCOUNT" 2>/dev/null
    fi
fi

exec /opt/homebrew/bin/gh auth git-credential "$@"
