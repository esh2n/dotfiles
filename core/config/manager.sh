#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# Configuration Manager (manager.sh)
# 設定マネージャー (manager.sh)
# -----------------------------------------------------------------------------
# Manages symlinks for dotfiles, handling XDG configs and home directory files.
# ドットファイルのシンボリックリンクを管理し、XDG設定とホームディレクトリファイルを扱います。
# -----------------------------------------------------------------------------

# Source common utilities
# 共通ユーティリティの読み込み
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

# -----------------------------------------------------------------------------
# Template Processing
# テンプレート処理
# -----------------------------------------------------------------------------

generate_conditional_includes() {
    local conditional_dir="${DOTFILES_ROOT}/domains/dev/config/git/conditional"
    local includes=""

    # Check if conditional directory exists
    if [[ ! -d "$conditional_dir" ]]; then
        return
    fi

    # Process each .conf file in conditional directory
    while IFS= read -r -d '' conf_file; do
        local filename=$(basename "$conf_file")
        local conf_name="${filename%.conf}"

        # Extract GITDIR from comment if it exists (and replace {{HOME}})
        local gitdir=$(grep -m1 "^# GITDIR:" "$conf_file" | sed 's/^# GITDIR: *//' | sed "s|{{HOME}}|${HOME}|g")

        if [[ -n "$gitdir" ]]; then
            # Generate includeIf section for conditional config
            includes+="[includeIf \"gitdir:${gitdir}\"]\n"
            includes+="    path = ~/.config/git/conditional/${filename}\n"
        else
            # Generate include section for default config
            includes+="[include]\n"
            includes+="    path = ~/.config/git/conditional/${filename}\n"
        fi
    done < <(find "$conditional_dir" -name "*.conf" -type f -print0 2>/dev/null | sort -z)

    echo -e "$includes"
}

process_template() {
    local template_file="$1"
    local output_file="${template_file%.template}"

    if [[ ! -f "$template_file" ]]; then
        log_error "Template not found: $template_file"
        return 1
    fi

    log_info "Processing template: $(basename "$template_file")"

    # Generate conditional includes to a temporary file
    local temp_includes=$(mktemp)
    generate_conditional_includes > "$temp_includes"

    # Replace {{HOME}}, {{USER}} and {{DOTFILES_ROOT}} with actual values first.
    # {{DOTFILES_ROOT}} matches the token yoki-switch already expands, and is
    # what sbx kits need: a sandbox mounts the repo at its host path, so the
    # kit has to name that path literally.
    local temp_file=$(mktemp)
    sed -e "s|{{HOME}}|${HOME}|g" \
        -e "s|{{USER}}|${USER}|g" \
        -e "s|{{DOTFILES_ROOT}}|${DOTFILES_ROOT}|g" \
        "$template_file" > "$temp_file"

    # Replace {{CONDITIONAL_INCLUDES}} with generated includes
    if grep -q "{{CONDITIONAL_INCLUDES}}" "$temp_file"; then
        awk -v includes_file="$temp_includes" '
            /{{CONDITIONAL_INCLUDES}}/ {
                while ((getline line < includes_file) > 0) {
                    print line
                }
                close(includes_file)
                next
            }
            { print }
        ' "$temp_file" > "$output_file"
    else
        cp "$temp_file" "$output_file"
    fi

    # Clean up
    rm -f "$temp_file" "$temp_includes"

    log_success "Generated: $(basename "$output_file")"
}

process_all_templates() {
    log_info "Processing all templates..."
    
    # Find all .template files
    while IFS= read -r -d '' template; do
        process_template "$template"
    done < <(find "${DOTFILES_ROOT}/domains" -name "*.template" -print0)
    
    log_success "All templates processed."
}


# -----------------------------------------------------------------------------
# Symlink Logic
# -----------------------------------------------------------------------------

