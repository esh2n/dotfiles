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
    local max_backups=7
    
    if [[ -e "$file" ]]; then
        local backup_path="${file}.backup.$(date +%Y%m%d_%H%M%S)"
        log_warn "Backing up $file to $backup_path"

        if [[ -L "$file" ]]; then
            local target="$(readlink "$file")"
            if [[ -e "$target" ]]; then
                cp -r "$target" "$backup_path"
                rm "$file"
            else
                mv "$file" "$backup_path"
            fi
        else
            mv "$file" "$backup_path"
        fi
        
        # Keep only latest N backups
        local backup_pattern="${file}.backup.*"
        local backup_count=$(ls -1d ${backup_pattern} 2>/dev/null | wc -l)
        if (( backup_count > max_backups )); then
            ls -1dt ${backup_pattern} 2>/dev/null | tail -n +$((max_backups + 1)) | xargs rm -rf
        fi
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
        # If dest is a directory and not a symlink, backup and remove it
        if [[ -d "$dest" && ! -L "$dest" ]]; then
            backup_file "$dest"
            rm -rf "$dest"
        elif [[ -e "$dest" && ! -L "$dest" ]]; then
             backup_file "$dest"
             rm -f "$dest"
        fi
    fi
    
    # Use -n (no-dereference) to treat dest as a normal file if it is a symlink to a directory
    ln -sfn "$src" "$dest"
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

# -----------------------------------------------------------------------------
# Homebrew Utilities
# -----------------------------------------------------------------------------

# Check if a brew formula is installed
is_brew_formula_installed() {
    local formula="$1"
    brew list --formula "$formula" >/dev/null 2>&1
}

# Check if a brew cask is installed
is_brew_cask_installed() {
    local cask="$1"
    brew list --cask "$cask" >/dev/null 2>&1
}

