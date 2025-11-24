#!/usr/bin/env bash

# Interactive Utilities
# Provides common functions for interactive selection using sk (skim)

# Source common utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# -----------------------------------------------------------------------------
# Project Selection
# -----------------------------------------------------------------------------

# Select a project interactively using ghq or pacifica
# Args:
#   $1: prompt text (optional, default: "Project> ")
# Returns:
#   Selected project path or empty string if cancelled
function select_project_interactive() {
  local prompt="${1:-Project> }"
  local folder_icon=$'\uf07c '
  local selected_dir=""

  if has_command pacifica; then
    local pacifica_output
    pacifica_output=$(pacifica 2>/dev/null | grep "/github\.com/" || true)
    if [[ -n "$pacifica_output" ]]; then
      selected_dir=$(printf '%s\n' "$pacifica_output" | sed "s#^#$folder_icon#" | \
        sk --ansi --reverse --height '100%' --prompt "$prompt" --query "${LBUFFER:-}")
      selected_dir=${selected_dir#"$folder_icon"}
    fi
  else
    if has_command ghq; then
      selected_dir=$(ghq list -p | sk --ansi --reverse --height '60%' --prompt "$prompt" --query "${LBUFFER:-}")
    fi
  fi

  echo "$selected_dir"
}

# -----------------------------------------------------------------------------
# File Selection
# -----------------------------------------------------------------------------

# Select a file interactively from a given path
# Args:
#   $1: base path to search in
#   $2: prompt text (optional, default: "File> ")
#   $3: preview command (optional, default: uses bat if available)
# Returns:
#   Selected file path or empty string if cancelled
function select_file_interactive() {
  local base_path="$1"
  local prompt="${2:-File> }"
  local preview_cmd="${3:-}"

  if [[ -z "$base_path" ]]; then
    log_error "Base path is required for file selection"
    return 1
  fi

  # Set default preview command if not provided
  if [[ -z "$preview_cmd" ]] && has_command bat; then
    preview_cmd='bat --style=numbers --color=always {}'
  elif [[ -z "$preview_cmd" ]]; then
    preview_cmd='cat {}'
  fi

  local selected_file
  if has_command fd; then
    selected_file=$(fd --type f --hidden --exclude .git . "$base_path" | \
      sk --ansi --reverse --height '60%' --prompt "$prompt" \
      --preview "$preview_cmd")
  else
    selected_file=$(find "$base_path" -type f 2>/dev/null | \
      sk --ansi --reverse --height '60%' --prompt "$prompt" \
      --preview "$preview_cmd")
  fi

  echo "$selected_file"
}

# -----------------------------------------------------------------------------
# Directory Selection
# -----------------------------------------------------------------------------

# Select a directory interactively from a given path
# Args:
#   $1: base path to search in (optional, default: current directory)
#   $2: prompt text (optional, default: "Directory> ")
# Returns:
#   Selected directory path or empty string if cancelled
function select_directory_interactive() {
  local base_path="${1:-.}"
  local prompt="${2:-Directory> }"

  local selected_dir
  if has_command fd; then
    selected_dir=$(fd --type d --hidden --exclude .git . "$base_path" | \
      sk --ansi --reverse --height '60%' --prompt "$prompt")
  else
    selected_dir=$(find "$base_path" -type d 2>/dev/null | \
      sk --ansi --reverse --height '60%' --prompt "$prompt")
  fi

  echo "$selected_dir"
}

# -----------------------------------------------------------------------------
# Branch Selection (Git)
# -----------------------------------------------------------------------------

# Select a git branch interactively (excluding current branch)
# Args:
#   $1: include remote branches (true/false, default: false)
#   $2: prompt text (optional, default: "Branch> ")
# Returns:
#   Selected branch name or empty string if cancelled
function select_branch_interactive() {
  local include_remote="${1:-false}"
  local prompt="${2:-Branch> }"

  if ! git rev-parse --git-dir > /dev/null 2>&1; then
    log_error "Not in a git repository"
    return 1
  fi

  local branch_list
  if [[ "$include_remote" == "true" ]]; then
    branch_list=$(git branch -a | grep -v "^\*" | sed 's/remotes\/origin\///' | sort -u)
  else
    branch_list=$(git branch | grep -v "^\*")
  fi

  echo "$branch_list" | sk --ansi --reverse --height '50%' --prompt "$prompt" | xargs
}

# -----------------------------------------------------------------------------
# History Selection
# -----------------------------------------------------------------------------

# Select from command history interactively
# Args:
#   $1: prompt text (optional, default: "History> ")
#   $2: max entries to show (optional, default: all)
# Returns:
#   Selected command or empty string if cancelled
function select_history_interactive() {
  local prompt="${1:-History> }"
  local max_entries="${2:-}"

  local history_cmd
  if [[ -n "$max_entries" ]]; then
    history_cmd="history -n -r 1 | head -n $max_entries"
  else
    history_cmd="history -n -r 1"
  fi

  eval "$history_cmd" | sk --ansi --reverse --height '50%' --prompt "$prompt" --query "${LBUFFER:-}"
}

# -----------------------------------------------------------------------------
# Process Selection
# -----------------------------------------------------------------------------

# Select a running process interactively
# Args:
#   $1: prompt text (optional, default: "Process> ")
# Returns:
#   Selected process PID or empty string if cancelled
function select_process_interactive() {
  local prompt="${1:-Process> }"

  ps aux | sk --ansi --reverse --height '60%' --prompt "$prompt" \
    --header-lines=1 | awk '{print $2}'
}

# -----------------------------------------------------------------------------
# Generic List Selection
# -----------------------------------------------------------------------------

# Select from a list of items interactively
# Args:
#   $1: items (newline separated string or stdin)
#   $2: prompt text (optional, default: "Select> ")
#   $3: height percentage (optional, default: "50%")
# Returns:
#   Selected item or empty string if cancelled
function select_from_list_interactive() {
  local items="${1:-$(cat)}"
  local prompt="${2:-Select> }"
  local height="${3:-50%}"

  echo "$items" | sk --ansi --reverse --height "$height" --prompt "$prompt"
}