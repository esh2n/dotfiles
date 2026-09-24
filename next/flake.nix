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
    in
    {
      darwinConfigurations.mac = import ./lib/mk-darwin.nix { inherit inputs facts; };
      homeConfigurations.linux = import ./lib/mk-home.nix { inherit inputs facts; };
    };
}
