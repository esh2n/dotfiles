# gpu: a Linux machine with an NVIDIA card serves extra local models with
# llama-server (the Omarchy desktop), on the tailnet like the lmstudio role's
# LM Studio: every machine's LiteLLM can use either.
{
  config,
  lib,
  pkgs,
  ...
}:
lib.mkIf (config.dotfiles.roles.gpu.enable && pkgs.stdenv.hostPlatform.isLinux) {
  dotfiles.homeLlm = {
    enable = true;
    gpu = true;
  };
}
