# Key bindings
bindkey -v  # Vim mode
bindkey -M vicmd 'gg' beginning-of-line
bindkey -M vicmd 'G'  end-of-line

# Skim bindings
bindkey "^h" sk_select_history
bindkey "^]" sk_select_src
bindkey "^v" sk_select_file_within_project
bindkey "^b" sk_select_file_below_pwd
bindkey "^e" sk_change_directory

# History search
bindkey "^P" history-beginning-search-backward-end
bindkey "^N" history-beginning-search-forward-end

# Word movement
bindkey '^[[1;3C' forward-word
bindkey '^[[1;3D' backward-word

# Register widgets
zle -N history-beginning-search-backward-end history-search-end
zle -N history-beginning-search-forward-end history-search-end
zle -N zle-line-init
zle -N zle-keymap-select
zle -N sk_select_history
zle -N sk_select_src
zle -N sk_select_file_below_pwd
zle -N sk_select_file_within_project
zle -N sk_select_branch_except_current
zle -N sk_select_local_branch_except_current
zle -N sk_select_branch_all
zle -N sk_change_directory

# Completion options
setopt auto_list
setopt auto_menu
zstyle ':completion:*:default' menu select=1
export LS_COLORS='di=34:ln=35:so=32:pi=33:ex=31:bd=46;34:cd=43;34:su=41;30:sg=46;30:tw=42;30:ow=43;30'
zstyle ':completion:*:default' list-colors ${(s.:.)LS_COLORS}

# History options
HISTFILE=~/.zsh_history
HISTSIZE=10000
SAVEHIST=10000
setopt append_history
setopt extended_history
setopt hist_expire_dups_first
setopt hist_ignore_dups
setopt hist_ignore_space
setopt hist_verify
setopt inc_append_history
setopt share_history

# Directory options
setopt auto_cd
setopt auto_pushd
setopt pushd_ignore_dups
setopt pushdminus

# Job options
setopt long_list_jobs
setopt notify

# Globbing options
setopt extended_glob
setopt glob_dots

# Input/Output options
setopt correct
setopt interactive_comments
setopt no_flow_control

# Prompt options
setopt prompt_subst

# Performance measurement
TIMEFMT=$'\n\n========================\nProgram : %J\nCPU     : %P\nuser    : %*Us\nsystem  : %*Ss\ntotal   : %*Es\n========================\n'

# External tools integration
if [ -f '/Users/esh2n/google-cloud-sdk/path.zsh.inc' ]; then 
    source '/Users/esh2n/google-cloud-sdk/path.zsh.inc'
fi
if [ -f '/Users/esh2n/google-cloud-sdk/completion.zsh.inc' ]; then 
    source '/Users/esh2n/google-cloud-sdk/completion.zsh.inc'
fi

# Additional paths
export PACIFICA_PATH="/Users/esh2n/go"
export PATH="/Users/esh2n/.rd/bin:$PATH" 

# .NET SDK Path
export DOTNET_ROOT="$HOME/.local/share/mise/installs/dotnet/9.0.100-preview.2.24157.14"
export PATH="$DOTNET_ROOT:$PATH" 