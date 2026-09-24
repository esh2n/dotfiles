# Builds the macOS system: nix-darwin with home-manager as its module.
# Modules still live in the current layout and are referenced from here until
# they move into next/system and next/home one by one (each move must keep
# tests/next/equivalence.bats green).
{ inputs, facts }:
let
  inherit (inputs)
    nix-darwin
    home-manager
    brew-nix
    crit
    capsule
    ;
  inherit (facts) username;
  system = "aarch64-darwin";
  legacy = ../../core/nix;
  domains = ../../domains;
in
nix-darwin.lib.darwinSystem {
  inherit system;
  specialArgs = { inherit username; };
  modules = [
    (legacy + "/darwin.nix")

    (domains + "/dev/packages/homebrew.nix")
    (domains + "/workspace/packages/homebrew.nix")
    (domains + "/creative/packages/homebrew.nix")
    (domains + "/infra/packages/homebrew.nix")

    {
      nixpkgs.overlays = [
        (import (legacy + "/overlays.nix"))
        (final: prev: { crit = crit.packages.${system}.default; })
        (final: prev: { capsule = capsule.packages.${system}.default; })
        brew-nix.overlays.default
      ];
      nixpkgs.config.allowUnfree = true;
    }

    home-manager.darwinModules.home-manager
    {
      home-manager.useGlobalPkgs = true;
      home-manager.useUserPackages = true;
      home-manager.extraSpecialArgs = { inherit username; };
      home-manager.users.${username} = {
        imports = [
          (legacy + "/home.nix")
          (domains + "/dev/packages/home.nix")
          (domains + "/workspace/packages/home.nix")
          (domains + "/creative/packages/home.nix")
          (domains + "/infra/packages/home.nix")
          (domains + "/system/packages/home.nix")
        ];
      };
    }
  ];
}
