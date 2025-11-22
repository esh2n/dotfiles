# Zsh Specific Aliases

# Reload Zsh
alias rs='exec zsh'
alias vz='nvim ~/.zshrc'

# Git with Fuzzy Finder
alias gch='sk_select_branch_except_current | xargs -t git checkout'
alias gbd='sk_select_local_branch_except_current | xargs -t git branch -D'
alias gpuso='sk_select_branch_all | xargs -t git push origin'
alias gPuso='sk_select_branch_all | xargs -t git push -f origin'
alias gpulo='sk_select_branch_all | xargs -t git pull origin'
alias gme='sk_select_branch_except_current  | xargs -t git merge --no-ff --edit'
alias gmesq='sk_select_branch_except_current  | xargs -t git merge --squash'
alias gpr='sk_select_branch_except_current | xargs -t gh pr create -w -B'

# Git Log
alias glo="sk_select_branch_all | xargs -t -I {} git log {}.. --graph --abbrev-commit --decorate --date=relative --format=format:'%C(red)%h%C(r) —— %C(bold blue)%an%C(r): %C(white)%s%C(r) %C(dim white) %C(bold green)(%ar)%C(r) %C(bold yellow)%d%C(r)'"
alias gtr="git log --graph --abbrev-commit --decorate --date=relative --format=format:'%C(red)%h%C(r) —— %C(bold blue)%an%C(r): %C(white)%s%C(r) %C(dim white) %C(bold green)(%ar)%C(r) %C(bold yellow)%d%C(r)' --all"

# Navigation
alias ghl='cd $(ghq root)/$(find $(ghq root)/*/*/* -type d -prune | sed -e "s#"$(ghq root)"/##" | sk)'
alias vv='sk_edit_file'

# Utilities
alias zen='toggle_zen_mode'
alias x64='exec arch -x86_64 "$SHELL"'
alias a64='exec arch -arm64e "$SHELL"'

# Compatibility
if [[ "$(uname)" == "Darwin" ]]; then
  alias date='gdate'
fi
