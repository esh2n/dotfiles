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

# Update tmux window name on cd (works through PTY wrappers like pane-border)
function _tmux_chpwd() {
    if [[ -n "$TMUX" ]]; then
        tmux rename-window -t "$TMUX_PANE" "$(basename "$PWD")" 2>/dev/null
        # Store real cwd for split-window -c (pane_current_path doesn't update through PTY wrappers)
        tmux set-option -p -t "$TMUX_PANE" @cwd "$PWD" 2>/dev/null
    fi
}
autoload -Uz add-zsh-hook
add-zsh-hook chpwd _tmux_chpwd
_tmux_chpwd  # initial report

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

# Detect current multiplexer (or terminal emulator with mux capability)
function _mx_detect_current() {
  if [[ -n "${ZELLIJ_SESSION_NAME:-}" ]] || [[ -n "${ZELLIJ:-}" ]]; then
    echo "zellij"
  elif [[ -n "${TMUX:-}" ]]; then
    echo "tmux"
  elif [[ -n "${WEZTERM_PANE:-}" ]]; then
    echo "wezterm"
  else
    echo ""
  fi
}

# Detect available multiplexer (preference: current > active sessions > installed)
# Note: WezTerm is treated as "no multiplexer" here because it doesn't manage
# sessions like tmux/zellij. Use --mux wezterm explicitly for workspace command.
function _mx_detect_available() {
  local current=$(_mx_detect_current)
  # Only return early for real multiplexers (not wezterm)
  if [[ -n "$current" ]] && [[ "$current" != "wezterm" ]]; then
    echo "$current"
    return
  fi

  # Check for active sessions
  if has_command tmux && [[ $(tmux list-sessions 2>/dev/null | wc -l) -gt 0 ]]; then
    echo "tmux"
  elif has_command zellij && [[ $(zellij list-sessions 2>/dev/null | wc -l) -gt 1 ]]; then
    echo "zellij"
  elif has_command tmux; then
    echo "tmux"
  elif has_command zellij; then
    echo "zellij"
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
        # Strip ANSI color codes from zellij output
        zellij list-sessions 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | awk '{print "zellij\t" $1 "\t" $0}'
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

  # WezTerm is not a session-based mux, treat as "outside"
  if [[ "$current" == "wezterm" ]]; then
    current=""
  fi

  if [[ "$current" == "$mux" ]]; then
    # Same multiplexer - switch session
    case "$mux" in
      "tmux") tmux switch-client -t "$session" ;;
      "zellij")
        # No direct CLI action for session switching in zellij
        # Launch the built-in session-manager plugin
        log_info "Opening session manager (select '$session')"
        zellij action launch-or-focus-plugin --floating "zellij:session-manager"
        ;;
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

    local exit_code=0
    case "$mux" in
      "tmux")
        tmux kill-session -t "$session"
        exit_code=$?
        ;;
      "zellij")
        # Two-step process: kill then delete
        zellij kill-session "$session" 2>/dev/null || true
        zellij delete-session "$session" 2>/dev/null
        exit_code=$?
        ;;
    esac

    if [[ $exit_code -eq 0 ]]; then
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
    log_error "No multiplexer available (install zellij or tmux)"
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
    *)
      log_error "Unsupported multiplexer for session creation: $mux"
      return 1
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

# Select commit from git log
function sk_select_commit() {
  local prompt="${1:-Commit> }"
  local limit="${2:-100}"

  git log --oneline --decorate --color=always -n "$limit" | \
    sk --prompt="$prompt" --ansi --reverse \
       --preview 'git show --color=always {1}' \
       --preview-window 'right:60%' | \
    awk '{print $1}'
}

# Select commit range and show diff with difit
function gifit() {
  if ! has_command git; then
    log_error "git is not installed"
    return 1
  fi

  if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    log_error "Not in a git repository"
    return 1
  fi

  # Check if difit is available (bunx or globally installed)
  local difit_cmd=""
  if has_command difit; then
    difit_cmd="difit"
  elif has_command bunx; then
    difit_cmd="bunx difit"
  elif has_command npx; then
    difit_cmd="npx difit"
  else
    log_error "difit is not available. Install with: npm install -g difit"
    log_info "Or use bunx/npx to run it without installation"
    return 1
  fi

  log_info "Select FROM commit (older)"
  local from_commit=$(sk_select_commit "FROM (older)> " 100)

  if [[ -z "$from_commit" ]]; then
    log_warn "No FROM commit selected"
    return 1
  fi

  log_info "Selected FROM: $from_commit"
  log_info "Select TO commit (newer)"

  local to_commit=$(sk_select_commit "TO (newer)> " 100)

  if [[ -z "$to_commit" ]]; then
    log_warn "No TO commit selected"
    return 1
  fi

  log_info "Selected TO: $to_commit"
  log_info "Running: $difit_cmd $to_commit $from_commit"

  # Run difit with the selected range
  # difit takes two arguments: newer_commit older_commit
  eval "$difit_cmd $to_commit $from_commit"
}

# Quick diff with difit (last N commits)
function gdif() {
  local n="${1:-1}"

  if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    log_error "Not in a git repository"
    return 1
  fi

  local difit_cmd=""
  if has_command difit; then
    difit_cmd="difit"
  elif has_command bunx; then
    difit_cmd="bunx difit"
  elif has_command npx; then
    difit_cmd="npx difit"
  else
    log_error "difit is not available. Install with: npm install -g difit"
    return 1
  fi

  # difit takes two arguments: newer_commit older_commit
  eval "$difit_cmd HEAD HEAD~$n"
}

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
# Jujutsu (jj) Helpers
# -----------------------------------------------------------------------------

# Select change from jj log (= sk_select_commit for git)
function sk_select_jj_change() {
  local prompt="${1:-Change> }"
  local limit="${2:-100}"

  jj log -r "::@ | trunk()..@" --no-graph --color=always -n "$limit" \
    --template 'change_id.shortest(8) ++ " " ++ if(description, description.first_line(), "(no description)") ++ "\n"' 2>/dev/null | \
    sk --prompt="$prompt" --ansi --reverse \
       --preview 'jj show --color=always {1} 2>/dev/null' \
       --preview-window 'right:60%' | \
    awk '{print $1}'
}

# Select bookmark from jj bookmark list (= sk_select_branch_all for git)
function sk_select_jj_bookmark() {
  local prompt="${1:-Bookmark> }"

  jj bookmark list --template 'name ++ "\n"' 2>/dev/null | \
    sk --prompt="$prompt" --ansi --reverse
}

# Select bookmark except current working copy's bookmark
function sk_select_jj_bookmark_except_current() {
  local prompt="${1:-Bookmark> }"
  local current_bookmarks=$(jj log -r @ --no-graph \
    --template 'self.bookmarks().map(|b| b.name()).join("\n")' 2>/dev/null)

  jj bookmark list --template 'name ++ "\n"' 2>/dev/null | \
    grep -v -F "$current_bookmarks" | \
    sk --prompt="$prompt" --ansi --reverse
}

