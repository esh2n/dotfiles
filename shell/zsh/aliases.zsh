# Shell
alias rs='exec $SHELL -l && source ~/.zshrc'
alias sz='source ~/.zshenv && source ~/.zshrc && echo "🔄 Reloaded shell configurations"'
alias tc='tmux source ~/.tmux.conf'

# Editors
alias vim='nvim'
alias vi='vim'
alias vz='vim ~/.zshrc'
alias vn='vim ~/.config/nvim/init.vim'

# File operations
alias ls="eza --icons"
alias la="eza -a --icons"
alias ll="eza -l --icons"
alias llt="eza --tree --level=2 -a"

# rmコマンドをtrash関数で置き換え
if type trash-put > /dev/null 2>&1 || type trash > /dev/null 2>&1; then
  # aliasではなく関数として実装してフラグを正しく渡す
  function rm() {
    trash "$@"
  }
else
  echo "⚠️ trash-putまたはtrash関数が見つかりません。rmは標準の削除コマンドのままです。"
  echo "💡 trash-cliをインストールするには: sudo apt install trash-cli"
fi

# 完全に削除するためのコマンド（安全対策あり）
function Rm() {
  local protected_dirs=("$HOME" "/" "/home" "/usr" "/etc" "/var" "/bin" "/sbin" "/lib" "/lib64" "/boot" "/dev" "/proc" "/sys" "/tmp" "/opt" "/root")
  
  for arg in "$@"; do
    # 絶対パスに変換
    local abs_path
    if [[ "$arg" = /* ]]; then
      abs_path="$arg"
    else
      abs_path="$(pwd)/$arg"
    fi
    
    # パスの正規化（シンボリックリンクを解決し、重複するスラッシュを削除）
    abs_path=$(readlink -f "$abs_path" 2>/dev/null || echo "$abs_path")
    
    # 保護対象のディレクトリかチェック
    for protected in "${protected_dirs[@]}"; do
      if [[ "$abs_path" == "$protected" || "$abs_path" == "${protected}/" ]]; then
        echo "🛑 危険: '$arg' は重要なシステムディレクトリです。削除できません。"
        return 1
      fi
    done
    
    # ホームディレクトリのサブディレクトリでも、直接のサブディレクトリは保護
    if [[ "$abs_path" == "$HOME"/* ]]; then
      local rel_to_home=${abs_path#$HOME/}
      if [[ ! "$rel_to_home" =~ / ]]; then
        echo "⚠️ 注意: '$arg' はホームディレクトリの直下のディレクトリです。"
        echo "本当に削除しますか？ [y/N]: "
        read -r response
        if [[ ! "$response" =~ ^[Yy]$ ]]; then
          echo "❌ 削除をキャンセルしました"
          return 1
        fi
      fi
    fi
  done
  
  # 全てのチェックに通ったら削除実行
  \rm -rf "$@"
}

alias mkcd='mkdir_and_change_directory'

# Git
alias g='git'
alias gro='cd-gitroot'
alias gi='git init'
alias gcl='git clone'
alias ga='git add'
alias gA='git add --all'
alias gc='git commit'
alias gpul='git pull'
alias gpus='git push'
alias ac='aicommits'

# Git branch operations
alias gb='git branch'
alias gsw='git switch'
alias gchb='git checkout -b'
alias gch='sk_select_branch_except_current | xargs -t git checkout'
alias gbd='sk_select_local_branch_except_current | xargs -t git branch -D'
alias gpuso='sk_select_branch_all | xargs -t git push origin'
alias gPuso='sk_select_branch_all | xargs -t git push -f origin'
alias gpulo='sk_select_branch_all | xargs -t git pull origin'
alias gme='sk_select_branch_except_current  | xargs -t git merge --no-ff --edit'
alias gmesq='sk_select_branch_except_current  | xargs -t git merge --squash'
alias gmeabo='git merge --abort'
alias gpr='sk_select_branch_except_current | xargs -t gh pr create -w -B'

# Git status and log
alias gg='git grep'
alias glo="sk_select_branch_all | xargs -t -I {} git log {}.. --graph --abbrev-commit --decorate --date=relative --format=format:'%C(red)%h%C(r) —— %C(bold blue)%an%C(r): %C(white)%s%C(r) %C(dim white) %C(bold green)(%ar)%C(r) %C(bold yellow)%d%C(r)'"
alias gtr="git log --graph --abbrev-commit --decorate --date=relative --format=format:'%C(red)%h%C(r) —— %C(bold blue)%an%C(r): %C(white)%s%C(r) %C(dim white) %C(bold green)(%ar)%C(r) %C(bold yellow)%d%C(r)' --all"
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
alias grmi='rm -rf .git/index.lock .git/COMMIT_EDITMSG'

# Skim & Ghq
alias fast_ghl='find $(ghq root)/*/*/* -type d -prune | sed -e "s#"$(ghq root)"/##"'
alias vv='sk_edit_file'
alias c='sk_change_directory'
alias b='sk_select_file_below_pwd'
alias ghl='cd $(ghq root)/$(fast_ghl | sk)'
alias memo='vim $(ghq root)/github.com/esh2n/playground/notes/$(date "+%Y_%m_%d").md'

# Fasd
alias a='fasd -a'
alias s='fasd -si'
alias v='f -e nvim'
alias f='fasd -f'
alias sd='fasd -sid'
alias sf='fasd -sif'
alias z='fasd_cd -d'
alias zz='fasd_cd -d -i'

# Docker
alias d='docker'
alias dco='docker compose'
alias dps='docker ps'

# Kubernetes
alias kube='kubectl'

# Development
alias art='php artisan'
alias artm='php artisan make'
alias flcre='flutter create --org ninja.shunya --with-with-driver-test'
alias mi='marks init -d'
alias pg='pg_ctl'
alias pgsta='pg_ctl -D /usr/local/var/postgres start'
alias pgsto='pg_ctl -D /usr/local/var/postgres stop'

# Rust
alias cg='cargo'
alias cgr='cargo run'

# Deno
alias dpc='deployctl'
alias de='deno'

# GCP
alias gsu='gsutil'
alias gcp='gcloud'

# Architecture
alias x64='exec arch -x86_64 "$SHELL"'
alias a64='exec arch -arm64e "$SHELL"'
alias intel="arch -x86_64"

# Directory shortcuts
alias cdg="cd $GROOT"
alias cda="cd $AROOT"
alias cdd="cd $DOTFILES_PATH"

# Utilities
alias curl_header='curl -D - -s -o /dev/null'
alias date='gdate'
alias zeinit='zellij --layout ~/.config/zellij/layout_file.yaml'

# Enhanced grep and cat
alias rg='rg --smart-case'
alias rgf='rg --files | rg'
alias cat='bat --style=plain --paging=never'
alias less='bat --style=plain'

# Editor
alias code='cursor'