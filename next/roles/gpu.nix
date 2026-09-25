# gpu: a Linux machine with an NVIDIA card serves extra local models with
# llama-server (the Omarchy desktop; the Mac's models are llm-hub's LM Studio).
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
