# llm-hub: the machine serves the home models to the others over the tailnet.
# On the Mac that is LM Studio, which must keep the machine awake while it
# serves (Linux hosts are the gpu role's llama-server, not this).
{
  config,
  lib,
  pkgs,
  ...
}:
lib.mkIf (config.dotfiles.roles.llm-hub.enable && pkgs.stdenv.hostPlatform.isDarwin) {
  dotfiles.services.lmstudio-awake.enable = true;
}
