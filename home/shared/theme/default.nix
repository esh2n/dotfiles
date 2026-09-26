# Themes (plans/2026-09-24-dotfiles-architecture.md §7). One palette per
# theme, ~/.config/theme/palettes/<name>/<file>, linking the checkout's theme
# files; `dotctl theme set` moves ~/.config/theme/current between them, and
# each app's pointer reads through `current` (dotctl theme init, on every
# switch). Nix declares the mechanism only; which theme is on is the
# machine's, never a rebuild.
#
# A theme with no file for an app (the light variants mostly) borrows its
# family's — catppuccin-latte -> catppuccin — else catppuccin's, so an app
# never reads a missing file.
{
  config,
  lib,
  pkgs,
  facts,
  ...
}:
let
  link = config.lib.dotfiles.link;
  checkout = ../../..;
  # file in a palette -> the theme file, relative to the checkout
  apps = {
    "colors.lua" = n: "home/shared/theme/themes/${n}.lua";
    ghostty = n: "home/darwin/ghostty/config/themes/${n}";
    "sketchybar.lua" = n: "home/darwin/sketchybar/config/themes/${n}.lua";
    "borders.sh" = n: "home/darwin/borders/config/themes/${n}.sh";
  };
  themes = map (f: lib.removeSuffix ".lua" f) (
    builtins.attrNames (builtins.readDir (checkout + "/home/shared/theme/themes"))
  );
  family = n: builtins.head (lib.splitString "-" n);
  exists = rel: builtins.pathExists (checkout + "/${rel}");
  pick =
    source: n:
    lib.findFirst (m: exists (source m)) (source "catppuccin") [
      n
      (family n)
    ];
in
{
  # the palettes themselves (for apps that read them from ~/.config/themes),
  # and one directory of links per theme
  xdg.configFile = {
    themes.source = link "home/shared/theme/themes";
  }
  // lib.listToAttrs (
    lib.concatMap (
      n:
      lib.mapAttrsToList (
        file: source:
        lib.nameValuePair "theme/palettes/${n}/${file}" { source = link (source (pick source n)); }
      ) apps
    ) themes
  );

  dotfiles.setup.theme-init.command = "${lib.getExe pkgs.dotctl} theme --repo ${lib.escapeShellArg facts.repo} init";
}
