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

    # Replace {{HOME}} with actual home directory first
    local temp_file=$(mktemp)
    sed "s|{{HOME}}|${HOME}|g" "$template_file" > "$temp_file"

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

# Link all files in a domain
link_domain() {
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
                # serena directory should be linked to ~/.serena instead of ~/.config/serena
                # serenaディレクトリは特別に~/.serenaにリンクする
                elif [[ "$dirname" == "serena" ]]; then
                    local target="${HOME}/.serena"
                    link_file "$config_dir" "$target"
                # cursor directory - link settings.json to Application Support on macOS
                # cursorディレクトリ - macOSではsettings.jsonをApplication Supportにリンク
                elif [[ "$dirname" == "cursor" ]]; then
                    # Link cursor directory to ~/.config/cursor for other files
                    # 他のファイル用にcursorディレクトリを~/.config/cursorにリンク
                    local target="${HOME}/.config/${dirname}"
                    link_file "$config_dir" "$target"
                    
                    # On macOS, also link settings.json to Application Support
                    # macOSでは、settings.jsonもApplication Supportにリンク
                    if [[ "$(uname)" == "Darwin" ]] && [[ -f "${config_dir}/settings.json" ]]; then
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
        while IFS= read -r -d '' bin_file; do
            local filename=$(basename "$bin_file")
            local target="${HOME}/bin/${filename}"
            link_file "$bin_file" "$target"
        done < <(find "${domain_path}/bin" -mindepth 1 -maxdepth 1 -type f -print0)
    fi
    
    # 4. Link Assets (Optional, e.g. to ~/.local/share or specific locations)
    # This is more complex and might need custom logic per domain, 
    # but for now we can define a standard if needed.
    # For now, we leave assets to be handled by install.sh or manual linking if special.
}

# Link all domains
link_all() {
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