# Install brew packages from Brewfile with smart checking
install_brewfile() {
    local brewfile="$1"
    
    if [[ ! -f "$brewfile" ]]; then
        log_error "Brewfile not found: $brewfile"
        return 1
    fi
    
    if ! has_command "brew"; then
        log_error "Homebrew not found. Skipping Brewfile."
        return 1
    fi
    
    log_info "Processing Brewfile: $(basename "$brewfile")"
    
    local installed_count=0
    local skipped_count=0
    local failed_count=0
    
    while IFS= read -r line || [[ -n "$line" ]]; do
        # Skip comments and empty lines
        [[ $line =~ ^[[:space:]]*# ]] && continue
        [[ -z "${line// }" ]] && continue
        
        # Parse brew/cask lines
        if [[ $line =~ ^[[:space:]]*brew[[:space:]]+\"([^\"]+)\" ]]; then
            local formula="${BASH_REMATCH[1]}"
            
            if is_brew_formula_installed "$formula"; then
                log_debug "Formula already installed: $formula"
                ((skipped_count++))
            else
                log_info "Installing formula: $formula"
                # Capture error output to check for "already an App" message
                # エラー出力をキャプチャして「既にアプリが存在する」メッセージを確認
                local install_output
                install_output=$(brew install "$formula" 2>&1)
                local install_exit=$?
                
                if [[ $install_exit -eq 0 ]]; then
                    ((installed_count++))
                elif echo "$install_output" | grep -q "already an App"; then
                    # App already exists but not managed by brew - treat as skipped
                    # アプリは既に存在するがbrewで管理されていない - スキップとして扱う
                    log_debug "Formula already exists (not managed by brew): $formula"
                    ((skipped_count++))
                else
                    log_warn "Failed to install formula: $formula"
                    ((failed_count++))
                fi
            fi
            
        elif [[ $line =~ ^[[:space:]]*cask[[:space:]]+\"([^\"]+)\" ]]; then
            local cask="${BASH_REMATCH[1]}"
            
            if is_brew_cask_installed "$cask"; then
                log_debug "Cask already installed: $cask"
                ((skipped_count++))
            else
                log_info "Installing cask: $cask"
                # Capture error output to check for "already an App" message
                # エラー出力をキャプチャして「既にアプリが存在する」メッセージを確認
                local install_output
                install_output=$(brew install --cask "$cask" 2>&1)
                local install_exit=$?
                
                if [[ $install_exit -eq 0 ]]; then
                    ((installed_count++))
                elif echo "$install_output" | grep -q "already an App"; then
                    # App already exists but not managed by brew - treat as skipped
                    # アプリは既に存在するがbrewで管理されていない - スキップとして扱う
                    log_debug "Cask already exists (not managed by brew): $cask"
                    ((skipped_count++))
                else
                    log_warn "Failed to install cask: $cask"
                    ((failed_count++))
                fi
            fi
        fi
    done < "$brewfile"
    
    log_success "Brewfile processing complete: ${installed_count} installed, ${skipped_count} skipped, ${failed_count} failed"
}

# -----------------------------------------------------------------------------
# Spinner & Progress Utilities
# -----------------------------------------------------------------------------

show_spinner() {
    local pid="$1"
    local message="${2:-Processing}"
    local spinner_chars="⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
    local delay=0.1
    local i=0

    while kill -0 "$pid" 2>/dev/null; do
        local char="${spinner_chars:$((i % ${#spinner_chars})):1}"
        printf "\r%s %s..." "$char" "$message"
        sleep "$delay"
        ((i++))
    done

    printf "\r"
}

show_progress_bar() {
    local current="$1"
    local total="$2"
    local message="${3:-Progress}"
    local width=50
    local percentage=$((current * 100 / total))
    local filled=$((current * width / total))
    local bar=""

    for ((i=0; i<width; i++)); do
        if [[ $i -lt $filled ]]; then
            bar+="█"
        else
            bar+="░"
        fi
    done

    printf "\r%s [%s] %d%% (%d/%d)" "$message" "$bar" "$percentage" "$current" "$total"

    if [[ $current -eq $total ]]; then
        printf "\n"
    fi
}

run_with_spinner() {
    local message="$1"
    shift
    local temp_file="/tmp/dotfiles-spinner-$$"

    "$@" > "$temp_file" 2>&1 &
    local cmd_pid=$!

    show_spinner "$cmd_pid" "$message"

    wait "$cmd_pid"
    local exit_code=$?

    if [[ $exit_code -eq 0 ]]; then
        printf "\r${COLOR_GREEN}✓${COLOR_RESET} %s\n" "$message"
    else
        printf "\r${COLOR_RED}✗${COLOR_RESET} %s\n" "$message"
        cat "$temp_file" >&2
    fi

    rm -f "$temp_file"
    return $exit_code
}

# -----------------------------------------------------------------------------
# Interactive Utilities
# -----------------------------------------------------------------------------

ask_yes_no() {
    local prompt="$1"
    local default="${2:-n}"
    local response

    while true; do
        read -p "$prompt [y/N]: " response
        response=${response:-$default}

        case "$response" in
            [yY]|[yY][eE][sS]) return 0 ;;
            [nN]|[nN][oO]) return 1 ;;
            *) echo "Please answer yes or no." ;;
        esac
    done
}

# -----------------------------------------------------------------------------
# Test Assertions
# -----------------------------------------------------------------------------
# Shared by the core/validation/*.sh suites, which all source this file. Each
# maintains the caller's TOTAL/PASSED/FAILED counters (bash `local` is
# dynamically scoped, so a suite that declares them inside its own run_*
# function still gets them updated here). A suite that needs different output
# may still define its own same-named helper after sourcing — the later
# definition wins.
# -----------------------------------------------------------------------------

# assert_true <description> <command…> — passes when the command exits 0.
assert_true() {
    local description="$1"; shift
    TOTAL=$((TOTAL + 1))
    if "$@" >/dev/null 2>&1; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description"
        FAILED=$((FAILED + 1))
    fi
}

# assert_eq_text <description> <expected> <actual> [diff_lines]
# Prints a unified diff (capped at $4, default 40 lines) on failure.
assert_eq_text() {
    local description="$1" expected="$2" actual="$3" diff_lines="${4:-40}"
    TOTAL=$((TOTAL + 1))
    if [[ "$expected" == "$actual" ]]; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description"
        # `|| true`: diff exits 1 on a difference and head can SIGPIPE it —
        # under `set -euo pipefail` that would abort the whole suite at the
        # FIRST failing assertion instead of reporting every one.
        { diff <(printf '%s\n' "$expected") <(printf '%s\n' "$actual") | sed 's/^/       /' | head -"$diff_lines"; } || true
        FAILED=$((FAILED + 1))
    fi
}

# assert_contains <description> <needle> <haystack> — fixed-string search.
assert_contains() {
    local description="$1" needle="$2" haystack="$3"
    TOTAL=$((TOTAL + 1))
    if grep -qF -- "$needle" <<< "$haystack"; then
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    else
        log_error "FAIL: $description"
        log_error "  wanted: $needle"
        FAILED=$((FAILED + 1))
    fi
}

# assert_lacks <description> <needle> <haystack> — the inverse.
assert_lacks() {
    local description="$1" needle="$2" haystack="$3"
    TOTAL=$((TOTAL + 1))
    if grep -qF -- "$needle" <<< "$haystack"; then
        log_error "FAIL: $description"
        log_error "  unwanted: $needle"
        FAILED=$((FAILED + 1))
    else
        log_success "PASS: $description"
        PASSED=$((PASSED + 1))
    fi
}

# -----------------------------------------------------------------------------
# Tree Snapshots
# -----------------------------------------------------------------------------

# tree_manifest <dir> — content-addressed manifest of every file and symlink
# under <dir>: `relative/path<TAB>FILE:<sha256>` or
# `relative/path<TAB>SYMLINK:<target>`, one per line, LC_ALL=C sorted.
#
# Never dereferences a symlink, deliberately. Plain `diff -r` does: BSD diff
# follows symlinks even under -r, so a dangling one makes it print "No such
# file or directory" and STILL exit 0 — a silent false pass. Comparing a
# symlink by its own target text also avoids walking into real repo skill
# directories that a fixture merely points at.
tree_manifest() {
    local dir="$1"
    [[ -d "$dir" ]] || return 0
    ( cd "$dir" && find . -mindepth 1 \( -type f -o -type l \) | LC_ALL=C sort | while IFS= read -r f; do
        f="${f#./}"
        if [[ -L "$f" ]]; then
            printf '%s\tSYMLINK:%s\n' "$f" "$(readlink "$f")"
        else
            printf '%s\tFILE:%s\n' "$f" "$(shasum -a 256 "$f" | awk '{print $1}')"
        fi
    done )
}
