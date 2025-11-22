# Zsh Functions

# -----------------------------------------------------------------------------
# Terminal Detection
# -----------------------------------------------------------------------------
function is_warp() {
  [[ -n "$WARP_SESSION_ID" ]] || [[ "$TERM_PROGRAM" = "WarpTerminal" ]]
}

function is_vscode() {
  [[ "$TERM_PROGRAM" = "vscode" ]]
}

# Directory Management
# -----------------------------------------------------------------------------
function mkcd() {
  if [ $# -eq 0 ]; then
    log_error "Usage: mkcd <directory>"
    return 1
  fi

  if [ -d "$1" ]; then
    cd "$1"
  else
    ensure_dir "$1" && cd "$1"
  fi
}

# -----------------------------------------------------------------------------
# Fuzzy Finder (Skim) Widgets
# -----------------------------------------------------------------------------

# Select history
function sk_select_history() {
  BUFFER=$(history -n -r 1 | sk --ansi --reverse --height '50%' --query "$LBUFFER")
  CURSOR=$#BUFFER
  zle clear-screen
}

# Select GHQ project
function sk_select_src() {
  if ! has_command ghq; then 
    log_error "ghq is not installed"
    return 1
  fi
  
  local selected_dir=$(ghq list -p | sk --ansi --reverse --height '50%' --query "$LBUFFER")
  
  if [ -n "$selected_dir" ]; then
    BUFFER="cd ${(q)selected_dir}"
    zle accept-line
  else
    zle reset-prompt
  fi
}

# Change directory with zoxide
function sk_change_directory() {
  if ! has_command zoxide; then 
    log_error "zoxide is not installed"
    return 1
  fi
  
  local selected_dir=$(zoxide query -l | sk --ansi --reverse --height '50%')
  
  if [ -n "$selected_dir" ]; then
    BUFFER="cd ${(q)selected_dir}"
    zle accept-line
  else
    zle reset-prompt
  fi
}

# Select file within project
function sk_select_file_within_project() {
  local base_path=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -z "$base_path" ]; then
    log_warn "Not in a git repository"
    zle reset-prompt
    return
  fi
  
  local selected_path=$(fd --type f --hidden --exclude .git . "$base_path" | sk --ansi --reverse --height '50%' --preview 'bat --style=numbers --color=always {}')
  
  if [ -n "$selected_path" ]; then
    BUFFER="nvim ${(q)selected_path}"
    zle accept-line
  else
    zle reset-prompt
  fi
}

# Select file below current directory
function sk_select_file_below_pwd() {
  local selected_path=$(fd --type f --hidden --exclude .git | sk --ansi --reverse --height '50%' --preview 'bat --style=numbers --color=always {}')
  
  if [ -n "$selected_path" ]; then
    BUFFER="nvim ${(q)selected_path}"
    zle accept-line
  else
    zle reset-prompt
  fi
}

# Edit file (helper for alias)
function sk_edit_file() {
  local selected_path=$(fd --type f --hidden --exclude .git | sk --ansi --reverse --height '50%' --preview 'bat --style=numbers --color=always {}')
  if [ -n "$selected_path" ]; then
    nvim "$selected_path"
  fi
}

# -----------------------------------------------------------------------------
# Git Helpers
# -----------------------------------------------------------------------------
function sk_select_branch_except_current() {
  git branch | grep -v "^\*" | sk --ansi --reverse --height '50%' | xargs
}

function sk_select_local_branch_except_current() {
  git branch | grep -v "^\*" | sk --ansi --reverse --height '50%' | xargs
}

function sk_select_branch_all() {
  git branch -a | grep -v "^\*" | sed 's/remotes\/origin\///' | sort -u | sk --ansi --reverse --height '50%' | xargs
}

# -----------------------------------------------------------------------------
# Utilities
# -----------------------------------------------------------------------------

# Toggle Zen Mode (Hide UI elements)
function toggle_zen_mode() {
  if pgrep -x "sketchybar" >/dev/null; then
    run_with_spinner "Stopping Sketchybar" brew services stop sketchybar
    run_with_spinner "Stopping Borders" brew services stop borders
    log_info "🧘 Zen Mode: ON"
  else
    run_with_spinner "Starting Sketchybar" brew services start sketchybar
    run_with_spinner "Starting Borders" brew services start borders
    log_info "🖥️ Zen Mode: OFF"
  fi
}

# GCloud Switcher
function gx() {
  local config=$(gcloud config configurations list | sk --ansi --reverse --height '50%' | awk '{print $1}')
  if [ -n "$config" ]; then
    gcloud config configurations activate "$config"
  fi
}

# Reload Zsh Configuration
function sz() {
  log_info "Reloading Zsh configuration..."
  exec zsh
}

# Navigate to file or directory (used by sk functions)
function go_to() {
  if [ -f "$1" ]; then
    nvim "$1"
    dir_path=$(dirname "$1")
    BUFFER="cd \"$dir_path\""
  elif [ -d "$1" ]; then
    BUFFER="cd \"$1\""
  else
    log_warn "Path is neither file nor directory: $1"
  fi
  zle accept-line
}

# Search in files with ripgrep and skim
function search_in_files() {
  local query="$1"
  if [ -z "$query" ]; then
    log_error "Usage: search_in_files <query>"
    return 1
  fi
  rg --color=always --line-number --no-heading --smart-case "$query" | \
    sk --ansi --reverse --height '50%' --preview 'echo {}' \
    --preview-window 'up,60%,border-bottom,+{2}+3/3,~3'
}

# Cleanup zoxide database
function zoxide_cleanup() {
  if ! has_command zoxide; then
    log_error "zoxide is not installed"
    return 1
  fi
  
  log_info "Cleaning up zoxide database..."
  zoxide query -l | while read -r path; do
    if [[ ! -d "$path" ]]; then
      log_warn "Removing non-existent path: $path"
      # zoxide doesn't have a direct remove command, but we can use query --remove
      zoxide remove "$path" 2>/dev/null
    fi
  done
  log_success "Zoxide cleanup complete"
}
