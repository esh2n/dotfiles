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
# Fuzzy Finder (Skim) Internal Helpers
# -----------------------------------------------------------------------------

# Internal helper: Select project using pacifica or ghq
# Returns: Selected project path or empty string
function _sk_select_project_internal() {
  local prompt="${1:-Project> }"
  local folder_icon=$'\uf07c '
  local selected_item=""
  local selected_dir=""

  if has_command pacifica; then
    local pacifica_output
    pacifica_output=$(pacifica 2>/dev/null | grep "/github\.com/" || true)
    if [[ -n "$pacifica_output" ]]; then
      # Create temporary file with org/repo format for sk to search
      local tmpfile=$(mktemp)
      printf '%s\n' "$pacifica_output" | sed "s#.*/github\.com/##" > "$tmpfile"

      # Let sk search only in org/repo format
      selected_item=$(cat "$tmpfile" | \
        sed "s#^#$folder_icon#" | \
        sk --ansi --reverse --height '100%' --prompt "$prompt" --query "$LBUFFER")

      if [[ -n "$selected_item" ]]; then
        # Extract org/repo from selection and find corresponding full path
        local org_repo=${selected_item#"$folder_icon"}
        selected_dir=$(printf '%s\n' "$pacifica_output" | grep "/github\.com/${org_repo}$" | head -1)
      fi

      rm -f "$tmpfile"
    fi
  else
    # For ghq, use relative paths
    local ghq_root=$(ghq root 2>/dev/null)
    if [[ -n "$ghq_root" ]]; then
      # ghq list already returns relative paths like "github.com/org/repo"
      selected_item=$(ghq list | \
        grep "github\.com/" | \
        sed "s#^#$folder_icon#" | \
        sk --ansi --reverse --height '60%' --prompt "$prompt" --query "$LBUFFER")

      if [[ -n "$selected_item" ]]; then
        local relative_path=${selected_item#"$folder_icon"}
        selected_dir="${ghq_root}/${relative_path}"
      fi
    else
      # Fallback to original behavior if ghq root is not available
      selected_dir=$(ghq list -p | sk --ansi --reverse --height '60%' --prompt "$prompt" --query "$LBUFFER")
    fi
  fi

  echo "$selected_dir"
}

# Internal helper: Select file from a path with relative display
# Args: $1 = base path, $2 = prompt
# Returns: Selected file path (full path) or empty string
function _sk_select_file_internal() {
  local base_path="$1"
  local prompt="${2:-File> }"

  if has_command fd; then
    # Change to base path and use relative paths directly
    (
      cd "$base_path" || return 1
      selected_relative=$(fd --type f --hidden --exclude .git . | \
        sk --ansi --reverse --height '60%' --prompt "$prompt" \
        --preview "bat --style=numbers --color=always {}")

      if [[ -n "$selected_relative" ]]; then
        echo "${base_path}/${selected_relative}"
      fi
    )
  else
    # Fallback for systems without fd
    (
      cd "$base_path" || return 1
      selected_relative=$(find . -type f 2>/dev/null | sed 's#^\./##' | \
        sk --ansi --reverse --height '60%' --prompt "$prompt")

      if [[ -n "$selected_relative" ]]; then
        echo "${base_path}/${selected_relative}"
      fi
    )
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

# Select GHQ project (Ctrl+])
function sk_select_src() {
  if ! has_command ghq; then
    log_error "ghq is not installed"
    return 1
  fi

  local selected_dir=$(_sk_select_project_internal)

  if [ -n "$selected_dir" ]; then
    BUFFER="cd ${(q)selected_dir}"
    zle accept-line
  else
    zle reset-prompt
  fi
}

# Select project and then file within it (Ctrl+O)
function sk_select_project_file() {
  if ! has_command ghq; then
    log_error "ghq is not installed"
    return 1
  fi

  local selected_project=$(_sk_select_project_internal "Project> ")

  if [[ -z "$selected_project" ]]; then
    zle reset-prompt
    return 0
  fi

  local selected_path=$(_sk_select_file_internal "$selected_project" "File> ")

  if [[ -n "$selected_path" ]]; then
    BUFFER="nvim ${(q)selected_path}"
    zle accept-line
  else
    BUFFER="cd ${(q)selected_project}"
    zle accept-line
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

# -----------------------------------------------------------------------------
# Multiplexer Management (mx)
# -----------------------------------------------------------------------------

# Detect current multiplexer
function _mx_detect_current() {
  if [[ -n "$ZELLIJ_SESSION_NAME" ]]; then
    echo "zellij"
  elif [[ -n "$TMUX" ]]; then
    echo "tmux"
  else
    echo ""
  fi
}

# Detect available multiplexer (preference: current > active sessions > installed)
function _mx_detect_available() {
  local current=$(_mx_detect_current)
  if [[ -n "$current" ]]; then
    echo "$current"
    return
  fi

  # Check for active sessions
  if has_command zellij && [[ $(zellij list-sessions 2>/dev/null | wc -l) -gt 1 ]]; then
    echo "zellij"
  elif has_command tmux && [[ $(tmux list-sessions 2>/dev/null | wc -l) -gt 0 ]]; then
    echo "tmux"
  elif has_command zellij; then
    echo "zellij"
  elif has_command tmux; then
    echo "tmux"
  else
    echo ""
  fi
}

# List sessions for specific multiplexer
function _mx_list_sessions() {
  local mux="$1"
  case "$mux" in
    "tmux")
      if has_command tmux; then
        tmux list-sessions 2>/dev/null | awk -F: '{print "tmux\t" $1 "\t" $0}'
      fi
      ;;
    "zellij")
      if has_command zellij; then
        zellij list-sessions 2>/dev/null | tail -n +2 | awk '{print "zellij\t" $1 "\t" $0}'
      fi
      ;;
  esac
}

# List all sessions from all multiplexers
function _mx_list_all() {
  (
    _mx_list_sessions "tmux"
    _mx_list_sessions "zellij"
  ) | sort -k2
}

# List all sessions in table format
function _mx_list_table() {
  local sessions=$(_mx_list_all)

  if [[ -z "$sessions" ]]; then
    echo "No sessions found"
    return
  fi

  echo "MULTIPLEXER  SESSION     STATUS"
  echo "─────────────────────────────────────────────"

  echo "$sessions" | awk '{
    mux = $1
    session = $2
    # Extract status info
    desc = ""
    for(i=3; i<=NF; i++) {
      desc = desc $i
      if(i < NF) desc = desc " "
    }

    # Extract key status info (attached/detached, window count)
    status = ""
    if (match(desc, /attached/)) status = status "attached "
    else if (match(desc, /detached/)) status = status "detached "

    if (match(desc, /[0-9]+ windows?/)) {
      window_match = substr(desc, RSTART, RLENGTH)
      status = status window_match
    }

    printf "%-11s  %-10s  %s\n", mux, session, status
  }'
}

# Attach to specific session
function _mx_attach_session() {
  local mux="$1"
  local session="$2"
  local current=$(_mx_detect_current)

  if [[ "$current" == "$mux" ]]; then
    # Same multiplexer - switch session
    case "$mux" in
      "tmux") tmux switch-client -t "$session" ;;
      "zellij") zellij action switch-mode normal; zellij action go-to-tab-name "$session" ;;
    esac
  else
    # Different multiplexer or from outside - attach
    case "$mux" in
      "tmux") tmux attach-session -t "$session" ;;
      "zellij") zellij attach "$session" ;;
    esac
  fi
}

