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
alias rm='trash'
alias Rm='command rm -rf'

# Git
# Pattern: lowercase=normal, UPPERCASE=powerful/force/all
alias g='git'
alias gi='git init'
alias gcl='git clone'

# Add
alias ga='git add'
alias gA='git add --all'

# Commit
alias gc='git commit'
alias gC='git commit --amend'
alias gcm='git commit -m'
alias gCm='git commit --amend -m'

# Pull/Fetch
alias gpl='git pull'
alias gf='git fetch'

# Branch operations
alias gb='git branch'
alias gswc='git switch -c'
alias gchb='git checkout -b'
alias grn='git branch -m'

# Merge
alias gm='git merge'
alias gM='git merge --no-ff'
alias gma='git merge --abort'

# Diff
alias gd='git diff'
alias gD='git diff --cached'
alias gds='git diff --stat'

# Status/Grep/Log
alias gs='git status -sb'
alias gg='git grep'

# Rebase
alias gr='git rebase'
alias gR='git rebase -i'
alias grc='git rebase --continue'
alias gra='git rebase --abort'

# Reset
alias grs='git reset'
alias grs1='git reset --hard HEAD~1'
alias grs2='git reset --hard HEAD~2'
alias grs3='git reset --hard HEAD~3'

# Restore
alias grt='git restore'
alias gRt='git restore --staged'

# Stash
alias gst='git stash'
alias gSt='git stash pop'
alias gsta='git stash apply'
alias gstl='git stash list'
alias gstd='git stash drop'

# Remote
alias grao='git remote add origin'
alias gra='git remote add'
alias grro='git remote remove origin'
alias grr='git remote remove'

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