# Switch to change (= gsw for git)
function jsw() {
  if [ $# -eq 0 ]; then
    local selected=$(sk_select_jj_change "Edit> ")
    if [ -n "$selected" ]; then
      jj edit "$selected"
    fi
  else
    jj edit "$@"
  fi
}

# Push bookmark (= gpso for git)
function jpso() {
  if [ $# -eq 0 ]; then
    local selected=$(sk_select_jj_bookmark "Push bookmark> ")
    if [ -n "$selected" ]; then
      jj git push -b "$selected"
    fi
  else
    jj git push -b "$@"
  fi
}

# Force push bookmark (= gPso for git)
function jPso() {
  if [ $# -eq 0 ]; then
    local selected=$(sk_select_jj_bookmark "Force push bookmark> ")
    if [ -n "$selected" ]; then
      jj git push --allow-new -b "$selected"
    fi
  else
    jj git push --allow-new -b "$@"
  fi
}

# Select 2 changes and diff with difit (= gifit for git)
function jifit() {
  if ! jj root &>/dev/null; then
    log_error "Not in a jj repository"
    return 1
  fi

  local difit_cmd=""
  if has_command difit; then
    difit_cmd="difit"
  elif has_command bunx; then
    difit_cmd="bunx difit"
  elif has_command npx; then
    difit_cmd="npx difit"
  else
    log_error "difit is not available. Install with: npm install -g difit"
    return 1
  fi

  log_info "Select FROM change (older)"
  local from_change=$(sk_select_jj_change "FROM (older)> " 100)
  if [[ -z "$from_change" ]]; then
    log_warn "No FROM change selected"
    return 1
  fi

  log_info "Selected FROM: $from_change"
  log_info "Select TO change (newer)"
  local to_change=$(sk_select_jj_change "TO (newer)> " 100)
  if [[ -z "$to_change" ]]; then
    log_warn "No TO change selected"
    return 1
  fi

  log_info "Selected TO: $to_change"
  log_info "Running diff between $from_change and $to_change"
  jj diff --from "$from_change" --to "$to_change"
}

# Quick diff from @ ancestors (= gdif for git)
function jdif() {
  local n="${1:-1}"

  if ! jj root &>/dev/null; then
    log_error "Not in a jj repository"
    return 1
  fi

  jj diff --from "@-${n}" --to "@"
}

# Create bookmark (= gswc for git)
function jswc() {
  if [ $# -eq 0 ]; then
    printf "Bookmark name: "
    read bookmark_name
    if [[ -n "$bookmark_name" ]]; then
      jj bookmark create "$bookmark_name" -r @
    fi
  else
    jj bookmark create "$@" -r @
  fi
}

# Rename bookmark (= grn for git)
function jrn() {
  if [ $# -eq 0 ]; then
    local selected=$(sk_select_jj_bookmark "Rename bookmark> ")
    if [[ -n "$selected" ]]; then
      printf "New name: "
      read new_name
      if [[ -n "$new_name" ]]; then
        jj bookmark rename "$selected" "$new_name"
      fi
    fi
  else
    jj bookmark rename "$@"
  fi
}

# New change from selected (jj-specific)
function jnew() {
  if [ $# -eq 0 ]; then
    local selected=$(sk_select_jj_change "New from> ")
    if [ -n "$selected" ]; then
      jj new "$selected"
    fi
  else
    jj new "$@"
  fi
}

# Edit change interactively (jj-specific)
function jedit() {
  if [ $# -eq 0 ]; then
    local selected=$(sk_select_jj_change "Edit> ")
    if [ -n "$selected" ]; then
      jj edit "$selected"
    fi
  else
    jj edit "$@"
  fi
}

# Rebase interactively (jj-specific)
function jrb() {
  log_info "Select source (change to rebase)"
  local source=$(sk_select_jj_change "Source> ")
  if [[ -z "$source" ]]; then
    return 0
  fi

  log_info "Select destination (rebase onto)"
  local dest=$(sk_select_jj_change "Destination> ")
  if [[ -z "$dest" ]]; then
    return 0
  fi

  jj rebase -r "$source" -d "$dest"
}

# Squash into target (jj-specific)
function jsquash() {
  if [ $# -eq 0 ]; then
    log_info "Select target (squash into)"
    local target=$(sk_select_jj_change "Squash into> ")
    if [ -n "$target" ]; then
      jj squash --into "$target"
    fi
  else
    jj squash --into "$@"
  fi
}

# -----------------------------------------------------------------------------
# Jujutsu Workspace Management (jwt — mirrors wt for git worktrees)
# -----------------------------------------------------------------------------

# Internal helper: Select workspace using skim
function _jwt_select_workspace() {
  local workspaces=$(jj workspace list 2>/dev/null | awk '{print $1}')

  if [[ -z "$workspaces" ]]; then
    echo "No workspaces found" >&2
    return 1
  fi

  echo "$workspaces" | sk --prompt="Workspace> " --ansi --reverse
}

# Change to workspace directory
function jwtcd() {
  if [[ $# -gt 0 ]]; then
    # With arguments: find workspace path and cd
    local ws_name="$1"
    local root=$(jj workspace root 2>/dev/null)
    if [[ -z "$root" ]]; then
      log_error "Not in a jj repository"
      return 1
    fi
    # Default workspace lives at root, others at ../<ws_name>
    if [[ "$ws_name" == "default" ]]; then
      cd "$root"
    else
      local ws_path="${root}/../${ws_name}"
      if [[ -d "$ws_path" ]]; then
        cd "$ws_path"
      else
        log_error "Workspace directory not found: $ws_path"
        return 1
      fi
    fi
  else
    # No arguments: interactive selection
    local selected=$(_jwt_select_workspace)
    if [[ -n "$selected" ]]; then
      jwtcd "$selected"
    fi
  fi
}

# Add workspace interactively
function jwtadd() {
  if ! jj root &>/dev/null; then
    log_error "Not in a jj repository"
    return 1
  fi

  printf "Workspace path: "
  read ws_path
  if [[ -z "$ws_path" ]]; then
    log_info "Cancelled"
    return 0
  fi

  local choice=$(cat <<EOF | sk --prompt="Options> " --ansi --reverse
At current change (@)
At specific revision
EOF
)

  case "$choice" in
    "At current change"*)
      jj workspace add "$ws_path"
      ;;
    "At specific revision"*)
      local rev=$(sk_select_jj_change "Revision> ")
      if [[ -n "$rev" ]]; then
        jj workspace add "$ws_path" -r "$rev"
      else
        log_info "Cancelled"
      fi
      ;;
    *)
      log_info "Cancelled"
      ;;
  esac
}

# Remove workspace interactively
function jwtrm() {
  local selected=$(_jwt_select_workspace)
  if [[ -z "$selected" ]]; then
    return 0
  fi

  if [[ "$selected" == "default" ]]; then
    log_error "Cannot remove the default workspace"
    return 1
  fi

  printf "Remove workspace '$selected'? (y/N): "
  read confirmation
  if [[ "$confirmation" =~ ^[Yy]$ ]]; then
    jj workspace forget "$selected"
    if [[ $? -eq 0 ]]; then
      log_success "Removed workspace: $selected"
    else
      log_error "Failed to remove workspace"
    fi
  else
    log_info "Cancelled"
  fi
}

# List workspaces
function jwtls() {
  if ! jj root &>/dev/null; then
    log_error "Not in a jj repository"
    return 1
  fi
  jj workspace list
}

# Help function
function _jwt_help() {
  cat <<EOF
Jujutsu Workspace Manager (jwt) - Interactive workspace management with skim

Commands:
  jwt              Interactive menu
  jwt list         List all workspaces
  jwt cd [name]    Switch to workspace (interactive if no args)
  jwt add          Create new workspace (interactive)
  jwt rm           Remove workspace (interactive)
  jwt help         Show this help

Aliases:
  jwtcd            Same as 'jwt cd'
  jwtadd           Same as 'jwt add'
  jwtrm            Same as 'jwt rm'
  jwtls            Same as 'jwt list'
EOF
}

# Interactive main menu
function _jwt_main_menu() {
  local choice=$(cat <<EOF | sk --prompt="jj Workspace> " --ansi --reverse
List all workspaces
Switch to workspace
Create workspace
Remove workspace
Help
EOF
)

  case "$choice" in
    "List all workspaces") echo; jwtls ;;
    "Switch to workspace") jwtcd ;;
    "Create workspace") jwtadd ;;
    "Remove workspace") jwtrm ;;
    "Help") echo; _jwt_help ;;
    *) ;;
  esac
}

# Main jwt command
function jwt() {
  case "${1:-}" in
    "list"|"ls")     jwtls ;;
    "cd"|"switch")   shift; jwtcd "$@" ;;
    "add"|"new")     jwtadd ;;
    "rm"|"remove")   jwtrm ;;
    "help"|"h")      _jwt_help ;;
    "")              _jwt_main_menu ;;
    *)               _jwt_help ;;
  esac
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

# -----------------------------------------------------------------------------
# Worktree Management (wtp + skim)
# -----------------------------------------------------------------------------

# Internal helper: Select worktree using skim
# Returns: worktree identifier (for use with wtp cd)
function _wt_select_worktree() {
  if ! has_command wtp; then
    log_error "wtp is not installed"
    return 1
  fi

  # Get worktree identifiers, filter out cursor, detached, and special entries
  local worktrees=$(wtp list --quiet 2>/dev/null | \
    grep -v "\.cursor" | \
    grep -v "detached" | \
    grep -v "^@$")

  if [[ -z "$worktrees" ]]; then
    echo "No worktrees found" >&2
    return 1
  fi

  # Show worktree identifiers with preview
  # Preview uses wtp cd to get the actual path
  # Note: Use full path to git for preview subshell
  local git_cmd="${commands[git]:-/usr/bin/git}"
  echo "$worktrees" | sk --prompt="Worktree> " --ansi --reverse \
    --preview "path=\$(wtp cd {} 2>/dev/null); if [[ -n \"\$path\" ]]; then cd \"\$path\" && echo \"Path: \$path\" && echo \"Branch: \$($git_cmd rev-parse --abbrev-ref HEAD)\" && echo && $git_cmd log --oneline -5 --color=always && echo && $git_cmd status -sb; fi" \
    --preview-window 'right:50%'
}

# Change to worktree directory
function wtcd() {
  if ! has_command wtp; then
    log_error "wtp is not installed"
    return 1
  fi

  if [[ $# -gt 0 ]]; then
    # With arguments: use wtp cd directly
    local target_path=$(wtp cd "$@" 2>/dev/null)
    if [[ -n "$target_path" ]]; then
      cd "$target_path"
    else
      log_error "Worktree not found: $*"
      return 1
    fi
  else
    # No arguments: interactive selection
    local selected=$(_wt_select_worktree)
    if [[ -n "$selected" ]]; then
      # Convert identifier to path using wtp cd
      local target_path=$(wtp cd "$selected" 2>/dev/null)
      if [[ -n "$target_path" ]]; then
        cd "$target_path"
      else
        log_error "Worktree not found: $selected"
        return 1
      fi
    fi
  fi
}

# Remove worktree interactively
function wtrm() {
  if ! has_command wtp; then
    log_error "wtp is not installed"
    return 1
  fi

  local selected=$(_wt_select_worktree)
  if [[ -z "$selected" ]]; then
    return 0
  fi

  # Convert identifier to path using wtp cd
  local target_path=$(wtp cd "$selected" 2>/dev/null)
  local branch=$(cd "$target_path" && git rev-parse --abbrev-ref HEAD 2>/dev/null)

  echo "Worktree: $target_path"
  echo "Branch: $branch"
  echo "Identifier: $selected"
  echo
  echo "1) Remove worktree only (keep branch)"
  echo "2) Remove worktree AND branch"
  echo "3) Cancel"
  printf "Select [1-3]: "
  read choice

  case "$choice" in
    1)
      wtp remove "$selected"
      if [[ $? -eq 0 ]]; then
        log_success "Removed worktree: $selected (branch kept)"
      else
        log_error "Failed to remove worktree"
      fi
      ;;
    2)
      wtp remove --with-branch "$selected"
      if [[ $? -eq 0 ]]; then
        log_success "Removed worktree and branch: $selected"
      else
        log_error "Failed to remove worktree"
      fi
      ;;
    *)
      log_info "Cancelled"
      ;;
  esac
}

# Prune stale worktree references
function wtprune() {
  if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    log_error "Not in a git repository"
    return 1
  fi

  echo "Pruning stale worktree references..."
  git worktree prune -v
  log_success "Prune completed"
}

# Copy .claude/settings.local.json to new worktree if gitignored
function _wt_copy_claude_local_settings() {
  local src_root=$(git rev-parse --show-toplevel 2>/dev/null)
  local dst_path=$1

  if [[ -f "$src_root/.claude/settings.local.json" ]] && \
     git -C "$dst_path" check-ignore -q ".claude/settings.local.json" 2>/dev/null; then
    mkdir -p "$dst_path/.claude"
    cp "$src_root/.claude/settings.local.json" "$dst_path/.claude/"
    log_info "Copied .claude/settings.local.json to worktree"
  fi
}

