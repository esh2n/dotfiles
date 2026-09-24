# Keeps the Mac awake exactly while the LM Studio server runs. The wrapper
# waits for :1234, then becomes `caffeinate -s -w <pid>`; it exits with the
# server and is started again. Off by default; next/roles/llm-hub.nix turns
# it on.
{
  dotfiles.services.lmstudio-awake = {
    script = "domains/dev/config/lmstudio/awake.sh";
    restartDelay = 30;
  };
}
