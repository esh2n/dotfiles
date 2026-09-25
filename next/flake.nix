{
  description = "esh2n's dotfiles (next layout, grown beside core/nix until it builds the same system)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-darwin = {
      url = "github:LnL7/nix-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    brew-nix = {
      url = "github:BatteredBunny/brew-nix";
      inputs.brew-api.follows = "brew-api";
      inputs.nix-darwin.follows = "nix-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    brew-api = {
      url = "github:BatteredBunny/brew-api";
      flake = false;
    };
    crit = {
      url = "github:tomasz-tomczyk/crit";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # zsh prompt daemon — installed via flake because the author's brew
    # formula points at the .sha256 asset instead of the tarball (v0.4.0)
    # llama-server for the gpu role (Omarchy + RTX 3090 Ti), CUDA build from
    # llama.cpp's own flake; the lock pins the commit
    # (rules/decisions/2026-09-24-home-llm-second-host-omarchy-llama-server.md).
    # Its own nixpkgs, not ours: its CUDA package names (cccl, ...) follow the
    # nixpkgs its CI builds with.
    llama-cpp.url = "github:ggml-org/llama.cpp";
    capsule = {
      url = "github:shuymn/capsule";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.home-manager.follows = "home-manager";
      inputs.nix-darwin.follows = "nix-darwin";
    };
  };

  # The composition root: it only calls the builders in lib/. Outputs are
  # named by platform, never by host or user.
  outputs =
    inputs:
    let
      facts = import ./lib/facts.nix;
      systems = [
        "aarch64-darwin"
        "x86_64-linux"
      ];
      inherit (inputs.nixpkgs) lib;
    in
    {
      # This repo's own packages, per platform (only where they are available).
      packages = lib.genAttrs systems (
        system:
        lib.filterAttrs (_: p: lib.meta.availableOn { inherit system; } p) (
          import ./pkgs { inherit (inputs.nixpkgs.legacyPackages.${system}) callPackage; }
        )
      );

      # The home-manager bootstrap.sh runs on Linux, pinned by this flake's
      # lock (the Mac switches from the built system's own tools).
      apps = {
        x86_64-linux.home-manager = {
          type = "app";
          program = lib.getExe inputs.home-manager.packages.x86_64-linux.home-manager;
        };
      };
      darwinConfigurations.mac = import ./lib/mk-darwin.nix { inherit inputs facts; };
      homeConfigurations.linux = import ./lib/mk-linux.nix { inherit inputs facts; };

      # `nix flake check --impure` (facts.nix reads the environment): the
      # repo's packages plus each platform's whole configuration, which
      # flake check would not build by itself.
      checks = lib.genAttrs systems (
        system:
        inputs.self.packages.${system}
        // (
          if system == "aarch64-darwin" then
            { mac = inputs.self.darwinConfigurations.mac.system; }
          else
            { linux = inputs.self.homeConfigurations.linux.activationPackage; }
        )
      );

      formatter = lib.genAttrs systems (system: inputs.nixpkgs.legacyPackages.${system}.nixfmt-tree);
    };
}
