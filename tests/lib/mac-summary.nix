# What a Mac configuration installs and sets, independent of the order modules
# contributed it: package names, Homebrew lists, taps, App Store apps and
# system defaults. Two configurations with equal summaries configure the same
# machine even when their derivation paths differ only by list order.
{ flake, config, user }:
let
  c = (builtins.getFlake flake).darwinConfigurations.${config}.config;
  sorted = builtins.sort builtins.lessThan;
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
  homeStateVersion = c.home-manager.users.${user}.home.stateVersion;
}
