# Keybindings Configuration

# Use emacs mode by default
bindkey -e

# History search
bindkey '^r' history-incremental-search-backward

# Standard navigation
bindkey "^[[1;5C" forward-word
bindkey "^[[1;5D" backward-word

# Fuzzy Finder Keybindings (sk)
if [[ $- == *i* ]]; then
  if [[ -o zle ]]; then
    # Register widgets
    zle -N sk_select_history
    zle -N sk_select_src
    zle -N sk_select_project_file
    zle -N sk_change_directory
    zle -N sk_select_file_within_project
    zle -N sk_select_file_below_pwd

    # Standard bindings
    bindkey '^r' sk_select_history
    bindkey '^g' sk_change_directory
    bindkey '^f' sk_select_file_within_project
    bindkey '^b' sk_select_file_below_pwd
    bindkey '^o' sk_select_project_file

    # Project selection (Ctrl+])
    bindkey '^]' sk_select_src
    
    # VSCode specific
    if [[ "$TERM_PROGRAM" == "vscode" ]]; then
      bindkey '^\' sk_select_src
      bindkey '^p' sk_select_src
    fi
  fi
fi
