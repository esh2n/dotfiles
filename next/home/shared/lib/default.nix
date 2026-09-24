# Helpers every home module uses, on config.lib like home-manager's own
# config.lib.file.
#
#   config.lib.dotfiles.link "<path in the checkout>"
#     An out-of-store symlink into the checkout: the file stays editable in
#     place and an edit takes effect without a rebuild.
#
#   config.lib.dotfiles.devSetup "<step>"
#     The command line of one dev-setup step (next/pkgs/scripts/dev-setup),
#     for dotfiles.setup.<name>.command.
{
  config,
  lib,
  pkgs,
  facts,
  ...
}:
{
  lib.dotfiles = {
    link = path: config.lib.file.mkOutOfStoreSymlink "${facts.repo}/${path}";
    devSetup = step: "${lib.getExe pkgs.dev-setup} ${lib.escapeShellArg facts.repo} ${step}";
  };
}
