# Helpers every home module uses, on config.lib like home-manager's own
# config.lib.file.
#
#   config.lib.dotfiles.link "<path in the checkout>"
#     An out-of-store symlink into the checkout: the file stays editable in
#     place and an edit takes effect without a rebuild.
#
#   config.lib.dotfiles.setupStep "<step>"
#     The command line of one `dotctl setup` step (pkgs/dotctl,
#     internal/setup), for dotfiles.setup.<name>.command.
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
    setupStep = step: "${lib.getExe pkgs.dotctl} setup --repo ${lib.escapeShellArg facts.repo} ${step}";
  };
}