# Add worktree interactively
function wtadd() {
  if ! has_command wtp; then
    log_error "wtp is not installed"
    return 1
  fi

  if ! git rev-parse --is-inside-work-tree &>/dev/null; then
    log_error "Not in a git repository"
    return 1
  fi

  local choice=$(cat <<EOF | sk --prompt="Create worktree> " --ansi --reverse
📦 Existing branch
🌱 New from here
🪴 New from...
EOF
)

  case "$choice" in
    "📦 Existing branch")
      # Select from existing branches (run 'git fetch' manually if needed)
      # Sorted by commit date (newest first), filter out Cursor-generated branches
      local branch=$(git for-each-ref --sort=-committerdate --format='%(refname:short)' refs/heads/ refs/remotes/origin/ | \
        sed 's|^origin/||' | \
        awk '!seen[$0]++' | \
        grep -v "^HEAD$" | \
        awk '{ if (match($0, /-[A-Za-z0-9]{5}$/)) { s=substr($0,RSTART+1,5); if(s~/[A-Z]/) next } print }' | \
        sk --prompt="Branch> " --ansi --reverse \
           --preview 'git log --oneline -10 --color=always {} 2>/dev/null || git log --oneline -10 --color=always origin/{} 2>/dev/null || echo "No local commits yet"')

      if [[ -n "$branch" ]]; then
        if wtp add "$branch"; then
          local new_path=$(wtp cd "$branch" 2>/dev/null)
          [[ -n "$new_path" ]] && _wt_copy_claude_local_settings "$new_path"
          wtcd "$branch"
        fi
      fi
      ;;
    "🌱 New from here")
      printf "New branch name: "
      read new_branch
      if [[ -n "$new_branch" ]]; then
        if wtp add -b "$new_branch"; then
          local new_path=$(wtp cd "$new_branch" 2>/dev/null)
          [[ -n "$new_path" ]] && _wt_copy_claude_local_settings "$new_path"
          wtcd "$new_branch"
        fi
      fi
      ;;
    "🪴 New from...")
      # First select base branch (run 'git fetch' manually if needed)
      # Sorted by commit date (newest first), filter out Cursor-generated branches
      log_info "Select base branch:"
      local base_branch=$(git for-each-ref --sort=-committerdate --format='%(refname:short)' refs/heads/ refs/remotes/origin/ | \
        sed 's|^origin/||' | \
        awk '!seen[$0]++' | \
        grep -v "^HEAD$" | \
        awk '{ if (match($0, /-[A-Za-z0-9]{5}$/)) { s=substr($0,RSTART+1,5); if(s~/[A-Z]/) next } print }' | \
        sk --prompt="Base branch> " --ansi --reverse \
           --preview 'git log --oneline -10 --color=always {} 2>/dev/null || git log --oneline -10 --color=always origin/{} 2>/dev/null || echo "No local commits yet"')

      if [[ -z "$base_branch" ]]; then
        log_info "Cancelled"
        return 0
      fi

      printf "New branch name: "
      read new_branch
      if [[ -n "$new_branch" ]]; then
        if wtp add -b "$new_branch" "$base_branch"; then
          local new_path=$(wtp cd "$new_branch" 2>/dev/null)
          [[ -n "$new_path" ]] && _wt_copy_claude_local_settings "$new_path"
          wtcd "$new_branch"
        fi
      fi
      ;;
    *)
      log_info "Cancelled"
      ;;
  esac
}

# List worktrees
function wtls() {
  if ! has_command wtp; then
    log_error "wtp is not installed"
    return 1
  fi
  # Filter out cursor and detached worktrees (use 'wtp list' for all)
  wtp list | grep -v "\.cursor" | grep -v "detached"
}

# Worktree main menu
function _wt_help() {
  cat <<EOF
Worktree Manager (wt) - Interactive worktree management with skim

Commands:
  wt              Interactive menu
  wt list         List all worktrees
  wt cd [name]    Switch to worktree (interactive if no args)
  wt add          Create new worktree (interactive)
  wt rm           Remove worktree (interactive)
  wt prune        Clean up stale worktree references
  wt help         Show this help

Aliases:
  wtcd            Same as 'wt cd'
  wtadd           Same as 'wt add'
  wtrm            Same as 'wt rm'
  wtls            Same as 'wt list'
  wtprune         Same as 'wt prune'
EOF
}

function _wt_main_menu() {
  local choice=$(cat <<EOF | sk --prompt="Worktree> " --ansi --reverse
📋 List all worktrees
🔄 Switch to worktree
➕ Create worktree
❌ Remove worktree
🧹 Prune stale references
❓ Help
EOF
)

  case "$choice" in
    "📋 List all worktrees") echo; wtls ;;
    "🔄 Switch to worktree") wtcd ;;
    "➕ Create worktree") wtadd ;;
    "❌ Remove worktree") wtrm ;;
    "🧹 Prune stale references") echo; wtprune ;;
    "❓ Help") echo; _wt_help ;;
    *) ;;
  esac
}

# Main wt command
function wt() {
  case "${1:-}" in
    "list"|"ls")     wtls ;;
    "cd"|"switch")   shift; wtcd "$@" ;;
    "add"|"new")     wtadd ;;
    "rm"|"remove")   wtrm ;;
    "prune")         wtprune ;;
    "help"|"h")      _wt_help ;;
    "")              _wt_main_menu ;;
    *)               _wt_help ;;
  esac
}

# Zsh widget for wt menu
function sk_worktree_menu() {
  _wt_main_menu
  zle reset-prompt
}

# -----------------------------------------------------------------------------
# Workspace Layout Manager (workspace)
# -----------------------------------------------------------------------------

# Available presets
typeset -gA _WS_PRESETS=(
  [coding]="editor + terminal"
  [full]="yazi + editor + lazygit + terminal"
  [review]="lazygit + editor"
  [explore]="yazi + editor"
  [llm]="claude x<N> + shell (grid adjustable)"
)

# Parse LLM grid spec (e.g., "3x2", "9") into "cols rows"
function _ws_llm_parse_grid() {
  local spec="${1:-3x2}"
  local cols rows

  if [[ "$spec" =~ ^([0-9]+)x([0-9]+)$ ]]; then
    cols="${match[1]}"
    rows="${match[2]}"
  elif [[ "$spec" =~ ^[0-9]+$ ]]; then
    local n="$spec"
    # Auto-calculate: near-square grid, wider than tall
    cols=1
    while (( cols * cols < n )); do
      (( cols++ ))
    done
    rows=$(( (n + cols - 1) / cols ))
  else
    cols=3
    rows=2
  fi

  echo "$cols $rows"
}

# Generate zellij KDL pane nodes for LLM grid
# Shell pane is placed at the bottom, so row sizes are based on grid_pct (default 80%)
function _ws_llm_gen_panes() {
  local cols="$1"
  local rows="$2"
  local indent="$3"
  local grid_pct="${4:-80}"
  local n=1

  for ((r = 1; r <= rows; r++)); do
    local row_pct=$(( grid_pct / rows ))
    (( r == rows )) && row_pct=$(( grid_pct - (rows - 1) * (grid_pct / rows) ))

    echo "${indent}pane split_direction=\"vertical\" size=\"${row_pct}%\" {"
    for ((c = 1; c <= cols; c++)); do
      local col_pct=$(( 100 / cols ))
      (( c == cols )) && col_pct=$(( 100 - (cols - 1) * (100 / cols) ))
      echo "${indent}    pane name=\"claude-${n}\" size=\"${col_pct}%\" command=\"claude\""
      (( n++ ))
    done
    echo "${indent}}"
  done
}

# Resolve editor command
function _ws_resolve_editor() {
  local editor="${EDITOR:-nvim}"
  # Ensure we have an absolute path or a known command
  if has_command "$editor"; then
    echo "$editor"
  else
    echo "nvim"
  fi
}

# Generate zellij layout KDL for a preset
function _ws_zellij_layout() {
  local preset="$1"
  local dir="$2"
  local grid_spec="${3:-3x2}"
  local editor=$(_ws_resolve_editor)
  local zjstatus_path="$HOME/.config/zellij/plugins/zjstatus.wasm"

  # zjstatus top bar
  local top_bar
  read -r -d '' top_bar <<'TOPBAR' || true
        pane size=1 borderless=true {
            plugin location="file:__ZJSTATUS__" {
                format_space  "#[bg=#313244]"
                format_left   "#[bg=#313244,fg=#89b4fa,bold] 󰣇 {mode} #[bg=#313244,fg=#cdd6f4]│ #[bg=#313244,fg=#fab387,bold]{session} "
                format_center "#[bg=#313244]{tabs}"
                format_right  "#[bg=#313244,fg=#94e2d5]{command_whoami}#[bg=#313244,fg=#cdd6f4]@#[bg=#313244,fg=#a6e3a1]{command_hostname} "
                mode_normal        "#[bg=#89b4fa,fg=#1e1e2e,bold] NORMAL "
                mode_locked        "#[bg=#f38ba8,fg=#1e1e2e,bold] LOCKED "
                mode_resize        "#[bg=#fab387,fg=#1e1e2e,bold] RESIZE "
                mode_pane          "#[bg=#a6e3a1,fg=#1e1e2e,bold] PANE "
                mode_tab           "#[bg=#f9e2af,fg=#1e1e2e,bold] TAB "
                mode_scroll        "#[bg=#cba6f7,fg=#1e1e2e,bold] SCROLL "
                mode_enter_search  "#[bg=#94e2d5,fg=#1e1e2e,bold] SEARCH "
                mode_search        "#[bg=#94e2d5,fg=#1e1e2e,bold] SEARCH "
                mode_rename_tab    "#[bg=#f9e2af,fg=#1e1e2e,bold] RENAME "
                mode_rename_pane   "#[bg=#a6e3a1,fg=#1e1e2e,bold] RENAME "
                mode_session       "#[bg=#f38ba8,fg=#1e1e2e,bold] SESSION "
                mode_move          "#[bg=#fab387,fg=#1e1e2e,bold] MOVE "
                mode_prompt        "#[bg=#cba6f7,fg=#1e1e2e,bold] PROMPT "
                mode_tmux          "#[bg=#fab387,fg=#1e1e2e,bold] TMUX "
                tab_normal   "#[bg=#313244,fg=#6c7086]  {name}#{index} "
                tab_active   "#[bg=#45475a,fg=#89b4fa,bold]  {name}#{index} "
                command_whoami_command     "whoami"
                command_whoami_format      "{stdout}"
                command_whoami_interval    "0"
                command_hostname_command   "hostname"
                command_hostname_format    "{stdout}"
                command_hostname_interval  "0"
                border_enabled  "false"
            }
        }
TOPBAR
  top_bar="${top_bar//__ZJSTATUS__/$zjstatus_path}"

  # zjstatus bottom bar
  local bottom_bar
  read -r -d '' bottom_bar <<'BOTTOMBAR' || true
        pane size=1 borderless=true {
            plugin location="file:__ZJSTATUS__" {
                format_space  "#[bg=#313244]"
                format_left   "#[bg=#313244,fg=#6c7086] Split: #[bg=#313244,fg=#89b4fa]\\#[bg=#313244,fg=#6c7086],#[bg=#313244,fg=#89b4fa]-#[bg=#313244,fg=#6c7086] │ Nav: #[bg=#313244,fg=#89b4fa]hjkl#[bg=#313244,fg=#89b4fa] │ Resize: #[bg=#313244,fg=#89b4fa]H/J/K/L#[bg=#313244,fg=#6c7086] │ Float: #[bg=#313244,fg=#89b4fa]w,e#[bg=#313244,fg=#6c7086] │ Zoom: #[bg=#313244,fg=#89b4fa]z#[bg=#313244,fg=#6c7086] │ Close: #[bg=#313244,fg=#89b4fa]x "
                format_center "#[bg=#313244,fg=#6c7086]Scroll: #[bg=#313244,fg=#89b4fa][#[bg=#313244,fg=#6c7086] │ Find: #[bg=#313244,fg=#89b4fa]f#[bg=#313244,fg=#6c7086] │ Harpoon: #[bg=#313244,fg=#89b4fa]h#[bg=#313244,fg=#6c7086] │ Detach: #[bg=#313244,fg=#89b4fa]d "
                format_right  "#[bg=#313244,fg=#6c7086]Tab: #[bg=#313244,fg=#89b4fa]t#[bg=#313244,fg=#6c7086] │ Nav: #[bg=#313244,fg=#89b4fa]Ctrl+h/l "
                border_enabled  "false"
            }
        }
BOTTOMBAR
  bottom_bar="${bottom_bar//__ZJSTATUS__/$zjstatus_path}"

  # Generate pane layout based on preset
  local pane_layout=""
  case "$preset" in
    "coding")
      read -r -d '' pane_layout <<PANES || true
    tab name="coding" focus=true {
        pane split_direction="horizontal" {
            pane name="editor" size="75%" command="$editor" {
                args "."
            }
            pane name="terminal" size="25%"
        }
    }
