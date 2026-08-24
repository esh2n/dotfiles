{ pkgs, ... }: {
  home.packages = with pkgs; [
    # Shell
    zsh
    zsh-autosuggestions
    zsh-completions
    zsh-syntax-highlighting
    starship # prompt fallback (see integrations.zsh)
    capsule  # primary zsh prompt (flake input, see core/nix/flake.nix)

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
    codebase-memory-mcp
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

    # Language servers (discovered and lazily started by OMP/editors)
    typescript-language-server
    zls
    bash-language-server
    nixd
    lua-language-server
    vscode-langservers-extracted # HTML, CSS, JSON, ESLint
    yaml-language-server
    marksman
    terraform-ls
    biome
    tailwindcss-language-server
    astro-language-server

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
    # Overlay
    cargo-compete
    crit
    go-mockgen
    go-protoc-gen-go
    spanner-cli
    spanner-dump

  ]
  ++ (with pkgs.brewCasks; [
    wezterm
    ghostty
    cursor
    visual-studio-code
    zed
    yaak
  ]);
}
