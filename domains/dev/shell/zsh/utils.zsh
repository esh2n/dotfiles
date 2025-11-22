# Utility Functions for Zsh

# Load core library
if [[ -n "$DOTFILES_ROOT" ]]; then
  source "$DOTFILES_ROOT/core/utils/common.sh"
elif [[ -f "$HOME/dotfiles/dotfiles/core/utils/common.sh" ]]; then
  source "$HOME/dotfiles/dotfiles/core/utils/common.sh"
fi

# Zsh-specific wrappers and utilities

# Quick directory backup
function backup_and_cd() {
  local target="$1"
  if [[ -d "$target" ]]; then
    pushd "$target" > /dev/null
  else
    log_error "Directory does not exist: $target"
    return 1
  fi
}

# Smart extract
function extract() {
  if [ -f "$1" ]; then
    local filename=$(basename "$1")
    case "$1" in
      *.tar.bz2)   run_with_spinner "Extracting $filename" tar xjf "$1"     ;;
      *.tar.gz)    run_with_spinner "Extracting $filename" tar xzf "$1"     ;;
      *.bz2)       run_with_spinner "Extracting $filename" bunzip2 "$1"     ;;
      *.rar)       run_with_spinner "Extracting $filename" unrar x "$1"     ;;
      *.gz)        run_with_spinner "Extracting $filename" gunzip "$1"      ;;
      *.tar)       run_with_spinner "Extracting $filename" tar xf "$1"      ;;
      *.tbz2)      run_with_spinner "Extracting $filename" tar xjf "$1"     ;;
      *.tgz)       run_with_spinner "Extracting $filename" tar xzf "$1"     ;;
      *.zip)       run_with_spinner "Extracting $filename" unzip "$1"       ;;
      *.Z)         run_with_spinner "Extracting $filename" uncompress "$1"  ;;
      *.7z)        run_with_spinner "Extracting $filename" 7z x "$1"        ;;
      *)           log_error "Cannot extract '$1': Unknown format" ;;
    esac
  else
    log_error "'$1' is not a valid file"
  fi
}

# Quick file size
function fsize() {
  if [[ -n "$1" ]]; then
    du -sh "$1"
  else
    du -sh ./*
  fi
}