PANES
      ;;
    "full")
      read -r -d '' pane_layout <<PANES || true
    tab name="full" focus=true {
        pane split_direction="vertical" {
            pane name="yazi" size="20%" command="yazi" {
                args "."
            }
            pane name="editor" size="50%" command="$editor" {
                args "."
            }
            pane split_direction="horizontal" size="30%" {
                pane name="lazygit" size="60%" command="lazygit"
                pane name="terminal" size="40%"
            }
        }
    }
PANES
      ;;
    "review")
      read -r -d '' pane_layout <<PANES || true
    tab name="review" focus=true {
        pane split_direction="vertical" {
            pane name="lazygit" size="40%" command="lazygit"
            pane name="editor" size="60%" command="$editor" {
                args "."
            }
        }
    }
PANES
      ;;
    "explore")
      read -r -d '' pane_layout <<PANES || true
    tab name="explore" focus=true {
        pane split_direction="vertical" {
            pane name="yazi" size="30%" command="yazi" {
                args "."
            }
            pane name="editor" size="70%" command="$editor" {
                args "."
            }
        }
    }
PANES
      ;;
    "llm")
      local grid=( ${(s: :)"$(_ws_llm_parse_grid "$grid_spec")"} )
      local cols=${grid[1]}
      local rows=${grid[2]}
      local inner=$(_ws_llm_gen_panes "$cols" "$rows" "            " 80)
      pane_layout="    tab name=\"llm\" focus=true {
        pane split_direction=\"horizontal\" {
${inner}
            pane name=\"shell\" size=\"20%\"
        }
    }"
      ;;
  esac

  # Assemble full layout
  cat <<EOF
layout {
    cwd "$dir"
    default_tab_template {
$top_bar
        children
$bottom_bar
    }

$pane_layout
}
EOF
}

# Generate zellij tab-only layout KDL (for use inside existing session)
# NOTE: zellij new-tab --layout requires layout{} wrapper but NOT tab{} wrapper.
# - layout{tab{...}} → redefines entire session (destroys existing tabs)
# - layout{pane...}  → adds as new tab (correct)
# - bare pane...     → "No layout found" error in zellij v3.12+
function _ws_zellij_tab_layout() {
  local preset="$1"
  local grid_spec="${2:-3x2}"
  local editor=$(_ws_resolve_editor)

  local pane_layout=""
  case "$preset" in
    "coding")
      read -r -d '' pane_layout <<PANES || true
    pane split_direction="horizontal" {
        pane name="editor" size="75%" command="$editor" {
            args "."
        }
        pane name="terminal" size="25%"
    }
PANES
      ;;
    "full")
      read -r -d '' pane_layout <<PANES || true
    pane split_direction="vertical" {
        pane name="yazi" size="20%" command="yazi"
        pane name="editor" size="50%" command="$editor" {
            args "."
        }
        pane split_direction="horizontal" size="30%" {
            pane name="lazygit" size="60%" command="lazygit"
            pane name="terminal" size="40%"
        }
    }
PANES
      ;;
    "review")
      read -r -d '' pane_layout <<PANES || true
    pane split_direction="vertical" {
        pane name="lazygit" size="40%" command="lazygit"
        pane name="editor" size="60%" command="$editor" {
            args "."
        }
    }
PANES
      ;;
    "explore")
      read -r -d '' pane_layout <<PANES || true
    pane split_direction="vertical" {
        pane name="yazi" size="30%" command="yazi"
        pane name="editor" size="70%" command="$editor" {
            args "."
        }
    }
PANES
      ;;
    "llm")
      local grid=( ${(s: :)"$(_ws_llm_parse_grid "$grid_spec")"} )
      local cols=${grid[1]}
      local rows=${grid[2]}
      local inner=$(_ws_llm_gen_panes "$cols" "$rows" "            " 80)
      pane_layout="    pane split_direction=\"horizontal\" {
${inner}
            pane name=\"shell\" size=\"20%\"
    }"
      ;;
  esac

  # Build top/bottom bar (same as full layout)
  local zjstatus_path="$HOME/.config/zellij/plugins/zjstatus.wasm"

  local top_bar
  read -r -d '' top_bar <<'TOPBAR' || true
        pane size=1 borderless=true {
            plugin location="file:__ZJSTATUS__" {
                format_space  "#[bg=#313244]"
                format_left   "#[bg=#313244,fg=#89b4fa,bold] 󰣇 {mode} #[bg=#313244,fg=#cdd6f4]│ #[bg=#313244,fg=#fab387,bold]{session} "
                format_center "#[bg=#313244]{tabs}"
                format_right  "#[bg=#313244,fg=#94e2d5]{command_whoami}#[bg=#313244,fg=#cdd6f4]@#[bg=#313244,fg=#a6e3a1]{command_hostname} "
                mode_normal        "#[bg=#89b4fa,fg=#1e1e2e,bold] NORMAL "
                mode_locked        "#[bg=#f38ba8,fg=#1e1e2e,bold] LOCKED "
                mode_resize        "#[bg=#fab387,fg=#1e1e2e,bold] RESIZE "
                mode_pane          "#[bg=#a6e3a1,fg=#1e1e2e,bold] PANE "
                mode_tab           "#[bg=#f9e2af,fg=#1e1e2e,bold] TAB "
                mode_scroll        "#[bg=#cba6f7,fg=#1e1e2e,bold] SCROLL "
                mode_enter_search  "#[bg=#94e2d5,fg=#1e1e2e,bold] SEARCH "
                mode_search        "#[bg=#94e2d5,fg=#1e1e2e,bold] SEARCH "
                mode_rename_tab    "#[bg=#f9e2af,fg=#1e1e2e,bold] RENAME "
                mode_rename_pane   "#[bg=#a6e3a1,fg=#1e1e2e,bold] RENAME "
                mode_session       "#[bg=#f38ba8,fg=#1e1e2e,bold] SESSION "
                mode_move          "#[bg=#fab387,fg=#1e1e2e,bold] MOVE "
                mode_prompt        "#[bg=#cba6f7,fg=#1e1e2e,bold] PROMPT "
                mode_tmux          "#[bg=#fab387,fg=#1e1e2e,bold] TMUX "
                tab_normal   "#[bg=#313244,fg=#6c7086]  {name}#{index} "
                tab_active   "#[bg=#45475a,fg=#89b4fa,bold]  {name}#{index} "
                command_whoami_command     "whoami"
                command_whoami_format      "{stdout}"
                command_whoami_interval    "0"
                command_hostname_command   "hostname"
                command_hostname_format    "{stdout}"
                command_hostname_interval  "0"
                border_enabled  "false"
            }
        }
TOPBAR
  top_bar="${top_bar//__ZJSTATUS__/$zjstatus_path}"

  local bottom_bar
  read -r -d '' bottom_bar <<'BOTTOMBAR' || true
        pane size=1 borderless=true {
            plugin location="file:__ZJSTATUS__" {
                format_space  "#[bg=#313244]"
                format_left   "#[bg=#313244,fg=#6c7086] Split: #[bg=#313244,fg=#89b4fa]\\#[bg=#313244,fg=#6c7086],#[bg=#313244,fg=#89b4fa]-#[bg=#313244,fg=#6c7086] │ Nav: #[bg=#313244,fg=#89b4fa]hjkl#[bg=#313244,fg=#89b4fa] │ Resize: #[bg=#313244,fg=#89b4fa]H/J/K/L#[bg=#313244,fg=#6c7086] │ Float: #[bg=#313244,fg=#89b4fa]w,e#[bg=#313244,fg=#6c7086] │ Zoom: #[bg=#313244,fg=#89b4fa]z#[bg=#313244,fg=#6c7086] │ Close: #[bg=#313244,fg=#89b4fa]x "
                format_center "#[bg=#313244,fg=#6c7086]Scroll: #[bg=#313244,fg=#89b4fa][#[bg=#313244,fg=#6c7086] │ Find: #[bg=#313244,fg=#89b4fa]f#[bg=#313244,fg=#6c7086] │ Harpoon: #[bg=#313244,fg=#89b4fa]h#[bg=#313244,fg=#6c7086] │ Detach: #[bg=#313244,fg=#89b4fa]d "
                format_right  "#[bg=#313244,fg=#6c7086]Tab: #[bg=#313244,fg=#89b4fa]t#[bg=#313244,fg=#6c7086] │ Nav: #[bg=#313244,fg=#89b4fa]Ctrl+h/l "
                border_enabled  "false"
            }
        }
BOTTOMBAR
  bottom_bar="${bottom_bar//__ZJSTATUS__/$zjstatus_path}"

  # Wrap in layout{} with bars directly embedded (approach C)
  # default_tab_template doesn't work with new-tab --layout,
  # so we embed top/bottom bars as sibling panes
  cat <<EOF
layout {
$top_bar
$pane_layout
$bottom_bar
}
EOF
}