# Every ~/.config entry, ~/.claude and every ~/bin entry is a symlink INTO this
# checkout. Linking from a git worktree would therefore point the entire
# installation at a directory that disappears when the worktree is removed, and
# the breakage is machine-wide and silent. There is no reason to link a
# worktree, so refuse rather than offer a flag.
assert_canonical_checkout() {
    local common canonical
    common="$(git -C "$DOTFILES_ROOT" rev-parse --git-common-dir 2>/dev/null)" || return 0
    [[ -n "$common" ]] || return 0
    # Relative (".git") when DOTFILES_ROOT is the main checkout, absolute when
    # it is a worktree.
    [[ "$common" == /* ]] || common="${DOTFILES_ROOT}/${common}"
    canonical="$(cd "${common}/.." 2>/dev/null && pwd)" || return 0
    [[ "$canonical" == "$DOTFILES_ROOT" ]] && return 0

    log_error "Refusing to link from a git worktree."
    log_error "  worktree: $DOTFILES_ROOT"
    log_error "  main:     $canonical"
    log_error "~/.claude, ~/bin and ~/.config would point into the worktree and"
    log_error "break as soon as it is removed. Run this from the main checkout."
    return 1
}

# pi keeps configuration and runtime state in one directory (~/.pi/agent), so
# it cannot be symlinked wholesale — that would take auth.json and every saved
# session with it. Link only what this repo owns.
#
# settings.json and prompts/ are single entries; agents/ and extensions/ are
# linked FILE BY FILE because pi discovers each file there and the directory
# also has to stay writable for anything pi installs itself.
#
# Without this the wiring is hand-made and partial: on 2026-08-15 only
# claude-worker.md was linked, so /yoki-review called five language reviewers
# that were not installed.
link_pi_resources() {
    local src_dir="$1"
    local pi_home="${HOME}/.pi/agent"

    ensure_dir "$pi_home"

    [[ -f "${src_dir}/settings.json" ]] && link_file "${src_dir}/settings.json" "${pi_home}/settings.json"
    [[ -d "${src_dir}/prompts" ]] && link_file "${src_dir}/prompts" "${pi_home}/prompts"

    local sub
    for sub in agents extensions; do
        [[ -d "${src_dir}/${sub}" ]] || continue
        ensure_dir "${pi_home}/${sub}"
        while IFS= read -r -d '' resource; do
            link_file "$resource" "${pi_home}/${sub}/$(basename "$resource")"
        done < <(find "${src_dir}/${sub}" -mindepth 1 -maxdepth 1 \( -type f -o -type l \) -print0)
    done
}


# omp reads ~/.omp/agent — like pi, that directory holds runtime state
# (agent.db, sessions, logs) next to configuration, so link the children we
# own rather than the directory. config.yml/models.yml are also WRITTEN by omp
# at runtime; omp re-reads under a lock and preserves external edits, so a
# symlink into the repo is safe (same arrangement as pi's settings.json).
# ompは~/.omp/agentを読む。実行時の状態が同居するため、
# ディレクトリごとではなく管理下の項目だけをリンクする。
link_omp_resources() {
    local src_dir="$1"
    local omp_home="${HOME}/.omp/agent"

    ensure_dir "$omp_home"

    local f
    for f in config.yml models.yml; do
        [[ -f "${src_dir}/${f}" ]] && link_file "${src_dir}/${f}" "${omp_home}/${f}"
    done

    local sub
    for sub in extensions agents prompts; do
        [[ -d "${src_dir}/${sub}" ]] || continue
        ensure_dir "${omp_home}/${sub}"
        while IFS= read -r -d '' resource; do
            link_file "$resource" "${omp_home}/${sub}/$(basename "$resource")"
        done < <(find "${src_dir}/${sub}" -mindepth 1 -maxdepth 1 \( -type f -o -type l \) -print0)
    done
}

# Link all files in a domain
link_domain() {
    assert_canonical_checkout || return 1

    local domain="$1"
    local domain_path="${DOTFILES_ROOT}/domains/${domain}"

    if [[ ! -d "$domain_path" ]]; then
        log_error "Domain not found: $domain"
        return 1
    fi
    
    log_info "Linking domain: $domain"
    
    # 1. Link Configs (~/.config)
    if [[ -d "${domain_path}/config" ]]; then
        for config_dir in "${domain_path}/config/"*; do
            if [[ -e "$config_dir" ]]; then
                local dirname=$(basename "$config_dir")
                # claude directory should be linked to ~/.claude instead of ~/.config/claude
                # claudeディレクトリは特別に~/.claudeにリンクする
                if [[ "$dirname" == "claude" ]]; then
                    local target="${HOME}/.claude"
                    link_file "$config_dir" "$target"
                # pi reads ~/.pi/agent — it has no XDG lookup, so ~/.config/pi
                # would be dead weight. That directory also holds runtime state
                # (auth.json, sessions/, git/, npm/), so link the children we
                # own rather than the directory.
                # piは~/.pi/agentを読む。実行時の状態も同居するため、
                # ディレクトリごとではなく管理下の項目だけをリンクする。
                elif [[ "$dirname" == "pi" ]]; then
                    link_pi_resources "$config_dir"
                # omp reads ~/.omp/agent — same runtime-state situation as pi.
                # ompも~/.omp/agentを読むため、管理下の項目だけをリンクする。
                elif [[ "$dirname" == "omp" ]]; then
                    link_omp_resources "$config_dir"
                # serena directory should be linked to ~/.serena instead of ~/.config/serena
                # serenaディレクトリは特別に~/.serenaにリンクする
                elif [[ "$dirname" == "serena" ]]; then
                    local target="${HOME}/.serena"
                    link_file "$config_dir" "$target"
                # warp directory should be linked to ~/.warp instead of ~/.config/warp
                # warpディレクトリは特別に~/.warpにリンクする
                elif [[ "$dirname" == "warp" ]]; then
                    local target="${HOME}/.warp"
                    link_file "$config_dir" "$target"
                # vscode directory - link settings.json to Application Support on macOS
                elif [[ "$dirname" == "vscode" ]]; then
                    local target="${HOME}/.config/${dirname}"
                    link_file "$config_dir" "$target"
                    
                    # On macOS, also link settings.json to Application Support
                    if [[ "$(uname)" == "Darwin" ]] && [[ -f "${config_dir}/settings.json" ]]; then
                        ensure_dir "${HOME}/Library/Application Support/Code/User"
                        link_file "${config_dir}/settings.json" "${HOME}/Library/Application Support/Code/User/settings.json"
                    fi
                # cursor directory - link to Application Support on macOS
                elif [[ "$dirname" == "cursor" ]]; then
                    local target="${HOME}/.config/${dirname}"
                    link_file "$config_dir" "$target"
                    
                    # On macOS, also link settings.json to Application Support
                    # Note: cursor/settings.json may be a symlink to vscode/settings.json
                    if [[ "$(uname)" == "Darwin" ]] && [[ -e "${config_dir}/settings.json" ]]; then
                        ensure_dir "${HOME}/Library/Application Support/Cursor/User"
                        link_file "${config_dir}/settings.json" "${HOME}/Library/Application Support/Cursor/User/settings.json"
                    fi
                else
                    local target="${HOME}/.config/${dirname}"
                    link_file "$config_dir" "$target"
                fi
            fi
        done
    fi
    
    # 2. Link Home Files (~)
    if [[ -d "${domain_path}/home" ]]; then
        # Use find to handle hidden files and avoid glob expansion issues
        # 隠しファイルを処理し、glob展開の問題を回避するためにfindを使用
        while IFS= read -r -d '' home_file; do
            local filename=$(basename "$home_file")
            local target="${HOME}/${filename}"
            link_file "$home_file" "$target"
        done < <(find "${domain_path}/home" -mindepth 1 -maxdepth 1 -type f -print0)
    fi
    
    # 3. Link Binaries (~/bin)
    if [[ -d "${domain_path}/bin" ]]; then
        ensure_dir "${HOME}/bin"
        # Use find to handle all files and avoid glob expansion issues
        # すべてのファイルを処理し、glob展開の問題を回避するためにfindを使用
        #
        # Symlinks count too (-type l): yoki-box dispatches on the name it was
        # invoked as, so yclaude/ycodex/... are symlinks to it and ARE the
        # interface. Installing only regular files would put yoki-box in ~/bin
        # and nothing that can call it.
        while IFS= read -r -d '' bin_file; do
            local filename=$(basename "$bin_file")
            local target="${HOME}/bin/${filename}"
            link_file "$bin_file" "$target"
        done < <(find "${domain_path}/bin" -mindepth 1 -maxdepth 1 \
                      \( -type f -o -type l \) -print0)
    fi
    
    # 4. Link Assets (Optional, e.g. to ~/.local/share or specific locations)
    # This is more complex and might need custom logic per domain, 
    # but for now we can define a standard if needed.
    # For now, we leave assets to be handled by install.sh or manual linking if special.
}

# Link all domains
link_all() {
    assert_canonical_checkout || return 1

    log_info "Linking all domains..."
    for domain_dir in "${DOTFILES_ROOT}/domains/"*; do
        if [[ -d "$domain_dir" ]]; then
            local domain=$(basename "$domain_dir")
            link_domain "$domain"
        fi
    done
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    case "${1:-}" in
        "template")
            process_all_templates
            ;;
        "link")
            if [[ -n "${2:-}" ]]; then
                link_domain "$2"
            else
                link_all
            fi
            ;;
        *)
            echo "Usage: $0 {template|link} [domain]"
            exit 1
            ;;
    esac
fi
