# Browser extensions on Linux: Omarchy's Chromium gets the extensions in
# home/shared/browsers/config/extensions.json as external extensions
# (~/.config/chromium/External Extensions/<id>.json). package = null: the
# browser is Omarchy's, only the files are written here.
{ ... }:
let
  ids =
    map (e: e.id)
      (builtins.fromJSON (builtins.readFile ../../shared/browsers/config/extensions.json)).extensions;
in
{
  programs.chromium = {
    enable = true;
    package = null;
    extensions = map (id: { inherit id; }) ids;
  };
}