# Launch workspace with zellij
function _ws_launch_zellij() {
  local preset="$1"
  local dir="$2"
  local grid_spec="${3:-3x2}"
  local session_name="ws-${preset}-$(basename "$dir")"

  local current=$(_mx_detect_current)
  local tmpdir=$(mktemp -d)
  trap "rm -rf '$tmpdir'" EXIT

  if [[ "$current" == "zellij" ]]; then
    # Already inside zellij - add as new tab in current session
    local tmpfile="${tmpdir}/ws-tab-layout.kdl"
    _ws_zellij_tab_layout "$preset" "$grid_spec" > "$tmpfile"
    log_info "Adding '$preset' tab to current session ($dir)"
    zellij action new-tab --layout "$tmpfile" --cwd "$dir"
  else
    # Guard: prevent nested zellij (double check with $ZELLIJ)
    if [[ -n "${ZELLIJ:-}" ]] || [[ -n "${ZELLIJ_SESSION_NAME:-}" ]]; then
      log_error "Already inside zellij but detection failed. Aborting to prevent nested session."
      return 1
    fi
    # Outside zellij - create new session with full layout
    local tmpfile="${tmpdir}/ws-layout.kdl"
    _ws_zellij_layout "$preset" "$dir" "$grid_spec" > "$tmpfile"
    (cd "$dir" && zellij -n "$tmpfile" -s "$session_name")
  fi
}

# Launch workspace with tmux
function _ws_launch_tmux() {
  local preset="$1"
  local dir="$2"
  local grid_spec="${3:-3x2}"
  local editor=$(_ws_resolve_editor)
  local session_name="ws-${preset}-$(basename "$dir")"

  # Create session
  tmux new-session -d -s "$session_name" -c "$dir"

  case "$preset" in
    "coding")
      # Main pane: editor, bottom: terminal
      tmux send-keys -t "$session_name" "$editor ." C-m
      tmux split-window -t "$session_name" -v -p 25 -c "$dir"
      tmux select-pane -t "$session_name:.0"
      ;;
    "full")
      # Left: yazi, Center: editor, Right top: lazygit, Right bottom: terminal
      tmux send-keys -t "$session_name" "$editor ." C-m
      tmux split-window -t "$session_name" -h -p 30 -c "$dir"
      tmux split-window -t "$session_name" -v -p 40 -c "$dir"
      tmux select-pane -t "$session_name:.0"
      tmux split-window -t "$session_name" -h -b -p 25 -c "$dir"
      tmux send-keys -t "$session_name:.0" "yazi ." C-m
      tmux send-keys -t "$session_name:.2" "lazygit" C-m
      tmux select-pane -t "$session_name:.1"
      ;;
    "review")
      # Left: lazygit, Right: editor
      tmux send-keys -t "$session_name" "lazygit" C-m
      tmux split-window -t "$session_name" -h -p 60 -c "$dir"
      tmux send-keys -t "$session_name" "$editor ." C-m
      ;;
    "explore")
      # Left: yazi, Right: editor
      tmux send-keys -t "$session_name" "yazi ." C-m
      tmux split-window -t "$session_name" -h -p 70 -c "$dir"
      tmux send-keys -t "$session_name" "$editor ." C-m
      ;;
    "llm")
      local grid=( ${(s: :)"$(_ws_llm_parse_grid "$grid_spec")"} )
      local cols=${grid[1]}
      local rows=${grid[2]}
      local total=$(( cols * rows ))

      # Split bottom 20% for shell (pane 0 = grid, pane 1 = shell)
      tmux split-window -t "$session_name" -v -p 20 -c "$dir"
      tmux select-pane -t "$session_name:.0"

      # Split grid area into rows
      for (( r = 1; r < rows; r++ )); do
        local target=$(( r - 1 ))
        local remaining=$(( rows - r + 1 ))
        local vpct=$(( (remaining - 1) * 100 / remaining ))
        tmux split-window -t "$session_name:.${target}" -v -p ${vpct} -c "$dir"
      done

      # Split each row into columns
      for (( r = 0; r < rows; r++ )); do
        local base=$(( r * cols ))
        for (( c = 1; c < cols; c++ )); do
          local target=$(( base + c - 1 ))
          local remaining=$(( cols - c + 1 ))
          local hpct=$(( (remaining - 1) * 100 / remaining ))
          tmux split-window -t "$session_name:.${target}" -h -p ${hpct} -c "$dir"
        done
      done

      # Launch claude in all grid panes (0..total-1, shell is at total)
      for (( i = 0; i < total; i++ )); do
        tmux send-keys -t "$session_name:.${i}" "claude" C-m
      done
      tmux select-pane -t "$session_name:.0"
      ;;
  esac

  # Attach to session
  _mx_attach_session "tmux" "$session_name"
}

# Launch workspace with WezTerm native panes
function _ws_launch_wezterm() {
  local preset="$1"
  local dir="$2"
  local grid_spec="${3:-3x2}"
  local editor=$(_ws_resolve_editor)

  if ! has_command wezterm; then
    log_error "wezterm is not installed"
    return 1
  fi

  # Determine starting pane
  local base_pane="${WEZTERM_PANE:-}"
  if [[ -z "$base_pane" ]]; then
    # Not inside WezTerm - spawn a new window
    log_info "Spawning new WezTerm window"
    base_pane=$(wezterm cli spawn --new-window --cwd "$dir" 2>/dev/null)
    if [[ -z "$base_pane" ]]; then
      log_error "Failed to spawn WezTerm window. Is WezTerm running?"
      return 1
    fi
  fi

  case "$preset" in
    "coding")
      # editor (top 75%) + terminal (bottom 25%)
      local terminal_pane=$(wezterm cli split-pane --pane-id "$base_pane" --bottom --percent 25 --cwd "$dir")
      wezterm cli send-text --pane-id "$base_pane" --no-paste "$editor .\n"
      ;;
    "full")
      # yazi (left 20%) | editor (center 62.5%) | lazygit (right top 60%) / terminal (right bottom 40%)
      local yazi_pane=$(wezterm cli split-pane --pane-id "$base_pane" --left --percent 20 --cwd "$dir")
      wezterm cli send-text --pane-id "$yazi_pane" --no-paste "yazi .\n"
      local right_pane=$(wezterm cli split-pane --pane-id "$base_pane" --right --percent 37 --cwd "$dir")
      local terminal_pane=$(wezterm cli split-pane --pane-id "$right_pane" --bottom --percent 40 --cwd "$dir")
      wezterm cli send-text --pane-id "$right_pane" --no-paste "lazygit\n"
      wezterm cli send-text --pane-id "$base_pane" --no-paste "$editor .\n"
      ;;
    "review")
      # lazygit (left 40%) | editor (right 60%)
      local lazygit_pane=$(wezterm cli split-pane --pane-id "$base_pane" --left --percent 40 --cwd "$dir")
      wezterm cli send-text --pane-id "$lazygit_pane" --no-paste "lazygit\n"
      wezterm cli send-text --pane-id "$base_pane" --no-paste "$editor .\n"
      ;;
    "explore")
      # yazi (left 30%) | editor (right 70%)
      local yazi_pane=$(wezterm cli split-pane --pane-id "$base_pane" --left --percent 30 --cwd "$dir")
      wezterm cli send-text --pane-id "$yazi_pane" --no-paste "yazi .\n"
      wezterm cli send-text --pane-id "$base_pane" --no-paste "$editor .\n"
      ;;
    "llm")
      local grid=( ${(s: :)"$(_ws_llm_parse_grid "$grid_spec")"} )
      local cols=${grid[1]}
      local rows=${grid[2]}
      local total=$(( cols * rows ))

      # Split bottom 20% for shell
      local shell_pane=$(wezterm cli split-pane --pane-id "$base_pane" --bottom --percent 20 --cwd "$dir")

      # Build grid: split top area into rows, then each row into columns
      # Track pane IDs for each grid cell
      local -a row_panes=()
      local -a all_panes=()

      # First row uses the base_pane
      row_panes+=("$base_pane")

      # Create additional rows by splitting from the base pane
      for (( r = 1; r < rows; r++ )); do
        local remaining=$(( rows - r ))
        local pct=$(( 100 * remaining / (remaining + 1) ))
        local new_pane=$(wezterm cli split-pane --pane-id "$base_pane" --bottom --percent "$pct" --cwd "$dir")
        row_panes+=("$new_pane")
      done

      # Split each row into columns
      for (( r = 0; r < rows; r++ )); do
        local row_pane="${row_panes[$((r + 1))]}"
        all_panes+=("$row_pane")

        for (( c = 1; c < cols; c++ )); do
          local remaining=$(( cols - c ))
          local pct=$(( 100 * remaining / (remaining + 1) ))
          local col_pane=$(wezterm cli split-pane --pane-id "$row_pane" --right --percent "$pct" --cwd "$dir")
          all_panes+=("$col_pane")
        done
      done

      # Launch claude in all grid panes
      for pane_id in "${all_panes[@]}"; do
        wezterm cli send-text --pane-id "$pane_id" --no-paste "claude\n"
      done

      # Focus the first pane
      wezterm cli activate-pane --pane-id "${all_panes[1]}"
      ;;
  esac
}

# Launch workspace with detected or specified multiplexer
function _ws_launch() {
  local preset="$1"
  local dir="$2"
  local grid_spec="${3:-3x2}"
  local mux="${4:-}"

  # Fall back to auto-detection if no explicit mux specified
  if [[ -z "$mux" ]]; then
    mux=$(_mx_detect_available)
  fi

  # Validate mux choice
  case "$mux" in
    "zellij"|"tmux"|"wezterm") ;;
    "")
      log_error "No multiplexer available (install zellij, tmux, or use WezTerm)"
      return 1
      ;;
    *)
      log_error "Unknown multiplexer: $mux (supported: zellij, tmux, wezterm)"
      return 1
      ;;
  esac

  if [[ "$preset" == "llm" ]]; then
    local grid=( ${(s: :)"$(_ws_llm_parse_grid "$grid_spec")"} )
    local total=$(( grid[1] * grid[2] ))
    log_info "Launching '$preset' workspace (${grid[1]}x${grid[2]} = ${total} panes + shell) in $dir ($mux)"
  else
    log_info "Launching '$preset' workspace in $dir ($mux)"
  fi

  case "$mux" in
    "zellij")  _ws_launch_zellij "$preset" "$dir" "$grid_spec" ;;
    "tmux")    _ws_launch_tmux "$preset" "$dir" "$grid_spec" ;;
    "wezterm") _ws_launch_wezterm "$preset" "$dir" "$grid_spec" ;;
  esac
}

