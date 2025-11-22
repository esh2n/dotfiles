#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# Core Utilities (common.sh)
# コアユーティリティ (common.sh)
# -----------------------------------------------------------------------------
# Provides logging, OS detection, and file operation utilities.
# ログ機能、OS検出、ファイル操作ユーティリティを提供します。
# -----------------------------------------------------------------------------

# Colors / 色定義
export COLOR_RED='\033[0;31m'
export COLOR_GREEN='\033[0;32m'
export COLOR_YELLOW='\033[0;33m'
export COLOR_BLUE='\033[0;34m'
export COLOR_PURPLE='\033[0;35m'
export COLOR_CYAN='\033[0;36m'
export COLOR_GRAY='\033[0;90m'
export COLOR_RESET='\033[0m'

# -----------------------------------------------------------------------------
# Logging Functions
# -----------------------------------------------------------------------------

log_info() {
    echo -e "${COLOR_BLUE}[INFO]${COLOR_RESET} $1"
}

log_success() {
    echo -e "${COLOR_GREEN}[SUCCESS]${COLOR_RESET} $1"
}

log_warn() {
    echo -e "${COLOR_YELLOW}[WARN]${COLOR_RESET} $1"
}

log_error() {
    echo -e "${COLOR_RED}[ERROR]${COLOR_RESET} $1" >&2
}

log_debug() {
    if [[ "${DEBUG:-0}" == "1" ]]; then
        echo -e "${COLOR_GRAY}[DEBUG]${COLOR_RESET} $1"
    fi
}

# -----------------------------------------------------------------------------
# OS Detection
# -----------------------------------------------------------------------------

is_macos() {
    [[ "$(uname)" == "Darwin" ]]
}

is_linux() {
    [[ "$(uname)" == "Linux" ]]
}

get_os_version() {
    if is_macos; then
        sw_vers -productVersion
    else
        uname -r
    fi
}

check_macos_version() {
    local min_version="$1"
    local current_version
    current_version=$(get_os_version)
    
    # Simple version comparison
    if [[ "$current_version" < "$min_version" ]]; then
        return 1
    fi
    return 0
}

# -----------------------------------------------------------------------------
# File Operations
# -----------------------------------------------------------------------------

backup_file() {
    local file="$1"
    if [[ -e "$file" ]]; then
        local backup_path="${file}.backup.$(date +%Y%m%d_%H%M%S)"
        log_warn "Backing up $file to $backup_path"
        mv "$file" "$backup_path"
    fi
}

ensure_dir() {
    local dir="$1"
    if [[ ! -d "$dir" ]]; then
        log_debug "Creating directory: $dir"
        mkdir -p "$dir"
    fi
}

link_file() {
    local src="$1"
    local dest="$2"
    
    if [[ ! -e "$src" ]]; then
        log_error "Source file not found: $src"
        return 1
    fi
    
    ensure_dir "$(dirname "$dest")"
    
    if [[ -L "$dest" ]]; then
        local current_link
        current_link=$(readlink "$dest")
        if [[ "$current_link" == "$src" ]]; then
            log_debug "Link already exists: $dest -> $src"
            return 0
        fi
    fi
    
    if [[ -e "$dest" ]]; then
        backup_file "$dest"
    fi
    
    ln -sf "$src" "$dest"
    log_success "Linked $src -> $dest"
}

# -----------------------------------------------------------------------------
# Command Checks
# -----------------------------------------------------------------------------

has_command() {
    command -v "$1" >/dev/null 2>&1
}

require_command() {
    if ! has_command "$1"; then
        log_error "Required command not found: $1"
        exit 1
    fi
}
