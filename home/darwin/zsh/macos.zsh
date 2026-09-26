# macOS-only shell bits that belong to no one app (home/darwin/zsh).
alias disp='open "x-apple.systempreferences:com.apple.Displays-Settings.extension"'
# a shell under Rosetta, and back
alias x64='exec arch -x86_64 "$SHELL"'
alias a64='exec arch -arm64e "$SHELL"'
alias intel="arch -x86_64"
# GNU date's options, as on Linux (coreutils from Nix)
alias date='gdate'
