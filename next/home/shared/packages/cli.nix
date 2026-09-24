# Command-line tools installed on every platform.
{ pkgs, ... }:
{
  home.packages = with pkgs; [
    # Shell
    zsh
    zsh-autosuggestions
    zsh-completions
    zsh-syntax-highlighting
    starship # prompt fallback (see integrations.zsh)
    capsule # primary zsh prompt (flake input)

    # Multiplexers
    tmux
    zellij

    # Everyday CLI
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
    jq
    yq
    less
    coreutils
    moreutils
    findutils
    gnused
    gnugrep
    trash-cli
    curl
    wget
    openssh
    _1password-cli

    # Git
    git
    gh
    wrangler # Cloudflare Workers CLI (artifact deploy/login)
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

    # Media / graphics
    ffmpeg
    imagemagick
    graphviz
    yt-dlp
    lessc # userstyles templates

    # Databases
    mysql84
    redis

    # Language tooling
    cargo-generate
    gotools
    gopls
    delve
    protobuf
    bundler
    pnpm
    yarn

    # Built by this repo (overlays)
    cargo-compete
    crit
    go-mockgen
    go-protoc-gen-go
    spanner-cli
    spanner-dump
  ];
}
