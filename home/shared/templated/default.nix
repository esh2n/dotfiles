# Every *.template in the checkout is rendered beside itself ({{HOME}},
# {{USER}}, {{DOTFILES_ROOT}}, git's conditional includes) before the links
# are written. The rendered files are working copies — dotctl theme rewrites
# starship's palette and zellij's layout, tools write their own state — so
# they stay in the checkout, gitignored; each app's own module links them.
{
  lib,
  pkgs,
  facts,
  ...
}:
{
  # Before links are written, so a fresh checkout already has the files the
  # links point at.
  home.activation.renderTemplates = lib.hm.dag.entryBefore [ "writeBoundary" ] ''
    run ${lib.getExe pkgs.dotctl} templates render --repo ${lib.escapeShellArg facts.repo}
  '';
}
