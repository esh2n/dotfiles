#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# Lazy Loader (loader.sh) / 遅延読み込みローダー
# -----------------------------------------------------------------------------
# Provides mechanisms to lazy load heavy commands and source shell fragments.
# 重いコマンドの遅延読み込みとシェル設定の読み込み機能を提供します。
# -----------------------------------------------------------------------------

# Ensure logging helpers exist even if common utilities aren't ready yet
if ! typeset -f log_debug >/dev/null 2>&1; then
    log_debug() { :; }
fi

# Resolve dotfiles root when invoked from non-Bash shells
__loader_dir=""
if [[ -n "${DOTFILES_ROOT:-}" ]]; then
    __loader_dir="${DOTFILES_ROOT}/core/install"
else
    if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
        __loader_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
        DOTFILES_ROOT="$(cd "${__loader_dir}/../.." && pwd)"
    else
        __loader_dir="$(cd "$(dirname "${0}")" && pwd)"
        DOTFILES_ROOT="$(cd "${__loader_dir}/../.." && pwd)"
    fi
fi

# Source common utilities if not already sourced
# 共通ユーティリティが読み込まれていない場合は読み込む
if [[ -z "${COLOR_RED:-}" ]]; then
    if [[ -f "${DOTFILES_ROOT}/core/utils/common.sh" ]]; then
        source "${DOTFILES_ROOT}/core/utils/common.sh"
    else
        log_info()  { echo "$*"; }
        log_success(){ echo "$*"; }
        log_warn()  { echo "$*"; }
        log_error() { echo "$*" >&2; }
        log_debug() { :; }
    fi
fi
unset __loader_dir

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
# Cached Eval
# -----------------------------------------------------------------------------

# Cache the output of slow `<tool> init`-style commands and source the cache.
# The output is static per tool version, so spawning the binary on every
# shell (~15-50ms each) is wasted; regenerate only when the binary is newer
# than the cache. Same pattern as the atuin cache in options.zsh.
# 重い `<tool> init` 系コマンドの出力をキャッシュして source する。
# Usage: cached_eval <cache-name> <command> [args...]
# Example: cached_eval starship-init starship init zsh
cached_eval() {
    local name="$1"; shift
    local cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/zsh"
    local cache="${cache_dir}/${name}.zsh"
    local bin out
    bin="$(command -v "$1")" || return 1
    if [ ! -f "$cache" ] || [ "$bin" -nt "$cache" ]; then
        [ -d "$cache_dir" ] || mkdir -p "$cache_dir"
        # Capture first, write only on success — avoids leaving a broken
        # cache behind (and needs no external `rm`). Empty output is not
        # cached: e.g. `brew shellenv` prints nothing when its env vars are
        # inherited, and caching that would break fresh login shells.
        out="$("$@" 2>/dev/null)" || return 1
        [ -n "$out" ] || return 1
        printf '%s\n' "$out" > "$cache"
    fi
    source "$cache"
}

# -----------------------------------------------------------------------------
# Async Initialization
# -----------------------------------------------------------------------------

# Run command in background silently / コマンドをバックグラウンドで静かに実行
async_run() {
    local cmd="$1"
    (eval "$cmd") >/dev/null 2>&1 &
}

