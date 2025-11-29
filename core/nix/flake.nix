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
  };

  outputs = { nixpkgs, nix-darwin, home-manager, ... }:
    let
      system = "aarch64-darwin";
      # Apply custom overlays
      pkgs = import nixpkgs {
        inherit system;
        config.allowUnfree = true;
        overlays = [ (import ./overlays.nix) ];
      };
    in {
      darwinConfigurations."esh2n-mac" = nix-darwin.lib.darwinSystem {
        inherit system;
        modules = [
          ./darwin.nix
          home-manager.darwinModules.home-manager
          {
            # Use our custom pkgs with overlays
            nixpkgs.overlays = [ (import ./overlays.nix) ];
            nixpkgs.config.allowUnfree = true;

            home-manager.useGlobalPkgs = true;
            home-manager.useUserPackages = true;
            home-manager.users.esh2n = {
              imports = [
                ./home.nix
                ../../domains/dev/packages
                ../../domains/workspace/packages
                ../../domains/creative/packages
                ../../domains/infra/packages
                ../../domains/system/packages
              ];
            };
          }
        ];
      };
    };
}
