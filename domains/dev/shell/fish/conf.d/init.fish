# Fish Init for Dev Domain

# Theme environment (fzf/bat/ripgrep colors)
set -l theme_env "$DOTFILES_ROOT/domains/system/config/theme-env/current.fish"
if test -z "$DOTFILES_ROOT"
    set theme_env "$HOME/dotfiles/domains/system/config/theme-env/current.fish"
end
test -f $theme_env; and source $theme_env

# Source common aliases
source (dirname (status filename))/../common/aliases.sh

# Fish specific aliases or overrides
alias rs 'exec fish'
alias vz 'vim ~/.config/fish/config.fish'

# Complex aliases converted to Fish syntax or functions
# Note: Fish handles pipes in aliases fine usually, but complex ones might need functions.
# For now, we'll try to keep them as aliases if possible, or define them in functions/

# Architecture
alias x64 'exec arch -x86_64 fish'
alias a64 'exec arch -arm64e fish'

# Utilities
if test (uname) = "Darwin"
  alias date 'gdate'
end

# Load functions
# Fish autoloads functions from the functions/ directory automatically if it's in $fish_function_path
# We need to ensure that directory is added to the path in the main config.fish loader
