# Apps with files rendered from *.template ({{HOME}}, {{USER}},
# {{DOTFILES_ROOT}}, git's conditional includes). The rendered files are
# working copies — theme-switch rewrites starship's palette and zellij's
# layout, tools write their own state — so they are rendered into the
# checkout (gitignored) by activation, and the directories are links into it.
# serena renders here too; it is placed under ~/.serena (see home/shared/serena).
{
  config,
  lib,
  pkgs,
  facts,
  ...
}:
let
  link = config.lib.dotfiles.link;
in
{
  xdg.configFile = {
    mise.source = link "domains/dev/config/mise";
    starship.source = link "domains/dev/config/starship";
    zellij.source = link "domains/dev/config/zellij";
  };

  home.file.".gitconfig".source = link "domains/dev/home/.gitconfig";

  # Before links are written, so a fresh checkout already has the files the
  # links point at.
  home.activation.renderTemplates = lib.hm.dag.entryBefore [ "writeBoundary" ] ''
    run ${lib.getExe pkgs.dotctl} templates render --repo ${lib.escapeShellArg facts.repo}
  '';
}
