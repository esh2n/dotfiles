# Zinit annexes
zinit light-mode for \
    zdharma-continuum/zinit-annex-as-monitor \
    zdharma-continuum/zinit-annex-bin-gem-node \
    zdharma-continuum/zinit-annex-patch-dl \
    zdharma-continuum/zinit-annex-rust

# Alias tips
zinit light 'djui/alias-tips'
export ZSH_PLUGINS_ALIAS_TIPS_TEXT='🗒 : '

# Git related
zinit light 'mollifier/cd-gitroot'
zinit light 'sei40kr/zsh-tmux-rename'

# Environment
zinit snippet 'OMZ::plugins/dotenv/dotenv.plugin.zsh'

# Oh-My-Zsh snippets
zinit snippet 'OMZ::lib/completion.zsh'
zinit snippet 'OMZ::lib/compfix.zsh'
zinit snippet 'OMZ::plugins/git/git.plugin.zsh'
zinit snippet 'OMZ::plugins/github/github.plugin.zsh'
zinit snippet 'OMZ::plugins/gnu-utils/gnu-utils.plugin.zsh'

# Completions
zinit ice pick''
zinit light 'jsforce/jsforce-zsh-completions'
zinit light 'zsh-users/zsh-completions'

# Syntax highlighting and suggestions
zinit wait lucid for \
    atinit"ZINIT[COMPINIT_OPTS]=-C; zicompinit; zicdreplay" \
        zdharma-continuum/fast-syntax-highlighting \
    blockf \
    zsh-users/zsh-completions \
    atload"!_zsh_autosuggest_start" \
        zsh-users/zsh-autosuggestions

# Additional completion settings
fpath=(~/.zsh/completion $fpath)
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Z}'
zinit cdreplay -q 