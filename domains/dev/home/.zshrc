
# Kiro CLI pre block. Keep at the top of this file.
[[ -f "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.pre.zsh" ]] && builtin source "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.pre.zsh"

# .zshrc - Dotfiles Entry Point

# 1. Define Dotfiles Root / ドットファイルルートの定義
# Resolve symlink to find dotfiles root / シンボリックリンクからルートパスを解決
if [[ -z "$DOTFILES_ROOT" ]]; then
    if [[ -L "${HOME}/.zshrc" ]]; then
        # :A resolves the symlink in-shell (no readlink/dirname forks)
        # .zshrc is in domains/dev/home/.zshrc -> root is ../../../
        DOTFILES_ROOT="${${:-${HOME}/.zshrc}:A:h:h:h:h}"
    else
        # Fallback: resolve via ghq root + git remote
        local ghq_root="${GHQ_ROOT:-${HOME}/go}"
        local gh_user="${GITHUB_USER:-$(git config github.user 2>/dev/null || echo "")}"
        if [[ -n "$gh_user" ]]; then
            DOTFILES_ROOT="${ghq_root}/github.com/${gh_user}/dotfiles"
        else
            DOTFILES_ROOT="${HOME}/dotfiles"
        fi
    fi
fi

export DOTFILES_ROOT

# 2. Source Core Loader / コアローダーの読み込み
if [[ -f "${DOTFILES_ROOT}/core/install/loader.sh" ]]; then
    source "${DOTFILES_ROOT}/core/install/loader.sh"
else
    echo "Error: loader.sh not found at ${DOTFILES_ROOT}/core/install/loader.sh"
    return 1
fi

# 3. Load Domain Configurations / ドメイン設定の読み込み
# (mise activation lives in integrations.zsh; the old lazy wrappers here
#  were overwritten by it before ever being used, so they were dropped)
load_domain_shell_configs "$DOTFILES_ROOT" "zsh"

# 4. Local Config Overrides / ローカル設定の上書き
[[ -f ~/.zshrc.local ]] && source ~/.zshrc.local

# 5. Amazon Q / Other Integrations


# claude-mem: resolve latest installed version dynamically
claude-mem() {
    local base="$HOME/.claude/plugins/cache/thedotmack/claude-mem"
    local latest
    latest=$(ls -v "$base" 2>/dev/null | tail -1)
    if [[ -n "$latest" && -f "$base/$latest/scripts/worker-service.cjs" ]]; then
        bun "$base/$latest/scripts/worker-service.cjs" "$@"
    else
        echo "claude-mem not found. Install via claude plugin." >&2
        return 1
    fi
}
# alias claude-mem= — managed by function above; do not remove this comment

. "$HOME/.local/share/../bin/env"


# Kiro CLI post block. Keep at the bottom of this file.
[[ -f "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.post.zsh" ]] && builtin source "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.post.zsh"
