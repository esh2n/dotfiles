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

    # CLI
    bat
    eza
    fd
    ripgrep
    zoxide
    skim
    fzf
    tree
    atuin
    yazi
    vivid
    btop
    mise
    jq
    yq
    less
    coreutils
    findutils
    gnused
    gnugrep

    # Git
    git
    gh
    delta
    git-lfs
    ghq
    lazygit
    tig
    jujutsu
    lazyjj
    gnupg

    # DevOps
    docker
    kubectl
    kubernetes-helm
    k9s
    terraform
    awscli2

    # Editor
    neovim
    tree-sitter
    universal-ctags

    # Media / Graphics
    ffmpeg
    imagemagick
    graphviz

    # System
    mas
    nowplaying-cli

    # Database
    mysql84
    redis

    # Languages
    cargo-generate
    gotools
    gopls
    delve
    protobuf
    bundler
    cocoapods
    pnpm
    yarn
    nodePackages.neovim

    # Overlay
    cargo-compete
    go-mockgen
    go-protoc-gen-go
    spanner-cli
    spanner-dump

    # node2nix packages
    claude-code
    aicommits
  ]
  ++ (with pkgs.brewCasks; [
    wezterm
    ghostty
    cursor
    claude  # GUI version - CLI is available as 'claude-cli'
    visual-studio-code
    zed
    yaak
  ]);
}
