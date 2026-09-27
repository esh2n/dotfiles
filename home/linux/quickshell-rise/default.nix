# Quickshell Rise, the bar that replaces Omarchy's stock bar
# (github.com/HANCORE-linux/quickshell-dots): installed once by
# `dotctl setup quickshell-rise`, then updated by its own updater.
#
# Its look (bar colour, splits, widget order and settings) lives in files
# under ~/.cache that Rise rewrites with a shell `>` redirect, which writes
# through a link, so they are links into ./cache and the checkout follows
# every change made in its Control Panel. The V1/V2 choice is not among
# them: Rise saves it atomically (a new file renamed over the old), which
# would replace a link, so the installer's V1 argument sets it instead.
{ config, lib, ... }:
let
  files = [
    "quickshell_splits"
    "quickshell_barsplits"
    "quickshell_barorder"
    "quickshell_widgets"
    "quickshell_widgets_v2"
  ];
in
{
  home.file = lib.genAttrs (map (f: ".cache/${f}") files) (
    name: { source = config.lib.dotfiles.link "home/linux/quickshell-rise/cache/${baseNameOf name}"; }
  );
  dotfiles.setup.quickshell-rise.command = config.lib.dotfiles.setupStep "quickshell-rise";
}
