# Warp: ~/.warp is a link to config/ beside this file. Warp rewrites
# settings.toml itself, so the live file is machine-local: seeded once from
# settings.toml.default, never overwritten (dotctl setup warp-seed).
{ config, ... }:
{
  home.file.".warp".source = config.lib.dotfiles.link "home/darwin/warp/config";
  dotfiles.setup.warp-seed.command = config.lib.dotfiles.setupStep "warp-seed";
}
