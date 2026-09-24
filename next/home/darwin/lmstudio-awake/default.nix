# Keeps the Mac awake exactly while the LM Studio server runs (the llm-hub
# role on macOS). The wrapper waits for :1234, then becomes
# `caffeinate -s -w <pid>`; it exits with the server and is started again.
{ config, ... }:
{
  dotfiles.services.lmstudio-awake = {
    enable = config.dotfiles.roles.llm-hub.enable;
    script = "domains/dev/config/lmstudio/awake.sh";
    restartDelay = 30;
  };
}
