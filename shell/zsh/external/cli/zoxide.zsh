# Configure zoxide exclusions
# 除外するディレクトリパターンを設定
export _ZO_EXCLUDE_DIRS="$HOME/.Trash:$HOME/Library:$HOME/.cache:$HOME/.aws:*/.git:*/node_modules:*/vendor:*/.claude:*/.devin:*/config/claude:*/.vscode:*/.idea:*/build:*/dist:*/target:*/.next:*/.nuxt:*/coverage:*/__pycache__:*/.pytest_cache:*/.mypy_cache:*/venv:*/.venv"

# Initialize zoxide
if command -v zoxide &>/dev/null; then
  if [ -z "$DISABLE_ZOXIDE" ] && [ -z "$CLAUDECODE" ]; then
    eval "$(zoxide init --cmd cd zsh)"
  fi
fi