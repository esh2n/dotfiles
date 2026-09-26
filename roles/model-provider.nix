# model-provider: this machine lends its local models to the others over the
# tailnet; every machine's LiteLLM can use them (there is no hub). The engine
# follows the platform, never a name: LM Studio on the Mac (kept awake while it
# serves), llama-server on Linux with an NVIDIA card (the Omarchy desktop,
# rules/decisions/2026-09-24-home-llm-second-host-omarchy-llama-server.md).
{
  config,
  lib,
  pkgs,
  ...
}:
let
  inherit (pkgs.stdenv.hostPlatform) isDarwin isLinux;
in
lib.mkIf config.dotfiles.roles.model-provider.enable {
  dotfiles.services.lmstudio-awake.enable = lib.mkIf isDarwin true;
  dotfiles.homeLlm = {
    enable = true;
    lmstudio = isDarwin;
    gpu = isLinux;
  };
}
