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
  checkout = ../../../..;
  # file in a palette -> the theme file, relative to the checkout
  apps = {
    "colors.lua" = n: "domains/system/config/themes/${n}.lua";
    ghostty = n: "domains/dev/config/ghostty/themes/${n}";
    "tmux.conf" = n: "domains/dev/config/tmux/themes/${n}.conf";
    "sketchybar.lua" = n: "domains/workspace/config/sketchybar/themes/${n}.lua";
    "borders.sh" = n: "domains/workspace/config/borders/themes/${n}.sh";
  };
  themes = map (f: lib.removeSuffix ".lua" f) (
    builtins.attrNames (builtins.readDir (checkout + "/domains/system/config/themes"))
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
  xdg.configFile = lib.listToAttrs (
    lib.concatMap (
      n:
      lib.mapAttrsToList (
        file: source: lib.nameValuePair "theme/palettes/${n}/${file}" { source = link (source (pick source n)); }
      ) apps
    ) themes
  );

  dotfiles.setup.theme-init.command = "${lib.getExe pkgs.dotctl} theme --repo ${lib.escapeShellArg facts.repo} init";
}