# Interactive preset selection
function _ws_select_preset() {
  local choice=$(cat <<EOF | sk --prompt="Workspace> " --ansi --reverse
🖥️  coding      editor + terminal
🚀  full        yazi + editor + lazygit + terminal
👀  review      lazygit + editor
🔍  explore     yazi + editor
🤖  llm         claude x<N> + shell (grid adjustable)
EOF
)
  if [[ -n "$choice" ]]; then
    echo "$choice" | awk '{print $2}'
  fi
}

# Interactive grid selection for llm preset
function _ws_select_grid() {
  local choice=$(cat <<EOF | sk --prompt="Grid> " --ansi --reverse
📐  3x2         6 panes (default)
📐  3x3         9 panes
📐  4x3         12 panes
📐  4x4         16 panes
📐  2x2         4 panes (compact)
✏️  custom      enter custom NxM
EOF
)
  if [[ -z "$choice" ]]; then
    echo ""
    return
  fi

  local selected=$(echo "$choice" | awk '{print $2}')
  if [[ "$selected" == "custom" ]]; then
    echo ""
    read -r "grid?Grid (e.g. 3x3, 5x2): "
    if [[ "$grid" =~ ^[0-9]+x[0-9]+$ ]]; then
      echo "$grid"
    else
      log_error "Invalid grid format: $grid"
      echo ""
    fi
  else
    echo "$selected"
  fi
}

# Interactive directory selection
function _ws_select_dir() {
  local choice=$(cat <<EOF | sk --prompt="Directory> " --ansi --reverse
📂  Current directory ($(pwd))
🎯  Select project
EOF
)
  case "$choice" in
    *"Current directory"*)
      echo "$(pwd)"
      ;;
    *"Select project"*)
      _sk_select_project_internal "Project> "
      ;;
    *)
      echo ""
      ;;
  esac
}

# List available presets
function _ws_list_presets() {
  echo "Available workspace presets:"
  echo "─────────────────────────────────────────────"
  echo "  🖥️  coding      editor + terminal"
  echo "  🚀  full        yazi + editor + lazygit + terminal"
  echo "  👀  review      lazygit + editor"
  echo "  🔍  explore     yazi + editor"
  echo "  🤖  llm         claude x<N> + shell (grid adjustable)"
}

# Help function
function _ws_help() {
  cat <<EOF
Workspace Layout Manager - Dev environment presets for zellij/tmux/wezterm

Commands:
  workspace                                  Interactive menu
  workspace [--mux TYPE] <preset>            Launch preset in current directory
  workspace [--mux TYPE] <preset> <dir>      Launch preset in specified directory
  workspace [--mux TYPE] llm [grid] [dir]    Launch LLM preset with custom grid
  workspace list                             List available presets
  workspace help                             Show this help

Options:
  --mux TYPE    Multiplexer to use: zellij, tmux, wezterm
                If omitted, auto-detects (zellij > tmux priority)
                wezterm uses native pane splitting via wezterm cli

Presets:
  coding      editor + terminal
  full        yazi + editor + lazygit + terminal
  review      lazygit + editor
  explore     yazi + editor
  llm         claude x<N> + shell (grid adjustable)

Grid format (llm only):
  NxM         Explicit cols x rows (e.g. 3x2, 4x3, 5x2)
  N           Total panes, auto-grid (e.g. 9 -> 3x3, 12 -> 4x3)
  (omit)      Default 3x2

Examples:
  workspace                                  # Interactive preset & directory selection
  workspace coding                           # Launch coding layout in current dir
  workspace --mux wezterm coding             # Use WezTerm native panes
  workspace --mux tmux full ~/projects/app   # Force tmux for full layout
  workspace llm                              # Default 3x2 grid (6 claude + shell)
  workspace llm 3x3                          # 3x3 grid (9 claude + shell)
  workspace --mux wezterm llm 4x3            # WezTerm with 4x3 grid
EOF
}

# Interactive mux selection
function _ws_select_mux() {
  local current=$(_mx_detect_current)
  local auto_label="auto"
  [[ -n "$current" ]] && auto_label="auto ($current)"

  local choice=$(cat <<EOF | sk --prompt="Multiplexer> " --ansi --reverse
🔄  $auto_label       auto-detect (default)
🟢  zellij            Zellij multiplexer
🟡  tmux              tmux multiplexer
🔵  wezterm           WezTerm native panes
EOF
)
  if [[ -z "$choice" ]]; then
    echo ""
    return
  fi

  local selected=$(echo "$choice" | awk '{print $2}')
  case "$selected" in
    "$auto_label"|"auto") echo "" ;;  # empty = auto-detect
    *) echo "$selected" ;;
  esac
}

# Interactive main menu
function _ws_main_menu() {
  local preset=$(_ws_select_preset)
  if [[ -z "$preset" ]]; then
    return 0
  fi

  local grid_spec="3x2"
  if [[ "$preset" == "llm" ]]; then
    grid_spec=$(_ws_select_grid)
    if [[ -z "$grid_spec" ]]; then
      return 0
    fi
  fi

  local dir=$(_ws_select_dir)
  if [[ -z "$dir" ]]; then
    return 0
  fi

  local mux=$(_ws_select_mux)
  # mux="" means auto-detect (handled by _ws_launch)

  _ws_launch "$preset" "$dir" "$grid_spec" "$mux"
}

# Main workspace command
function workspace() {
  # Parse --mux flag
  local explicit_mux=""
  if [[ "${1:-}" == "--mux" ]]; then
    explicit_mux="${2:-}"
    if [[ -z "$explicit_mux" ]]; then
      log_error "--mux requires an argument: zellij, tmux, or wezterm"
      return 1
    fi
    shift 2
  fi

  case "${1:-}" in
    "list"|"ls")   _ws_list_presets ;;
    "help"|"h")    _ws_help ;;
    "coding"|"full"|"review"|"explore")
      local preset="$1"
      local dir="${2:-$(pwd)}"
      dir=$(cd "$dir" 2>/dev/null && pwd)
      if [[ ! -d "$dir" ]]; then
        log_error "Directory not found: $dir"
        return 1
      fi
      _ws_launch "$preset" "$dir" "3x2" "$explicit_mux"
      ;;
    "llm")
      local grid_spec="3x2"
      local dir=""
      # Parse optional grid and dir args
      if [[ -n "${2:-}" ]]; then
        if [[ "$2" =~ ^[0-9]+x[0-9]+$ || "$2" =~ ^[0-9]+$ ]]; then
          grid_spec="$2"
          dir="${3:-$(pwd)}"
        else
          dir="$2"
        fi
      else
        dir="$(pwd)"
      fi
      dir=$(cd "$dir" 2>/dev/null && pwd)
      if [[ ! -d "$dir" ]]; then
        log_error "Directory not found: $dir"
        return 1
      fi
      _ws_launch "llm" "$dir" "$grid_spec" "$explicit_mux"
      ;;
    "")            _ws_main_menu ;;
    *)             _ws_help ;;
  esac
}

# -----------------------------------------------------------------------------
# Long-Running Command Notification (preexec/precmd hooks)
# 長時間コマンド完了通知 (preexec/precmd フック)
# -----------------------------------------------------------------------------
# Sends macOS desktop notification + bell when a command takes longer than
# the threshold. Editors/interactive tools are excluded.

_NOTIFY_THRESHOLD=10

# Commands that should never trigger notifications
_NOTIFY_EXCLUDE_PATTERN="^(nvim|vim|vi|less|more|man|ssh|top|htop|btm|btop|zellij|tmux|wezterm|claude|yazi|lazygit|lazydocker|watch|tail -f)"

function _notify_preexec() {
  _CMD_START_TIME=$EPOCHSECONDS
  _CMD_NAME="$1"
}

function _notify_precmd() {
  local elapsed=$(( EPOCHSECONDS - ${_CMD_START_TIME:-$EPOCHSECONDS} ))

  if (( elapsed >= _NOTIFY_THRESHOLD )) && [[ -n "${_CMD_NAME:-}" ]]; then
    # Skip excluded interactive commands
    if [[ ! "$_CMD_NAME" =~ $_NOTIFY_EXCLUDE_PATTERN ]]; then
      # macOS desktop notification
      if has_command osascript; then
        local subtitle="${_CMD_NAME:0:50}"
        osascript -e "display notification \"${elapsed}s で完了\" with title \"Command Finished\" subtitle \"${subtitle}\"" &>/dev/null &!
      fi
      # Bell for terminal handlers (WezTerm bell → toast notification)
      printf '\a'
    fi
  fi

  unset _CMD_START_TIME _CMD_NAME
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec _notify_preexec
add-zsh-hook precmd _notify_precmd

# -----------------------------------------------------------------------------
# claude wrapper (native install at ~/.local/bin, auto-updates)
# -----------------------------------------------------------------------------
# brew-nix の claude (GUI) が PATH で先にいるため、CLI はフルパスで指定する。

claude() {
    local claude_bin="${HOME}/.local/bin/claude"
    if [[ ! -x "$claude_bin" ]]; then
        echo "\033[31mclaude-code not found at ${claude_bin}. Run: curl -fsSL https://claude.ai/install.sh | bash\033[0m" >&2
        return 1
    fi

    # Auto mode: inject --permission-mode auto when persisted flag is on
    local -a extra_flags=()
    local auto_flag="$HOME/.claude/.auto-mode"
    if [[ -f "$auto_flag" ]] && [[ "$(cat "$auto_flag")" == "1" ]]; then
        local has_permission_mode=false
        for arg in "$@"; do
            [[ "$arg" == "--permission-mode" ]] && has_permission_mode=true
        done
        $has_permission_mode || extra_flags+=(--permission-mode auto)
    fi

    CLAUDE_CODE_NO_FLICKER=1 "$claude_bin" "${extra_flags[@]}" "$@"
}

# Toggle auto mode for claude (persisted to ~/.claude/.auto-mode)
claude-auto() {
    local flag="$HOME/.claude/.auto-mode"
    case "${1:-}" in
        on)  echo "1" > "$flag"; echo "Claude auto mode: ON (persisted)" ;;
        off) echo "0" > "$flag"; echo "Claude auto mode: OFF (persisted)" ;;
        *)   local current="0"
             [[ -f "$flag" ]] && current="$(cat "$flag")"
             echo "Auto mode: $([ "$current" = "1" ] && echo ON || echo OFF)"
             echo "Usage: claude-auto {on|off}" ;;
    esac
}

# -----------------------------------------------------------------------------
# Git Utilities (ported from kawarimidoll/dotfiles)
# -----------------------------------------------------------------------------

