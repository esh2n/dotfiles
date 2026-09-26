# The links a home configuration places, as { "<path under ~>" = "<target>"; }.
# Out-of-store symlinks are read back from the derivation that creates them,
# so a link is compared by where it points, not by a store path.
{
  flake,
  kind,
  config,
  user ? null,
}:
let
  f = builtins.getFlake flake;
  hm =
    if kind == "darwin" then
      f.darwinConfigurations.${config}.config.home-manager.users.${user}
    else
      f.homeConfigurations.${config}.config;
  targetOf =
    file:
    let
      src = file.source;
      cmd = src.buildCommand or "";
      # mkOutOfStoreSymlink writes `ln -s <path> $out`, quoting the path only
      # when it needs escaping.
      quoted = builtins.match "ln -s '([^']*)' \\$out" cmd;
      bare = builtins.match "ln -s ([^ ]*) \\$out" cmd;
    in
    if quoted != null then
      builtins.head quoted
    else if bare != null then
      builtins.head bare
    else
      "store:" + (toString src);
  enabled = builtins.filter (n: hm.home.file.${n}.enable) (builtins.attrNames hm.home.file);
in
builtins.listToAttrs (
  map (n: {
    name = hm.home.file.${n}.target;
    value = targetOf hm.home.file.${n};
  }) enabled
)