# Interactive session switching
function _mx_switch_interactive() {
  local sessions=$(_mx_list_all)

  if [[ -z "$sessions" ]]; then
    log_warn "No sessions found"
    return 1
  fi

  # Format for better display: single line per session
  local formatted=$(echo "$sessions" | awk '{
    # Extract session info cleanly
    mux = $1
    session = $2
    # Remove the first two fields and reconstruct the description
    desc = ""
    for(i=3; i<=NF; i++) {
      desc = desc $i
      if(i < NF) desc = desc " "
    }
    printf "%s:%s (%s)\n", mux, session, desc
  }')

  local selected=$(echo "$formatted" | \
    sk --prompt="Switch to> " --ansi --reverse)

  if [[ -n "$selected" ]]; then
    # Extract mux:session from the selected line
    local mux=$(echo "$selected" | cut -d: -f1)
    local session=$(echo "$selected" | cut -d: -f2 | cut -d' ' -f1)
    _mx_attach_session "$mux" "$session"
  fi
}

# Kill session interactively
function _mx_kill_interactive() {
  local sessions=$(_mx_list_all)

  if [[ -z "$sessions" ]]; then
    log_warn "No sessions found"
    return 1
  fi

  # Format for better display: single line per session
  local formatted=$(echo "$sessions" | awk '{
    mux = $1
    session = $2
    desc = ""
    for(i=3; i<=NF; i++) {
      desc = desc $i
      if(i < NF) desc = desc " "
    }
    printf "%s:%s (%s)\n", mux, session, desc
  }')

  local selected=$(echo "$formatted" | \
    sk --prompt="Kill session> " --ansi --reverse)

  if [[ -n "$selected" ]]; then
    local mux=$(echo "$selected" | cut -d: -f1)
    local session=$(echo "$selected" | cut -d: -f2 | cut -d' ' -f1)

    case "$mux" in
      "tmux") tmux kill-session -t "$session" ;;
      "zellij")
        # Use --force flag to kill and delete in one command
        zellij delete-session --force "$session"
        ;;
    esac

    if [[ $? -eq 0 ]]; then
      log_info "Killed $mux session: $session"
    else
      log_error "Failed to kill $mux session: $session"
    fi
  fi
}

