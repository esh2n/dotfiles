{ pkgs, ... }:
let
  # Node.js packages via node2nix
  # Generate with: cd node2nix && npm install --package-lock-only && nix-shell -p node2nix --run 'node2nix -l package-lock.json'
  node2nixPackages = import ./node2nix { inherit pkgs; };
in {
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

    # ===========================================
    # Rust Tools (from cargo.txt)
    # ===========================================
    cargo-generate
    # cargo-compete - not in nixpkgs, use: cargo install cargo-compete
    # pacifica - custom tool, use: cargo install --git https://github.com/serinuntius/pacifica.git

    # ===========================================
    # Go Tools (from go.txt)
    # ===========================================
    gotools        # includes goimports
    gopls
    go-mockgen     # mockgen
    delve          # dlv
    go-staticcheck # staticcheck
    protoc-gen-go
    protoc-gen-go-grpc
    # spanner-cli - not in nixpkgs, use: go install cloud.google.com/go/spanner/spanner-cli@latest
    # spanner-dump - not in nixpkgs, use: go install github.com/cloudspannerecosystem/spanner-dump@latest

    # ===========================================
    # Ruby Tools (from gem.txt)
    # ===========================================
    bundler
    cocoapods
    # xcodeproj - not in nixpkgs, use: gem install xcodeproj
    # test-unit - not in nixpkgs, use: gem install test-unit
    # rdoc - not in nixpkgs, use: gem install rdoc
    # activesupport - not in nixpkgs, use: gem install activesupport
    # i18n - not in nixpkgs, use: gem install i18n
  ] ++ (with node2nixPackages; [
    # ===========================================
    # Node.js Tools (via node2nix)
    # ===========================================
    pnpm
    yarn
    firebase-tools
    wrangler
    aicommits
    neovim
  ]);

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
