{
  description = "esh2n's dotfiles";

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
  };

  outputs = { nixpkgs, nix-darwin, home-manager, brew-nix, ... }:
    let
      # Get username from environment or use default
      username = builtins.getEnv "USER";
      hostname = "${username}-mac";
      system = "aarch64-darwin";
    in {
      darwinConfigurations.${hostname} = nix-darwin.lib.darwinSystem {
        inherit system;
        specialArgs = { inherit username; };
        modules = [
          ./darwin.nix

          ../../domains/dev/packages/homebrew.nix
          ../../domains/workspace/packages/homebrew.nix
          ../../domains/creative/packages/homebrew.nix
          ../../domains/infra/packages/homebrew.nix

          {
            nixpkgs.overlays = [
              (import ./overlays.nix)
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
                ./home.nix
                ../../domains/dev/packages/home.nix
                ../../domains/workspace/packages/home.nix
                ../../domains/creative/packages/home.nix
                ../../domains/infra/packages/home.nix
                ../../domains/system/packages/home.nix
              ];
            };
          }
        ];
      };
    };
}
