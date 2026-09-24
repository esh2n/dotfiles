# Builds standalone home-manager for Linux (Omarchy): no system layer — the
# OS is Omarchy's — only the user's home.
{ inputs, facts }:
let
  system = "x86_64-linux";
  pkgs = import inputs.nixpkgs {
    inherit system;
    overlays = import ./overlays.nix { inherit inputs system; };
    config.allowUnfree = true;
  };
in
inputs.home-manager.lib.homeManagerConfiguration {
  inherit pkgs;
  modules = [
    { _module.args.facts = facts; }
    ../roles
    ../home/shared/base.nix
    ../home/shared/lib
    ../home/shared/zsh
    ../home/shared/tig
    ../home/shared/crit
    ../home/shared/bin
    ../home/shared/configs
    ../home/shared/templated
    ../home/shared/serena
    ../home/shared/harness
    ../home/shared/nvim
    ../home/shared/git
    ../home/shared/gh
    ../home/shared/mise
    ../home/shared/zellij
    ../home/shared/cargo-tools
    ./mk-service.nix
    ./mk-setup.nix
    ../home/shared/services
    ../home/linux/git
    ../home/shared/packages/cli.nix
    ../home/shared/packages/lsp.nix
  ];
}
