# Kiro CLI pre block. Keep at the top of this file.
[[ -f "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.pre.zsh" ]] && builtin source "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.pre.zsh"
# .zshrc - Dotfiles Entry Point

# 1. Define Dotfiles Root / ドットファイルルートの定義
# Resolve symlink to find dotfiles root / シンボリックリンクからルートパスを解決
if [[ -z "$DOTFILES_ROOT" ]]; then
    if [[ -L "${HOME}/.zshrc" ]]; then
        local link_target=$(readlink "${HOME}/.zshrc")
        if [[ "$link_target" != /* ]]; then
            link_target="${HOME}/${link_target}"
        fi
        # .zshrc is in domains/dev/home/.zshrc -> root is ../../../
        DOTFILES_ROOT=$(dirname $(dirname $(dirname $(dirname "$link_target"))))
    else
        DOTFILES_ROOT="${HOME}/go/github.com/esh2n/dotfiles/dotfiles"
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

# 3. Initialize Lazy Loading / 遅延読み込みの初期化
setup_lazy_mise

# 4. Load Domain Configurations / ドメイン設定の読み込み
load_domain_shell_configs "$DOTFILES_ROOT" "zsh"

# 5. Local Config Overrides / ローカル設定の上書き
[[ -f ~/.zshrc.local ]] && source ~/.zshrc.local

# 6. Amazon Q / Other Integrations

# Kiro CLI post block. Keep at the bottom of this file.
[[ -f "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.post.zsh" ]] && builtin source "${HOME}/Library/Application Support/kiro-cli/shell/zshrc.post.zsh"
