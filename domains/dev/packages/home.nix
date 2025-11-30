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
    tree
    atuin
    yazi
    vivid
    btop
    mise
    jq
    yq

    # Git
    git
    gh
    delta
    git-lfs
    ghq
    lazygit
    tig

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

    # node2nix (firebase-tools, wrangler, aicommits)
    node2nix-packages
  ]
  ++ (with pkgs.brewCasks; [
    wezterm
    ghostty
    cursor
    claude
    visual-studio-code
    zed
    yaak
  ]);
}
