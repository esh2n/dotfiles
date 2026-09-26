# Browser extensions (macOS): Chrome and Dia force-install the extensions in
# home/shared/browsers/config/extensions.json. The list is the one source;
# nix-darwin writes it on activation (it replaced a script's `defaults write`).
{ ... }:
let
  ids =
    map (e: e.id)
      (builtins.fromJSON (builtins.readFile ../../home/shared/browsers/config/extensions.json))
      .extensions;
  forcelist = {
    ExtensionInstallForcelist = ids;
  };
in
{
  system.defaults.CustomUserPreferences = {
    "com.google.Chrome" = forcelist;
    "company.thebrowser.dia" = forcelist;
  };
}
