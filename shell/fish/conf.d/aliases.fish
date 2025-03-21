# Git aliases
alias g='git'
alias ga='git add'
alias gaa='git add --all'
alias gc='git commit -v'
alias gco='git checkout'
alias gd='git diff'
alias gst='git status'
alias gp='git push'
alias gl='git pull'
alias gf='git fetch'

# Directory navigation
alias ..='cd ..'
alias ...='cd ../..'
alias ....='cd ../../..'

# Docker aliases
alias d='docker'
alias dc='docker compose'
alias dps='docker ps'
alias di='docker images'

# Kubernetes aliases
alias k='kubectl'
alias kns='kubectl config set-context --current --namespace'
alias kctx='kubectl config use-context'

# Development
alias vim='nvim'
alias v='nvim'
alias c='code'
alias cur='cursor'

# Utility
alias reload='source ~/.config/fish/config.fish'
alias path='echo $PATH | tr " " "\n"'
alias ports='netstat -tulanp'
alias weather='curl wttr.in'
alias rm='trash'          # Safer file deletion
alias Rm='rm -rf'         # Force removal (original rm command)

# ghq + fzf integration
function ghq_fzf_repo
    ghq list | fzf --preview "bat --color=always --style=header,grid --line-range :80 (ghq root)/{}/README.*" | read -l repo_path
    and cd (ghq root)/$repo_path
end
bind \cg 'ghq_fzf_repo' 