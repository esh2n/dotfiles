# Browsers (macOS): the extension force-install policy for Chrome and Dia,
# and the userstyles generated for every theme. Both are the system domain's
# own script until its content moves (plans/2026-09-24-dotfiles-architecture.md, M3).
{
  lib,
  pkgs,
  facts,
  ...
}:
{
  dotfiles.setup.browsers.command = "${lib.getExe pkgs.bash} ${lib.escapeShellArg "${facts.repo}/domains/system/install.sh"}";
}
