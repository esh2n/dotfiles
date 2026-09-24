# Codebase-Memory (macOS builds only): index and watch projects by itself.
{ config, ... }:
let
  setup = config.lib.dotfiles.devSetup;
in
{
  dotfiles.setup.codebase-memory.command = setup "codebase-memory";
}