# Create new session
function _mx_new_session() {
  local session_name="${1:-}"
  local mux=$(_mx_detect_available)

  if [[ -z "$mux" ]]; then
    log_error "No multiplexer available"
    return 1
  fi

  if [[ -z "$session_name" ]]; then
    printf "Session name: "
    read session_name
  fi

  if [[ -z "$session_name" ]]; then
    log_error "Session name required"
    return 1
  fi

  case "$mux" in
    "tmux")
      tmux new-session -d -s "$session_name"
      _mx_attach_session "tmux" "$session_name"
      ;;
    "zellij")
      zellij -s "$session_name"
      ;;
  esac
}

# Show status
function _mx_show_status() {
  local current=$(_mx_detect_current)
  local available=$(_mx_detect_available)

  echo "Current: ${current:-none}"
  echo "Available: ${available:-none}"
  echo
  echo "Sessions:"

  local sessions=$(_mx_list_all)
  if [[ -z "$sessions" ]]; then
    echo "  No sessions found"
    return
  fi

  echo "$sessions" | while IFS=$'\t' read -r mux session_name info; do
    local status="○"
    if [[ "$mux" == "$current" ]]; then
      # Check if this is the current session
      case "$mux" in
        "tmux")
          local current_session=$(tmux display-message -p '#S' 2>/dev/null)
          [[ "$session_name" == "$current_session" ]] && status="●"
          ;;
        "zellij")
          [[ "$session_name" == "$ZELLIJ_SESSION_NAME" ]] && status="●"
          ;;
      esac
    fi
    printf "%s %s:%s\n" "$status" "$mux" "$session_name"
  done
}

# Project-based session creation
function _mx_new_project_session() {
  local project_path=$(_sk_select_project_internal "Project for session> ")
  if [[ -z "$project_path" ]]; then
    return 1
  fi

  local project_name=$(basename "$project_path")
  local mux=$(_mx_detect_available)

  if [[ -z "$mux" ]]; then
    log_error "No multiplexer available"
    return 1
  fi

  case "$mux" in
    "tmux")
      tmux new-session -d -s "$project_name" -c "$project_path"
      _mx_attach_session "tmux" "$project_name"
      ;;
    "zellij")
      cd "$project_path"
      zellij -s "$project_name"
      ;;
  esac
}

# Kill all sessions
function _mx_kill_all_sessions() {
  local sessions=$(_mx_list_all)

  if [[ -z "$sessions" ]]; then
    log_warn "No sessions found"
    return 1
  fi

  echo "Current sessions:"
  echo "$sessions" | awk '{printf "  %s:%s\n", $1, $2}'
  echo

  printf "Are you sure you want to kill ALL sessions? (y/N): "
  read confirmation

  if [[ "$confirmation" =~ ^[Yy]$ ]]; then
    echo "$sessions" | while IFS=$'\t' read -r mux session_name info; do
      case "$mux" in
        "tmux")
          tmux kill-session -t "$session_name" 2>/dev/null
          ;;
        "zellij")
          zellij delete-session --force "$session_name" 2>/dev/null
          ;;
      esac
      log_info "Killed $mux session: $session_name"
    done
    log_success "All sessions killed"
  else
    log_info "Operation cancelled"
  fi
}

# Interactive main menu
function _mx_main_menu() {
  local sessions=$(_mx_list_all)
  local session_display=""

  # Show current sessions first if any exist
  if [[ -n "$sessions" ]]; then
    echo "Current sessions:"
    echo "$sessions" | awk '{printf "  %s:%s\n", $1, $2}'
    echo
  fi

  local choice=$(cat <<EOF | sk --prompt="Multiplexer> " --ansi --reverse
📋 List all sessions
🔄 Switch session
➕ New session
🎯 New project session
❌ Kill session
💀 Kill all sessions
📊 Show status
❓ Help
EOF
)

  case "$choice" in
    "📋 List all sessions") echo; _mx_list_table ;;
    "🔄 Switch session") _mx_switch_interactive ;;
    "➕ New session") _mx_new_session ;;
    "🎯 New project session") _mx_new_project_session ;;
    "❌ Kill session") _mx_kill_interactive ;;
    "💀 Kill all sessions") _mx_kill_all_sessions ;;
    "📊 Show status") echo; _mx_show_status ;;
    "❓ Help") echo; _mx_help ;;
    *) ;;
  esac
}

