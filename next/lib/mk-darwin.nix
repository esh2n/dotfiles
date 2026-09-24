# Builds the macOS system: nix-darwin with home-manager as its module.
# The system layer lives in next/system/darwin, the user layer in next/home.
# tests/next/mac-parity.bats keeps this configuring the same Mac as the
# current layout (core/nix) until the switch.
{ inputs, facts }:
let
  inherit (inputs) nix-darwin home-manager;
  inherit (facts) username;
  system = "aarch64-darwin";
in
nix-darwin.lib.darwinSystem {
  inherit system;
  modules = [
    # Facts reach modules as an overridable module argument, not specialArgs
    # (the NixOS manual keeps specialArgs for what imports need).
    { _module.args.facts = facts; }
    ../roles/options.nix

    ../system/darwin/base.nix
    ../system/darwin/defaults.nix
    ../system/darwin/homebrew.nix

    {
      nixpkgs.overlays = import ./overlays.nix { inherit inputs system; };
      nixpkgs.config.allowUnfree = true;
    }

    home-manager.darwinModules.home-manager
    {
      home-manager.useGlobalPkgs = true;
      home-manager.useUserPackages = true;
      home-manager.users.${username} = {
        imports = [
          { _module.args.facts = facts; }
          ../roles/options.nix
          ../home/shared/base.nix
          ../home/shared/lib
          ../home/shared/zsh
          ../home/shared/tig
          ../home/shared/crit
          ../home/shared/bin
          ../home/darwin/bin
          ../home/shared/configs
          ../home/shared/templated
          ../home/darwin/configs
          ../home/shared/packages/cli.nix
          ../home/shared/packages/lsp.nix
          ../home/darwin/packages.nix
        ];
      };
    }
  ];
}
