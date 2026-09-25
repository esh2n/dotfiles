# lmstudio: this machine serves LM Studio's models on the tailnet (the Mac).
# Every machine's LiteLLM can use them, as it can the gpu role's llama-server:
# machines use each other's models, there is no hub. LM Studio must keep the
# machine awake while it serves.
{
  config,
  lib,
  pkgs,
  ...
}:
lib.mkIf (config.dotfiles.roles.lmstudio.enable && pkgs.stdenv.hostPlatform.isDarwin) {
  dotfiles.services.lmstudio-awake.enable = true;
  dotfiles.homeLlm = {
    enable = true;
    lmstudio = true;
  };
}
