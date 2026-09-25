# Builds standalone home-manager for Linux (Omarchy): no system layer — the
# OS is Omarchy's — only the user's home.
{ inputs, facts }:
let
  system = "x86_64-linux";
  pkgs = import inputs.nixpkgs {
    inherit system;
    overlays = import ./overlays.nix { inherit inputs system; };
    config = {
      allowUnfree = true;
      # NVIDIA's driver license is accepted by the owner, per machine, in the
      # roles file ("nvidia": {"acceptLicense": true}); never here.
      nvidia.acceptLicense = facts.nvidia != null && facts.nvidia.acceptLicense;
    };
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
    ../home/shared/dotctl
    ../home/shared/nvim
    ../home/shared/git
    ../home/shared/gh
    ../home/shared/mise
    ../home/shared/zellij
    ../home/shared/cargo-tools
    ./mk-service.nix
    ./mk-setup.nix
    ../home/shared/services
    ../home/shared/home-llm
    ../home/linux/git
    ../home/linux/llama-server
    ../home/shared/packages/cli.nix
    ../home/shared/packages/lsp.nix
  ];
}
