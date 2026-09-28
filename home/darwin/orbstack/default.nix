# OrbStack, the Docker engine on the Mac (a cask for the developer and
# observer roles, system/darwin/homebrew.nix): set to start at login, so
# LiteLLM and the observer's stacks never wait on an engine nobody started
# (dotctl setup orbstack; research: rules/knowledge/docker-autostart-macos-omarchy.md).
{ config, ... }:
{
  dotfiles.setup.orbstack.command = config.lib.dotfiles.setupStep "orbstack";
}
