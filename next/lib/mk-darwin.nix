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
    ../system/darwin/browsers.nix

    {
      nixpkgs.overlays = import ./overlays.nix { inherit inputs system; };
      nixpkgs.config.allowUnfree = true;
    }

    home-manager.darwinModules.home-manager
    {
      home-manager.useGlobalPkgs = true;
      home-manager.useUserPackages = true;
      # Files the old layout left in place are kept as <name>.pre-next, the
      # same extension bootstrap.sh gives home-manager on Linux.
      home-manager.backupFileExtension = "pre-next";
      home-manager.users.${username} = {
        imports = [
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
          ../home/shared/codebase-memory
          ../home/shared/theme
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
          ../home/shared/llm-ledger
          ../home/darwin/apps
          ../home/darwin/tmux
          ../home/darwin/browsers
          ../home/darwin/sketchybar
          ../home/shared/jj
          ../home/shared/zed
          ../home/shared/capsule
          ../home/shared/tailscale
          ../home/darwin/herdr
          ../home/darwin/aerospace
          ../home/darwin/hammerspoon
          ../home/darwin/omniwm
          ../home/darwin/paneru
          ../home/darwin/mado
          ../home/darwin/lmstudio
          ../home/darwin/ghostty
          ../home/darwin/borders
          ../home/shared/wezterm
          ../home/darwin/configs
          ../home/shared/packages
          ../home/darwin/packages.nix
        ];
      };
    }
  ];
}
