if status is-interactive
    # Initialize starship prompt
    starship init fish | source

    # Initialize zoxide (smarter cd)
    zoxide init fish | source

    # Initialize direnv
    direnv hook fish | source

    # Initialize mise
    mise activate fish | source

    # Set default editor
    set -gx EDITOR nvim

    # Set language
    set -gx LANG en_US.UTF-8

    # Add local bin to PATH
    fish_add_path $HOME/.local/bin

    # Use eza instead of ls
    if type -q eza
        alias ls='eza --icons'
        alias ll='eza -l --icons'
        alias la='eza -la --icons'
        alias lt='eza --tree --icons'
    end

    # Use bat instead of cat
    if type -q bat
        alias cat='bat'
    end

    # Use modern tools
    alias grep='rg'
    alias find='fd'
    alias top='htop'
end 