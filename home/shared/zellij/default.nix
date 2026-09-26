# zellij plugins: zjstatus and monocle are downloaded by a setup step;
# zellij-pane-picker (the pane bookmarks on Prefix + b) is pinned here.
# harpoon was dropped: upstream never followed zellij 0.44's plugin API
# (rules/research/2026-09-25-zellij-harpoon-replacement.md). pane-picker's
# v0.6.0 is built against zellij-tile 0.42.2 and still loads on 0.44. It is
# launched on demand only, never from load_plugins (upstream issue #87).
{
  config,
  pkgs,
  ...
}:
let
  setup = config.lib.dotfiles.setupStep;
in
{
  # ~/.config/zellij is a link to config/ beside this file (config.kdl and
  # the layouts are rendered there from their templates)
  xdg.configFile.zellij.source = config.lib.dotfiles.link "home/shared/zellij/config";
  dotfiles.setup.zellij-plugins.command = setup "zellij-plugins";

  # ~/.config/zellij links into the checkout, so the pinned plugin lives
  # beside it under ~/.local/share; config.kdl.template points there.
  xdg.dataFile."zellij/plugins/zellij-pane-picker.wasm".source = pkgs.fetchurl {
    url = "https://github.com/shihanng/zellij-pane-picker/releases/download/v0.6.0/zellij-pane-picker.wasm";
    hash = "sha256-QO2cSZLPvFGg0ORcOjfrsU30Ox0at4z48aC5QvXLlho=";
  };
}
