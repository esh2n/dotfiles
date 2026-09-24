# Helpers every home module uses, on config.lib like home-manager's own
# config.lib.file.
#
#   config.lib.dotfiles.link "<path in the checkout>"
#     An out-of-store symlink into the checkout: the file stays editable in
#     place and an edit takes effect without a rebuild.
{ config, facts, ... }:
{
  lib.dotfiles.link = path: config.lib.file.mkOutOfStoreSymlink "${facts.repo}/${path}";
}
