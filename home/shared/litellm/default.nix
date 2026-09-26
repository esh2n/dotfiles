# LiteLLM, the loopback proxy every harness talks to: ~/.config/litellm is a
# link to config/ beside this file (its config, launcher, key helper and the
# observability stack). The service itself is declared in home/shared/services.
{ config, ... }:
{
  xdg.configFile.litellm.source = config.lib.dotfiles.link "home/shared/litellm/config";
  dotfiles.zsh.snippets.litellm = "home/shared/litellm/litellm.zsh";
}