# git abort - auto-detect in-progress operation and abort
function gabort() {
    local git_dir
    git_dir="$(git rev-parse --git-dir 2>/dev/null)" || { echo "Not a git repo"; return 1; }
    if [[ -f "$git_dir/MERGE_HEAD" ]]; then
        echo "Aborting merge..."
        git merge --abort
    elif [[ -d "$git_dir/rebase-merge" ]] || [[ -d "$git_dir/rebase-apply" ]]; then
        echo "Aborting rebase..."
        git rebase --abort
    elif [[ -f "$git_dir/CHERRY_PICK_HEAD" ]]; then
        echo "Aborting cherry-pick..."
        git cherry-pick --abort
    elif [[ -f "$git_dir/REVERT_HEAD" ]]; then
        echo "Aborting revert..."
        git revert --abort
    elif [[ -f "$git_dir/BISECT_LOG" ]]; then
        echo "Aborting bisect..."
        git bisect reset
    else
        echo "No operation in progress to abort"
        return 1
    fi
}

# git continue - auto-detect in-progress operation and continue
function gcont() {
    local git_dir
    git_dir="$(git rev-parse --git-dir 2>/dev/null)" || { echo "Not a git repo"; return 1; }
    if [[ -f "$git_dir/MERGE_HEAD" ]]; then
        echo "Continuing merge..."
        git commit
    elif [[ -d "$git_dir/rebase-merge" ]] || [[ -d "$git_dir/rebase-apply" ]]; then
        echo "Continuing rebase..."
        git rebase --continue
    elif [[ -f "$git_dir/CHERRY_PICK_HEAD" ]]; then
        echo "Continuing cherry-pick..."
        git cherry-pick --continue
    elif [[ -f "$git_dir/REVERT_HEAD" ]]; then
        echo "Continuing revert..."
        git revert --continue
    elif [[ -f "$git_dir/BISECT_LOG" ]]; then
        echo "Marking bisect good..."
        git bisect good
    else
        echo "No operation in progress to continue"
        return 1
    fi
}

# git push-with-check - safe push with wip detection and force protection
function gpush() {
    local branch
    branch="$(git branch --show-current 2>/dev/null)"
    if [[ -z "$branch" ]]; then
        echo "Not on a branch (detached HEAD?)"
        return 1
    fi

    # Check for wip branch name
    if [[ "$branch" =~ ^wip ]]; then
        echo "\033[0;31m⚠ Branch name starts with 'wip': $branch\033[0m"
        echo -n "Push anyway? [y/N] "
        read -r ans
        [[ "$ans" != "y" ]] && return 1
    fi

    # Check for wip commit messages
    local wip_commits
    wip_commits="$(git log @{u}..HEAD --oneline 2>/dev/null | grep -i '^\S\+ wip' | head -5)"
    if [[ -n "$wip_commits" ]]; then
        echo "\033[0;31m⚠ WIP commits found:\033[0m"
        echo "$wip_commits"
        echo -n "Push anyway? [y/N] "
        read -r ans
        [[ "$ans" != "y" ]] && return 1
    fi

    # Check if behind remote
    git fetch origin "$branch" --quiet 2>/dev/null
    local behind
    behind="$(git rev-list --count HEAD..origin/"$branch" 2>/dev/null)"
    if [[ -n "$behind" ]] && (( behind > 0 )); then
        echo "\033[0;33m⚠ Behind remote by $behind commit(s). Consider pulling first.\033[0m"
    fi

    # Force push protection
    if [[ "$*" == *"--force"* ]] || [[ "$*" == *"-f"* ]]; then
        echo "\033[0;33m→ Replacing --force with --force-with-lease --force-if-includes\033[0m"
        local args=("$@")
        args=("${args[@]/--force/--force-with-lease --force-if-includes}")
        args=("${args[@]/-f/--force-with-lease --force-if-includes}")
        git push "${args[@]}"
    else
        git push "$@"
    fi
}

# git pull-with-check - pull with dependency change detection
function gpull() {
    local before_head
    before_head="$(git rev-parse HEAD 2>/dev/null)"
    git pull "$@" || return $?
    local after_head
    after_head="$(git rev-parse HEAD 2>/dev/null)"
    if [[ "$before_head" != "$after_head" ]]; then
        local changed_files
        changed_files="$(git diff --name-only "$before_head" "$after_head")"
        if echo "$changed_files" | grep -qE 'package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml'; then
            echo "\033[0;31m⚠ package.json / lockfile changed — run npm/pnpm install\033[0m"
        fi
        if echo "$changed_files" | grep -qE 'Gemfile|Gemfile\.lock'; then
            echo "\033[0;31m⚠ Gemfile changed — run bundle install\033[0m"
        fi
        if echo "$changed_files" | grep -qE 'go\.mod|go\.sum'; then
            echo "\033[0;31m⚠ go.mod changed — run go mod download\033[0m"
        fi
        if echo "$changed_files" | grep -qE 'requirements\.txt|pyproject\.toml|uv\.lock'; then
            echo "\033[0;31m⚠ Python deps changed — run uv sync\033[0m"
        fi
        if echo "$changed_files" | grep -qE 'Cargo\.toml|Cargo\.lock'; then
            echo "\033[0;31m⚠ Cargo.toml changed — run cargo build\033[0m"
        fi
        if echo "$changed_files" | grep -qE '\.env'; then
            echo "\033[0;33m⚠ .env file changed — check environment variables\033[0m"
        fi
        if echo "$changed_files" | grep -qE 'compose\.y|docker-compose\.y'; then
            echo "\033[0;33m⚠ Docker compose config changed — rebuild containers\033[0m"
        fi
    fi
}

# fpull - fetch + stash + pull + stash pop
function fpull() {
    git fetch --all --prune || return $?
    local behind
    behind="$(git rev-list --count HEAD..@{u} 2>/dev/null)"
    if [[ -z "$behind" ]] || (( behind == 0 )); then
        echo "Already up to date."
        return 0
    fi
    local has_changes=false
    if ! git diff --quiet || ! git diff --cached --quiet; then
        has_changes=true
        echo "Stashing local changes..."
        git stash push -m "fpull-autostash-$(date +%Y%m%d-%H%M%S)"
    fi
    gpull || return $?
    if [[ "$has_changes" == true ]]; then
        echo "Restoring stashed changes..."
        git stash pop
    fi
}

# git store - interactive stash management with skim
function gstore() {
    if [[ -z "$(git stash list)" ]]; then
        echo "No stashes"
        return 0
    fi
    local selection
    selection="$(git stash list | sk \
        --ansi \
        --no-multi \
        --preview 'echo {} | grep -oE "stash@\{[0-9]+\}" | xargs git stash show -p --color=always' \
        --header 'Enter=apply / Ctrl-x=drop' \
        --expect 'ctrl-x')"
    [[ -z "$selection" ]] && return 0
    local key
    key="$(head -1 <<< "$selection")"
    local entry
    entry="$(tail -1 <<< "$selection")"
    local stash_ref
    stash_ref="$(echo "$entry" | grep -oE 'stash@\{[0-9]+\}')"
    [[ -z "$stash_ref" ]] && return 0
    if [[ "$key" == "ctrl-x" ]]; then
        git stash drop "$stash_ref"
        echo "Dropped $stash_ref"
    else
        git stash apply "$stash_ref"
        echo "Applied $stash_ref"
    fi
}

# -----------------------------------------------------------------------------
# ECC Hook Toggle (chooks)
# -----------------------------------------------------------------------------
# Interactive hook manager for Claude Code ECC profile.
# Toggles hooks via ECC_DISABLED_HOOKS in ~/.claude/settings.json.
# Changes are temporary — `claude-switch ecc` resets to defaults.

_CHOOKS_SETTINGS="$HOME/.claude/settings.json"

_chooks_get_disabled() {
    jq -r '.env.ECC_DISABLED_HOOKS // ""' "$_CHOOKS_SETTINGS" 2>/dev/null
}

_chooks_get_profile() {
    jq -r '.env.ECC_HOOK_PROFILE // "standard"' "$_CHOOKS_SETTINGS" 2>/dev/null
}

_chooks_get_hook_ids() {
    jq -r '
        .hooks | to_entries[] | .value[] | .hooks[]? | .command // empty
    ' "$_CHOOKS_SETTINGS" 2>/dev/null |
    grep 'run-with-flags' |
    sed 's/.*"\([^"]*\)" *"\([^"]*\)" *"\([^"]*\)".*/\1|\3/' |
    sort -u
}

_chooks_get_non_toggleable() {
    jq -r '
        .hooks | to_entries[] | .value[] | .hooks[]? | .command // empty
    ' "$_CHOOKS_SETTINGS" 2>/dev/null |
    grep -v 'run-with-flags' |
    grep -v 'git-guard' |
    grep -v 'tmux-sidebar' |
    grep -v 'rtk-rewrite' |
    sed 's|.*/||; s|"||g; s| ||g' |
    sort -u |
    head -20
}

_chooks_git_guard_disabled() {
    local val
    val="$(jq -r '.env.GIT_GUARD_DISABLED // ""' "$_CHOOKS_SETTINGS" 2>/dev/null)"
    [[ "$val" == "1" ]]
}

_chooks_set_git_guard() {
    local val="$1"
    local tmp
    tmp="$(mktemp)"
    jq --arg v "$val" '.env.GIT_GUARD_DISABLED = $v' "$_CHOOKS_SETTINGS" > "$tmp" && \
        mv "$tmp" "$_CHOOKS_SETTINGS"
}

_chooks_tmux_sidebar_disabled() {
    local val
    val="$(jq -r '.env.TMUX_SIDEBAR_DISABLED // "1"' "$_CHOOKS_SETTINGS" 2>/dev/null)"
    [[ "$val" == "1" ]]
}

_chooks_set_tmux_sidebar() {
    local val="$1"
    local tmp
    tmp="$(mktemp)"
    jq --arg v "$val" '.env.TMUX_SIDEBAR_DISABLED = $v' "$_CHOOKS_SETTINGS" > "$tmp" && \
        mv "$tmp" "$_CHOOKS_SETTINGS"
}

_chooks_rtk_rewrite_disabled() {
    local val
    val="$(jq -r '.env.RTK_REWRITE_DISABLED // "1"' "$_CHOOKS_SETTINGS" 2>/dev/null)"
    [[ "$val" == "1" ]]
}

