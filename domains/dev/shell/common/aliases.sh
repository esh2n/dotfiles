#!/bin/sh
# Common Aliases (POSIX compliant)
# Sourced by both Zsh and Fish

# Editors
alias vim='nvim'
alias vi='vim'

# File operations (eza)
alias ls="eza --icons"
alias la="eza -a --icons"
alias ll="eza -l --icons"
alias llt="eza --tree --level=2 -a"

# rm replacement (trash)
alias Rm='trash -rf'

# Git
alias g='git'
alias gi='git init'
alias gcl='git clone'
alias ga='git add'
alias gA='git add --all'
alias gc='git commit'
alias gpul='git pull'
alias gpus='git push'

# Git branch operations
alias gb='git branch'
alias gsw='git switch'
alias gchb='git checkout -b'
alias gmeabo='git merge --abort'

# Git status and log
alias gg='git grep'
alias gs='git status -sb'

# Git remote
alias grao='git remote add origin'
alias gra='git remote add'
alias grro='git remote remove origin'
alias grr='git remote remove'

# Git rebase
alias greb='git rebase'
alias greb1='git rebase -i HEAD~1'
alias greb2='git rebase -i HEAD~2'
alias greb3='git rebase -i HEAD~3'
alias greb4='git rebase -i HEAD~4'
alias greb5='git rebase -i HEAD~5'

# Git reset
alias grese='git reset'
alias gres1='git reset --hard HEAD~1'
alias gres2='git reset --hard HEAD~2'
alias gres3='git reset --hard HEAD~3'
alias gres4='git reset --hard HEAD~4'
alias gres5='git reset --hard HEAD~5'
alias gcf='git commit --amend'
alias gcn='git rebase --continue'

# Git misc
alias grest='git restore'
alias gst='git stash'
alias grn='git branch -m'

# LazyGit
alias lg='lazygit'

# Zoxide (replacing cd)
alias zclean='zoxide_cleanup'

# Docker
alias d='docker'
alias dc='docker-compose'
alias dco='docker compose'
alias dps='docker ps'

# Kubernetes
alias k='kubectl'
alias kx='kubectx'
alias kn='kubens'
alias kube='kubectl'

# Terraform
alias tf='terraform'

# Mise
alias m='mise'

# Development
alias art='php artisan'
alias artm='php artisan make'
alias pg='pg_ctl'

# Rust
alias cg='cargo'
alias cgr='cargo run'

# Deno
alias dpc='deployctl'
alias de='deno'

# GCP
alias gcp='gcloud'

# Architecture
alias intel="arch -x86_64"

# Utilities
alias curl_header='curl -D - -s -o /dev/null'

# Enhanced grep and cat
alias rg='rg --smart-case'
alias rgf='rg --files | rg'
alias cat='bat --style=plain --paging=never'
alias less='bat --style=plain'

# Mac
alias disp='open "x-apple.systempreferences:com.apple.Displays-Settings.extension"'
