#!/usr/bin/env bash
# Common aliases, sourced by zsh (home/shared/zsh/zshrc). Written so bash can
# source it too (the tests do); not POSIX sh: rm below uses arrays.

# Editors
alias vim='nvim'
alias vi='vim'

# File operations (eza)
alias ls="eza --icons"
alias la="eza -a --icons"
alias ll="eza -l --icons"
alias llt="eza --tree --level=2 -a"

# rm sends to the trash. rm's own options (-r -R -f -d -v -i -I, alone or
# run together, until --) are taken and dropped; with -f a path that does not
# exist is skipped silently, as rm does. The trash is macOS's /usr/bin/trash
# (Finder's Trash, so "Put Back" works) where it exists, else trash-cli's
# trash-put (Linux). A bare `trash` is not used: on macOS 15+ it resolves to
# Apple's, which refuses rm's options. Rm really deletes.
unalias rm 2>/dev/null
rm() {
	local trash=/usr/bin/trash arg force=0 opts=1
	local -a paths
	paths=()
	[ -x "$trash" ] || trash="trash-put"
	[ -n "${DOTFILES_TRASH:-}" ] && trash="$DOTFILES_TRASH" # tests
	for arg in "$@"; do
		if [ "$opts" = 1 ]; then
			case "$arg" in
			--) opts=0; continue ;;
			--force) force=1; continue ;;
			--recursive | --dir | --verbose | --interactive*) continue ;;
			-[rRfdviI]*)
				case "$arg" in *f*) force=1 ;; esac
				continue
				;;
			esac
		fi
		if [ "$force" = 1 ] && [ ! -e "$arg" ] && [ ! -L "$arg" ]; then
			continue
		fi
		paths+=("$arg")
	done
	if [ "${#paths[@]}" -eq 0 ]; then
		[ "$force" = 1 ] && return 0
		echo "rm: missing operand" >&2
		return 1
	fi
	"$trash" "${paths[@]}"
}
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
alias grma='git remote add'
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

# Utilities
alias curl_header='curl -D - -s -o /dev/null'

# Enhanced grep and cat
alias rg='rg --smart-case'
alias rgf='rg --files | rg'
alias cat='bat --style=plain --paging=never'
alias less='bat --style=plain'

# Mac

# Jujutsu (jj) — mirrors git aliases with j prefix
alias j='jj'
# Log
alias jl='jj log'
alias jll='jj log --template builtin_log_oneline'
alias jla='jj log -r "all()"'
# Status/Diff
alias js='jj status'
alias jd='jj diff'
alias jds='jj diff --stat'
alias jD='jj diff -r @-'
# Commit/New/Edit/Describe
alias jc='jj commit'
alias jci='jj commit --interactive'
alias jn='jj new'
alias je='jj edit'
alias jde='jj describe'
# Modify history
alias ja='jj abandon'
alias ju='jj undo'
alias jsq='jj squash'
alias jsi='jj squash --interactive'
alias jsp='jj split'
alias jr='jj rebase'
# Restore/Show (= git restore/show)
alias jrt='jj restore'
alias jsh='jj show'
# Bookmark (= git branch)
alias jb='jj bookmark list'
alias jbc='jj bookmark create'
alias jbd='jj bookmark delete'
alias jbm='jj bookmark move'
alias jbrn='jj bookmark rename'
# Git operations
alias jf='jj git fetch'
alias jp='jj git push'
alias jfr='jj git fetch && jj rebase -d "trunk()"'
# File operations
alias jbl='jj file annotate'
alias jfl='jj file list'
# Operation log (= git reflog)
alias jop='jj operation log'
# LazyJJ
alias lj='lazyjj'
