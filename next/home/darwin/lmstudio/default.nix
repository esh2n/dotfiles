# LM Studio on the Mac: ~/.config/lmstudio is a link to config/ beside this
# file, and lmstudio-awake keeps the Mac awake exactly while LM Studio's
# server runs — the wrapper waits for :1234, then becomes
# `caffeinate -s -w <pid>`; it exits with the server and is started again.
# The service is off by default; the model-provider role turns it on on macOS.
{ config, ... }:
{
  xdg.configFile.lmstudio.source = config.lib.dotfiles.link "next/home/darwin/lmstudio/config";
  dotfiles.services.lmstudio-awake = {
    script = "next/home/darwin/lmstudio/config/awake.sh";
    restartDelay = 30;
  };
}
