# Key bindings
bindkey -e  # Emacs mode (デフォルト)

# WSL環境ではCtrl+]が機能しない場合があるため、functions.zshで
# 環境に応じたキーバインディングを設定します

# History search
bindkey "^P" history-beginning-search-backward-end
bindkey "^N" history-beginning-search-forward-end

# Word movement
bindkey '^[[1;3C' forward-word
bindkey '^[[1;3D' backward-word

# Register widgets
zle -N history-beginning-search-backward-end history-search-end
zle -N history-beginning-search-forward-end history-search-end
zle -N sk_select_history
zle -N sk_select_src
zle -N sk_select_file_below_pwd
zle -N sk_select_file_within_project
zle -N sk_select_branch_except_current
zle -N sk_select_local_branch_except_current
zle -N sk_select_branch_all

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
if [ -f "$HOME/google-cloud-sdk/path.zsh.inc" ]; then 
    source "$HOME/google-cloud-sdk/path.zsh.inc"
fi
if [ -f "$HOME/google-cloud-sdk/completion.zsh.inc" ]; then 
    source "$HOME/google-cloud-sdk/completion.zsh.inc"
fi

# Additional paths
# OS検出とWSL環境に応じてPACIFICA_PATHを設定
if [ "$IS_WSL" = "1" ]; then
  # WSL環境ではホームディレクトリ直下のgoディレクトリを使用
  export PACIFICA_PATH="$HOME/go"
elif [ "$OSTYPE" = "Darwin" ]; then
  # macOS環境ではオリジナルのパスを使用
  export PACIFICA_PATH="$HOME/go"
else
  # 通常のLinux環境でもホームディレクトリ直下を使用
  export PACIFICA_PATH="$HOME/go"
fi

# パスの存在確認と警告
if [ ! -d "$PACIFICA_PATH" ]; then
  echo "警告: PACIFICA_PATH ($PACIFICA_PATH) が存在しません"
  echo "goディレクトリを作成するか、パスを修正してください"
  # 存在しない場合は一時的に$HOMEを設定
  export PACIFICA_PATH="$HOME"
fi

# RD (RundownInc) のバイナリパスをOSに応じて設定
if [ "$OSTYPE" = "Darwin" ]; then
  # macOS固有の設定
  export PATH="$HOME/.rd/bin:$PATH"
fi

# # .NET SDK Path
# if [ -d "$HOME/.local/share/mise/installs/dotnet/8.0.408" ]; then
#   export DOTNET_ROOT="$HOME/.local/share/mise/installs/dotnet/8.0.408"
#   export PATH="$DOTNET_ROOT:$PATH"
# fi
export PATH="/usr/local/share/dotnet/x64:$PATH"

# Rider Path
export PATH="/Applications/Rider.app/Contents/MacOS:$PATH"
