# Directory management
function mkdir_and_change_directory() {
  if [ $# -eq 0 ]; then
    echo "❌ Error: Directory name required"
    echo "Usage: mkcd <directory>"
    return 1
  fi

  for dir in "$@"; do
    if [ -d "$dir" ]; then
      echo "⚠️  Directory '$dir' already exists"
      echo "➡️  Change to this directory? [Y/n]: "
      read -r response
      case "$response" in
        [nN]*)
          continue
          ;;
        *)
          cd "$dir" || return 1
          echo "✅ Changed to '$dir'"
          return 0
          ;;
      esac
    else
      if mkdir -p "$dir" 2>/dev/null; then
        echo "✨ Created directory '$dir'"
        cd "$dir" || return 1
        echo "✅ Changed to '$dir'"
        return 0
      else
        echo "❌ Error: Failed to create '$dir'"
        echo "💡 Check directory permissions"
        return 1
      fi
    fi
  done
}

# Vim mode indicator
function zle-line-init zle-keymap-select {
  RPS1="${${KEYMAP/vicmd/-- NORMAL --}/(main|viins)/-- INSERT --}"
  RPS2=${RPS1}
  zle reset-prompt
}

# Fuzzy finder functions
function sk_select_history() {
  local tac
  if which tac > /dev/null; then
    tac="tac"
  else
    tac="tail -r"
  fi
  BUFFER=$(fc -l -n 1 | eval $tac | sk --ansi --reverse --height '50%' --query "$LBUFFER")
  CURSOR=$#BUFFER
  zle clear-screen
}

function sk_select_src () {
  local selected_dir=$(pacifica | sk --ansi --reverse --height '50%' --query "$LBUFFER")
  if [ -n "$selected_dir" ]; then
    BUFFER="cd ${selected_dir}"
    zle accept-line
  fi
  zle clear-screen
}

function sk_change_directory() {
  local selected_dir=$(zoxide query -l | sk --ansi --reverse --height '50%')
  if [ -n "$selected_dir" ]; then
    BUFFER="cd ${selected_dir}"
    zle accept-line
  fi
}

function sk_select_file_below_pwd() {
  if [ ! `pwd | grep "$(ghq root)"` ]; then
    echo "you are not in ghq path"
    zle accept-line
    return 0
  fi
  local selected_path="\
    $(fd --type f --hidden --exclude .git --exclude node_modules --exclude vendor | \
    sk --ansi --reverse --height '50%' --preview 'bat --style=numbers --color=always {}')"
  if [ -n "$selected_path" ]; then
    go_to "$selected_path"
  fi
}

function sk_select_file_within_project() {
  local base_path=$(pwd | grep -o "$(ghq list -p)")
  if [ -z $base_path ]; then
    echo "you are not in ghq project"
    zle accept-line
    return 0
  fi
  local paths="\
    $(fd --type f --hidden --exclude .git --exclude node_modules --exclude vendor . "$base_path")"
  local selected_path="$(echo "(root)\n$paths" | sk --ansi --reverse --height '50%' --preview 'bat --style=numbers --color=always {}')"
  if [ -n "$selected_path" ]; then
    if [[ "$selected_path" = "(root)" ]]; then
      go_to $base_path
      return 0
    fi
    go_to "$selected_path"
  fi
}

function go_to() {
  if [ -f "$1" ]; then
    nvim "$1"
    dir_path=$(dirname "$1")
    BUFFER="cd \"$dir_path\""
  elif [ -d "$1" ]; then
    BUFFER="cd \"$1\""
  else
    echo "selected path is neither file nor directory"
  fi
  zle accept-line
}

function sk_edit_file() {
  local selected_path=$(fd --type f --hidden --exclude .git | sk --ansi --reverse --height '50%' --preview 'bat --style=numbers --color=always {}')
  if [ -n "$selected_path" ]; then
    nvim "$selected_path"
  fi
}

# Git branch selection
function sk_select_branch_except_current() {
  git branch -a --sort=-authordate | \
    grep -v -e '->' -e '*' | \
    sed "s/remotes\/origin\///g" | \
    awk '!a[$0]++' | \
    sk --ansi --reverse --height '50%'
}

function sk_select_local_branch_except_current() {
  git branch | \
    grep -v -e '->' -e '*' | \
    sed "s/remotes\/origin\///g" | \
    awk '!a[$0]++' | \
    sk --ansi --reverse --height '50%'
}

function sk_select_branch_all() {
  git branch -a --sort=-authordate | \
    grep -v -e '->' | \
    sed "s/remotes\/origin\///g" | \
    sed "s/\*/ /g" | \
    awk '!a[$0]++' | \
    sk --ansi --reverse --height '50%'
}

# Tmux
function precmd() {
  if [ ! -z $TMUX ]; then
    tmux refresh-client -S
  fi
}

# Font installation
function nerd_fonts() {
  git clone --branch=master --depth 1 https://github.com/ryanoasis/nerd-fonts.git
  cd nerd-fonts
  ./install.sh $1
  cd ..
  rm -rf nerd-fonts
}

# GCloud functions
function gcloud-activate() {
  name="$1"
  project="$2"
  echo "gcloud config configurations activate \"${name}\""
  gcloud config configurations activate "${name}"
}

function gx-complete() {
  _values $(gcloud config configurations list | awk '{print $1}')
}

function gx() {
  name="$1"
  if [ -z "$name" ]; then
    line=$(gcloud config configurations list | sk --ansi --reverse --height '50%')
    name=$(echo "${line}" | awk '{print $1}')
  else
    line=$(gcloud config configurations list | grep "$name")
  fi
  project=$(echo "${line}" | awk '{print $4}')
  gcloud-activate "${name}" "${project}"
}
compdef gx-complete gx