_chooks_set_rtk_rewrite() {
    local val="$1"
    local tmp
    tmp="$(mktemp)"
    jq --arg v "$val" '.env.RTK_REWRITE_DISABLED = $v' "$_CHOOKS_SETTINGS" > "$tmp" && \
        mv "$tmp" "$_CHOOKS_SETTINGS"
}

_CHOOKS_ENGLISH_COACH_FLAG="$HOME/.claude/.english-coach"

_chooks_english_coach_disabled() {
    [[ ! -f "$_CHOOKS_ENGLISH_COACH_FLAG" ]] || [[ "$(cat "$_CHOOKS_ENGLISH_COACH_FLAG")" != "1" ]]
}

_chooks_set_english_coach() {
    echo "$1" > "$_CHOOKS_ENGLISH_COACH_FLAG"
    # Sync language setting: ON → English, OFF → Japanese
    local lang="Japanese"
    [[ "$1" == "1" ]] && lang="English"
    local tmp
    tmp="$(mktemp)"
    jq --arg l "$lang" '.language = $l' "$_CHOOKS_SETTINGS" > "$tmp" && \
        mv "$tmp" "$_CHOOKS_SETTINGS"
}

_chooks_set_disabled() {
    local new_val="$1"
    local tmp
    tmp="$(mktemp)"
    jq --arg v "$new_val" '.env.ECC_DISABLED_HOOKS = $v' "$_CHOOKS_SETTINGS" > "$tmp" && \
        mv "$tmp" "$_CHOOKS_SETTINGS"
}

function chooks() {
    if [[ ! -f "$_CHOOKS_SETTINGS" ]]; then
        echo "Error: $_CHOOKS_SETTINGS not found. Run claude-switch ecc first."
        return 1
    fi

    local cmd="${1:-toggle}"

    case "$cmd" in
        status)
            _chooks_status
            ;;
        reset)
            _chooks_set_disabled ""
            _chooks_set_git_guard ""
            _chooks_set_english_coach "0"
            _chooks_set_tmux_sidebar "1"
            _chooks_set_rtk_rewrite "1"
            echo "All hooks reset. Takes effect on next Claude Code session."
            ;;
        profile)
            _chooks_profile
            ;;
        toggle|*)
            [[ "$cmd" != "toggle" ]] && shift 2>/dev/null
            _chooks_toggle
            ;;
    esac
}

_chooks_status() {
    local profile disabled
    profile="$(_chooks_get_profile)"
    disabled="$(_chooks_get_disabled)"

    echo "ECC Hook Manager (profile: \033[1;36m$profile\033[0m)"
    echo "────────────────────────────────────────"

    _chooks_get_hook_ids | while IFS='|' read -r id profiles; do
        local state="\033[0;32m[ON] \033[0m"
        if echo ",$disabled," | grep -q ",$id,"; then
            state="\033[0;31m[OFF]\033[0m"
        fi
        printf "  %b %-40s (%s)\n" "$state" "$id" "$profiles"
    done

    # git-guard (toggleable via GIT_GUARD_DISABLED env)
    local gg_state="\033[0;32m[ON] \033[0m"
    if _chooks_git_guard_disabled; then
        gg_state="\033[0;31m[OFF]\033[0m"
    fi
    printf "  %b %-40s (%s)\n" "$gg_state" "git-guard" "commit/push/reset block"

    # english-coach (toggleable via flag file)
    local ec_state="\033[0;32m[ON] \033[0m"
    if _chooks_english_coach_disabled; then
        ec_state="\033[0;31m[OFF]\033[0m"
    fi
    printf "  %b %-40s (%s)\n" "$ec_state" "english-coach" "business English feedback"

    # tmux-sidebar (toggleable via TMUX_SIDEBAR_DISABLED env, default OFF)
    local ts_state="\033[0;32m[ON] \033[0m"
    if _chooks_tmux_sidebar_disabled; then
        ts_state="\033[0;31m[OFF]\033[0m"
    fi
    printf "  %b %-40s (%s)\n" "$ts_state" "tmux-sidebar" "tmux-agent-sidebar plugin hooks"

    # rtk-rewrite (toggleable via RTK_REWRITE_DISABLED env, default OFF)
    local rtk_state="\033[0;32m[ON] \033[0m"
    if _chooks_rtk_rewrite_disabled; then
        rtk_state="\033[0;31m[OFF]\033[0m"
    fi
    printf "  %b %-40s (%s)\n" "$rtk_state" "rtk-rewrite" "RTK token-killer Bash rewriter"

    echo "────────────────────────────────────────"
    _chooks_get_non_toggleable | while read -r name; do
        printf "  \033[0;90m[--] %-40s (always)\033[0m\n" "$name"
    done

    if [[ -n "$disabled" ]]; then
        echo ""
        echo "Disabled: \033[0;31m$disabled\033[0m"
    fi
}

_chooks_toggle() {
    local profile disabled
    profile="$(_chooks_get_profile)"
    disabled="$(_chooks_get_disabled)"

    local lines=()

    # git-guard (env-based toggle)
    local gg_marker="ON "
    if _chooks_git_guard_disabled; then
        gg_marker="OFF"
    fi
    lines+=("[$gg_marker] git-guard (commit/push/reset block)")

    # english-coach (file-based toggle)
    local ec_marker="ON "
    if _chooks_english_coach_disabled; then
        ec_marker="OFF"
    fi
    lines+=("[$ec_marker] english-coach (business English feedback)")

    # tmux-sidebar (env-based toggle, default OFF)
    local ts_marker="ON "
    if _chooks_tmux_sidebar_disabled; then
        ts_marker="OFF"
    fi
    lines+=("[$ts_marker] tmux-sidebar (tmux-agent-sidebar plugin hooks)")

    # rtk-rewrite (env-based toggle, default OFF)
    local rtk_marker="ON "
    if _chooks_rtk_rewrite_disabled; then
        rtk_marker="OFF"
    fi
    lines+=("[$rtk_marker] rtk-rewrite (RTK token-killer Bash rewriter)")

    while IFS='|' read -r id profiles; do
        local marker="ON "
        if echo ",$disabled," | grep -q ",$id,"; then
            marker="OFF"
        fi
        lines+=("[$marker] $id ($profiles)")
    done < <(_chooks_get_hook_ids)

    if [[ ${#lines[@]} -eq 0 ]]; then
        echo "No toggleable hooks found."
        return 1
    fi

    local selected
    selected="$(printf '%s\n' "${lines[@]}" | sk \
        --multi \
        --ansi \
        --header "ECC Hooks (profile: $profile) — select to toggle, Enter to apply" \
        --preview 'echo {}' \
        --no-sort)"

    [[ -z "$selected" ]] && return 0

    local disabled_set=()
    IFS=',' read -rA disabled_set <<< "$disabled"

    while IFS= read -r line; do
        local hook_id
        hook_id="$(echo "$line" | sed 's/^\[...\] \([^ ]*\).*/\1/')"
        local current_state
        current_state="$(echo "$line" | sed 's/^\[\(...\)\].*/\1/')"

        # git-guard uses separate env toggle
        if [[ "$hook_id" == "git-guard" ]]; then
            if [[ "$current_state" == "ON " ]]; then
                _chooks_set_git_guard "1"
                echo "git-guard: \033[0;31mDISABLED\033[0m (commit/push unblocked)"
            else
                _chooks_set_git_guard ""
                echo "git-guard: \033[0;32mENABLED\033[0m (commit/push blocked)"
            fi
            continue
        fi

        # english-coach uses file-based toggle + language sync
        if [[ "$hook_id" == "english-coach" ]]; then
            if [[ "$current_state" == "ON " ]]; then
                _chooks_set_english_coach "0"
                echo "english-coach: \033[0;31mDISABLED\033[0m (language → Japanese)"
            else
                _chooks_set_english_coach "1"
                echo "english-coach: \033[0;32mENABLED\033[0m (language → English)"
            fi
            continue
        fi

        # tmux-sidebar uses separate env toggle (TMUX_SIDEBAR_DISABLED)
        if [[ "$hook_id" == "tmux-sidebar" ]]; then
            if [[ "$current_state" == "ON " ]]; then
                _chooks_set_tmux_sidebar "1"
                echo "tmux-sidebar: \033[0;31mDISABLED\033[0m"
            else
                _chooks_set_tmux_sidebar ""
                echo "tmux-sidebar: \033[0;32mENABLED\033[0m"
            fi
            continue
        fi

        # rtk-rewrite uses separate env toggle (RTK_REWRITE_DISABLED)
        if [[ "$hook_id" == "rtk-rewrite" ]]; then
            if [[ "$current_state" == "ON " ]]; then
                _chooks_set_rtk_rewrite "1"
                echo "rtk-rewrite: \033[0;31mDISABLED\033[0m"
            else
                _chooks_set_rtk_rewrite ""
                echo "rtk-rewrite: \033[0;32mENABLED\033[0m"
            fi
            continue
        fi

        if [[ "$current_state" == "ON " ]]; then
            disabled_set+=("$hook_id")
        else
            disabled_set=("${(@)disabled_set:#$hook_id}")
        fi
    done <<< "$selected"

    local new_disabled
    new_disabled="$(printf '%s\n' "${disabled_set[@]}" | grep -v '^$' | sort -u | paste -sd ',' -)"

    _chooks_set_disabled "$new_disabled"

    echo ""
    echo "Updated. Takes effect on next Claude Code session."
    echo "Disabled: \033[0;31m${new_disabled:-none}\033[0m"
    echo ""
    echo "Run \033[1mchooks reset\033[0m to re-enable all."
    echo "Run \033[1mclaude-switch ecc\033[0m to fully reset from profile."
}

_chooks_profile() {
    local current
    current="$(_chooks_get_profile)"

    local selected
    selected="$(printf 'minimal\nstandard\nstrict\n' | sk \
        --no-multi \
        --header "Current profile: $current" \
        --preview 'case {} in
            minimal) echo "Only critical hooks (session-end, cost-tracker)" ;;
            standard) echo "Default: most hooks enabled, excluding strict-only (format, typecheck, git-push-reminder)" ;;
            strict) echo "All hooks: formatting, type checking, git push safety" ;;
        esac')"

    [[ -z "$selected" ]] && return 0

    local tmp
    tmp="$(mktemp)"
    jq --arg v "$selected" '.env.ECC_HOOK_PROFILE = $v' "$_CHOOKS_SETTINGS" > "$tmp" && \
        mv "$tmp" "$_CHOOKS_SETTINGS"

    echo "Profile changed: \033[1;36m$current\033[0m → \033[1;36m$selected\033[0m"
    echo "Takes effect on next Claude Code session."
}
