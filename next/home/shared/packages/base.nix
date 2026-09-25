# Command-line tools every machine gets (the base role, always on).
{
  config,
  lib,
  pkgs,
  ...
}:
{
  home.packages = lib.mkIf config.dotfiles.packages.base.enable (
    with pkgs;
    [
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
      delta
      git-lfs
      ghq
      lazygit
      tig
      jujutsu
      lazyjj
      gnupg

      # Editor
      neovim
      tree-sitter
      universal-ctags

    ]
  );
}
