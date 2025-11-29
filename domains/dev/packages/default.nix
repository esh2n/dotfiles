{ pkgs, ... }: {
  home.packages = with pkgs; [
    # Shell
    zsh
    zsh-autosuggestions
    zsh-completions
    zsh-syntax-highlighting
    starship

    # Multiplexers
    tmux
    zellij

    # Modern CLI Tools
    bat
    eza
    fd
    ripgrep
    zoxide
    skim  # sk
    tree
    atuin
    yazi
    vivid
    btop
    thefuck

    # Version Management
    mise

    # Git Ecosystem
    git
    gh
    delta  # git-delta
    git-lfs
    ghq
    lazygit
    tig

    # DevOps & Cloud
    docker
    kubectl  # kubernetes-cli
    kubernetes-helm  # helm
    k9s
    terraform
    awscli2  # awscli

    # Utilities
    jq
    yq

    # Editor
    neovim
    tree-sitter
    universal-ctags  # ctags

    # Database
    mysql84  # mysql
    redis

    # AI/ML
    ollama
  ];

  # GUI Apps (Homebrew casks)
  homebrew.casks = [
    # Terminals
    "wezterm"
    "ghostty"
    "warp"

    # AI Coding
    "cursor"
    "claude"

    # Editors
    "visual-studio-code"
    "zed"

    # API Testing
    "yaak"
  ];
}

