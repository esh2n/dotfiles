# Kiro CLI pre block. Keep at the top of this file.
[[ -f "${HOME}/Library/Application Support/kiro-cli/shell/zprofile.pre.zsh" ]] && builtin source "${HOME}/Library/Application Support/kiro-cli/shell/zprofile.pre.zsh"
# Added by OrbStack: command-line tools and integration
# This won't be added again if you remove it.
source ~/.orbstack/shell/init.zsh 2>/dev/null || :

# Kiro CLI post block. Keep at the bottom of this file.
[[ -f "${HOME}/Library/Application Support/kiro-cli/shell/zprofile.post.zsh" ]] && builtin source "${HOME}/Library/Application Support/kiro-cli/shell/zprofile.post.zsh"

# PATH additions live here, not in .zshrc: .zshrc is read by interactive
# shells only, so anything exported there is invisible to `zsh -c`, GUI apps
# and launchd jobs.
export PATH="$HOME/.local/bin:$PATH"   # Hermes Agent
export PATH="$HOME/.kimi-code/bin:$PATH"
