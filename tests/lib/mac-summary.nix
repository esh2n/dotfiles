# What a Mac configuration installs and sets, independent of the order modules
# contributed it: package names, Homebrew lists, taps, App Store apps and
# system defaults. Two configurations with equal summaries configure the same
# machine even when their derivation paths differ only by list order.
{ flake, config, user }:
let
  c = (builtins.getFlake flake).darwinConfigurations.${config}.config;
  # Sets, not lists: duplicates across modules and their order carry no meaning.
  sorted = xs: builtins.sort builtins.lessThan (builtins.attrNames (builtins.listToAttrs (map (n: { name = n; value = null; }) xs)));
  names = map (x: if builtins.isString x then x else x.name);
in
{
  packages = sorted (map (p: p.name) c.home-manager.users.${user}.home.packages);
  systemPackages = sorted (map (p: p.name) c.environment.systemPackages);
  brews = sorted (names c.homebrew.brews);
  casks = sorted (names c.homebrew.casks);
  taps = sorted (names c.homebrew.taps);
  masApps = c.homebrew.masApps;
  defaults = {
    inherit (c.system.defaults) dock finder NSGlobalDomain;
  };
  stateVersion = c.system.stateVersion;
  primaryUser = c.system.primaryUser;
  nixbldGid = c.ids.gids.nixbld;
  nixFeatures = c.nix.settings.experimental-features;
  homebrew = {
    inherit (c.homebrew) enable;
    inherit (c.homebrew.onActivation) autoUpdate cleanup;
  };
  homeStateVersion = c.home-manager.users.${user}.home.stateVersion;
  homeDirectory = c.home-manager.users.${user}.home.homeDirectory;
  direnv = c.home-manager.users.${user}.programs.direnv.enable;
}
