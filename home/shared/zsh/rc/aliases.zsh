# Zsh Specific Aliases

# Reload Zsh
alias rs='exec zsh'
alias vz='nvim ~/.zshrc'

# Git with Fuzzy Finder (skim-based interactive selection)
alias gbd='sk_select_local_branch_except_current | xargs -t git branch -D'
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

# jj with Fuzzy Finder (skim-based interactive selection)
alias jbd_sk='sk_select_jj_bookmark | xargs -t jj bookmark delete'
alias jbm_sk='sk_select_jj_bookmark | xargs -I {} -t jj bookmark move --to @ {}'

# Compatibility
if [[ "$(uname)" == "Darwin" ]]; then
  alias date='gdate'
fi