# Help function
function _mx_help() {
  cat <<EOF
Multiplexer Manager (mx) - Unified tmux/zellij session management

Commands:
  mx              Interactive menu
  mx list         List all sessions
  mx switch       Switch session (interactive)
  mx new [name]   Create new session
  mx project      Create session from project
  mx kill         Kill session (interactive)
  mx kill-all     Kill all sessions (with confirmation)
  mx status       Show current status

Keybindings:
  Current multiplexer sessions are detected automatically.
  Switch between tmux and zellij sessions seamlessly.

Examples:
  mx                    # Open interactive menu
  mx new mywork         # Create session named 'mywork'
  mx switch            # Interactively choose session
  mx kill-all          # Kill all sessions with confirmation
EOF
}

# Main mx command
function mx() {
  case "${1:-}" in
    "list"|"ls")     _mx_list_table ;;
    "switch"|"s")    _mx_switch_interactive ;;
    "new"|"n")       _mx_new_session "$2" ;;
    "project"|"p")   _mx_new_project_session ;;
    "kill"|"k")      _mx_kill_interactive ;;
    "kill-all")      _mx_kill_all_sessions ;;
    "status")        _mx_show_status ;;
    "help"|"h")      _mx_help ;;
    "")              _mx_main_menu ;;
    *)               _mx_help ;;
  esac
}

# Select tmux session interactively (legacy function)
function tmux_select() {
  if ! has_command tmux; then
    log_error "tmux is not installed"
    return 1
  fi

  local sessions=$(tmux list-sessions 2>/dev/null)
  if [[ -z "$sessions" ]]; then
    log_warn "No tmux sessions found"
    return
  fi

  local selected_session=$(echo "$sessions" | \
    awk -F: '{print $1}' | \
    sk --ansi --reverse --height '50%' --prompt 'Tmux Session> ')

  if [[ -n "$selected_session" ]]; then
    _mx_attach_session "tmux" "$selected_session"
  fi
}

# Select file within current git project (Ctrl+V)
function sk_select_file_within_project() {
  local base_path=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -z "$base_path" ]; then
    log_warn "Not in a git repository"
    sleep 0.5
    zle reset-prompt
    return
  fi

  local selected_path=$(_sk_select_file_internal "$base_path" "File> ")

  if [ -n "$selected_path" ]; then
    BUFFER="nvim ${(q)selected_path}"
    zle accept-line
  else
    zle reset-prompt
  fi
}

# Select file below current directory (Ctrl+B)
function sk_select_file_below_pwd() {
  local selected_path=$(_sk_select_file_internal "." "File> ")

  if [ -n "$selected_path" ]; then
    BUFFER="nvim ${(q)selected_path}"
    zle accept-line
  else
    zle reset-prompt
  fi
}

# Edit file (helper for alias)
function sk_edit_file() {
  local selected_path=$(_sk_select_file_internal "." "File> ")
  if [ -n "$selected_path" ]; then
    nvim "$selected_path"
  fi
}

# -----------------------------------------------------------------------------
# Git Helpers
# -----------------------------------------------------------------------------
function sk_select_branch_except_current() {
  git branch | grep -v "^[*+]" | sed 's/^[[:space:]]*//' | sk --prompt="Branch> " --ansi --reverse | xargs
}

function sk_select_local_branch_except_current() {
  git branch | grep -v "^[*+]" | sed 's/^[[:space:]]*//' | sk --prompt="Local Branch> " --ansi --reverse | xargs
}

function sk_select_branch_all() {
  local current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

  {
    # Show current branch first
    [[ -n "$current_branch" ]] && echo "$current_branch"

    # Then show all other branches sorted by commit date (newest first)
    git for-each-ref --sort=-committerdate --format='%(refname:short)' refs/heads/ refs/remotes/origin/ 2>/dev/null | \
      sed 's|^origin/||' | \
      grep -v -E "^HEAD$|^origin$|^${current_branch}$"
  } | awk '!seen[$0]++' | sk --prompt="Branch (All)> " --ansi --reverse | xargs
}

# Git wrapper functions (interactive if no args, normal if args provided)
function gsw() {
  if [ $# -eq 0 ]; then
    # No arguments: interactive branch selection (including remote branches)
    local selected_branch=$(sk_select_branch_all)
    if [ -n "$selected_branch" ]; then
      # Remove 'origin/' prefix if present
      local branch_name="${selected_branch#origin/}"
      git switch "$branch_name"
    fi
  else
    # With arguments: normal git switch
    git switch "$@"
  fi
}

function gpso() {
  if [ $# -eq 0 ]; then
    # No arguments: interactive branch selection
    sk_select_branch_all | xargs -t git push origin
  else
    # With arguments: push specified branch
    git push origin "$@"
  fi
}

function gPso() {
  if [ $# -eq 0 ]; then
    # No arguments: interactive branch selection
    sk_select_branch_all | xargs -t git push -f origin
  else
    # With arguments: force push specified branch
    git push -f origin "$@"
  fi
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
