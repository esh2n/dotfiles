#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# Lazy Loader (loader.sh) / 遅延読み込みローダー
# -----------------------------------------------------------------------------
# Provides mechanisms to lazy load heavy commands and source shell fragments.
# 重いコマンドの遅延読み込みとシェル設定の読み込み機能を提供します。
# -----------------------------------------------------------------------------

# Source common utilities if not already sourced
# 共通ユーティリティが読み込まれていない場合は読み込む
if [[ -z "${COLOR_RED:-}" ]]; then
    source "$(dirname "${BASH_SOURCE[0]}")/../utils/common.sh"
fi

# -----------------------------------------------------------------------------
# Lazy Loading Mechanism
# -----------------------------------------------------------------------------

# Usage: lazy_load_command "command_name" "init_function"
# Example: lazy_load_command "nvm" "init_nvm"
lazy_load_command() {
    local cmd="$1"
    local init_func="$2"
    
    # Define a wrapper function for the command
    eval "${cmd}() {
        log_debug \"Lazy loading ${cmd}...\"
        unset -f ${cmd}
        ${init_func}
        if command -v ${cmd} >/dev/null; then
            ${cmd} \"\$@\"
        else
            log_error \"Command ${cmd} not found after initialization\"
            return 127
        fi
    }"
}

# -----------------------------------------------------------------------------
# Domain Shell Loading
# -----------------------------------------------------------------------------

# Load all shell fragments from domains / ドメインからシェル設定を読み込む
load_domain_shell_configs() {
    local dotfiles_root="$1"
    local shell_name="$2" # zsh or fish
    
    log_debug "Loading domain configs for ${shell_name}..."
    
    for domain_dir in "${dotfiles_root}/domains/"*; do
        if [[ -d "$domain_dir" ]]; then
            # Load init file / 初期化ファイルを読み込む
            local init_file=""
            if [[ "$shell_name" == "zsh" ]]; then
                init_file="${domain_dir}/shell/zsh/init.zsh"
            elif [[ "$shell_name" == "fish" ]]; then
                # Fish loader logic should be handled by fish itself, but keeping placeholder
                :
            fi
            
            if [[ -n "$init_file" && -f "$init_file" ]]; then
                log_debug "Sourcing ${init_file}"
                source "$init_file"
            fi
        fi
    done
}

# -----------------------------------------------------------------------------
# Async Initialization
# -----------------------------------------------------------------------------

# Run command in background silently / コマンドをバックグラウンドで静かに実行
async_run() {
    local cmd="$1"
    (eval "$cmd") >/dev/null 2>&1 &
}

# -----------------------------------------------------------------------------
# Specific Lazy Loaders (Common)
# -----------------------------------------------------------------------------

# Example: Lazy load mise (if used)
init_mise() {
    if command -v mise >/dev/null; then
        eval "$(mise activate zsh)"
    fi
}

setup_lazy_mise() {
    if command -v mise >/dev/null; then
        lazy_load_command "mise" "init_mise"
        lazy_load_command "node" "init_mise"
        lazy_load_command "npm" "init_mise"
        lazy_load_command "python" "init_mise"
        lazy_load_command "go" "init_mise"
        lazy_load_command "cargo" "init_mise"
    fi
}
