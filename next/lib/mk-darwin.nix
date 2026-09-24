# Builds the macOS system: nix-darwin with home-manager as its module.
# Home modules live in next/home; the system layer (darwin.nix and the
# Homebrew lists) is still referenced from the current layout until it moves to
# next/system. tests/next/mac-parity.bats keeps both layouts configuring the
# same Mac.
{ inputs, facts }:
let
  inherit (inputs) nix-darwin home-manager;
  inherit (facts) username;
  system = "aarch64-darwin";
  legacy = ../../core/nix;
  domains = ../../domains;
in
nix-darwin.lib.darwinSystem {
  inherit system;
  specialArgs = { inherit username; };
  modules = [
    # Facts reach modules as an overridable module argument, not specialArgs
    # (the NixOS manual keeps specialArgs for what imports need).
    { _module.args.facts = facts; }
    ../roles/options.nix

    (legacy + "/darwin.nix")

    (domains + "/dev/packages/homebrew.nix")
    (domains + "/workspace/packages/homebrew.nix")
    (domains + "/creative/packages/homebrew.nix")
    (domains + "/infra/packages/homebrew.nix")

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
          ../home/shared/packages/cli.nix
          ../home/shared/packages/lsp.nix
          ../home/darwin/packages.nix
        ];
      };
    }
  ];
}
