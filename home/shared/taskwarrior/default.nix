# Taskwarrior for the owner's own tasks
# (rules/decisions/2026-10-23-personal-tasks-sync.md): the taskrc on every
# machine, one taskchampion-sync-server on the machine with syncServer on (the
# observer), and on every machine a loop that syncs its replica with it and
# backs it up daily. The server's tailnet name is this machine's fact (the
# roles file's "observerHost"); the server's own machine reaches it on loopback.
{
  config,
  lib,
  pkgs,
  facts,
  ...
}:
let
  cfg = config.dotfiles.tasks;
  port = "10222";
  url =
    if cfg.syncServer then
      "http://127.0.0.1:${port}"
    else if facts.observerHost != null then
      "https://${facts.observerHost}:${port}"
    else
      null;
in
{
  options.dotfiles.tasks.syncServer = lib.mkEnableOption "the tasks' sync server every replica syncs with (one machine)";

  config = {
    # absolute includes: a relative one resolves from the included file's own
    # directory, and the checkout's taskrc stays editable in place
    xdg.configFile."task/taskrc".text = ''
      include ${facts.repo}/home/shared/taskwarrior/taskrc
      include ${config.xdg.configHome}/task/machine.rc
    '';
    # recurring tasks are made by one replica only, the server's machine
    xdg.configFile."task/machine.rc".text = "recurrence=${if cfg.syncServer then "on" else "off"}\n";

    dotfiles.services.taskchampion-sync-server = {
      enable = cfg.syncServer;
      script = "home/shared/taskwarrior/sync-server-up.sh";
      environment = {
        SYNC_SERVER = lib.getExe pkgs.taskchampion-sync-server;
        SYNC_LISTEN = "127.0.0.1:${port}";
      };
    };

    dotfiles.services.task-sync = {
      script = "home/shared/taskwarrior/task-sync-up.sh";
      restartDelay = 600;
      environment = {
        DOTCTL = lib.getExe pkgs.dotctl;
        TASK_BIN = lib.getExe pkgs.taskwarrior3;
        TASK_SQLITE = lib.getExe pkgs.sqlite;
      }
      // lib.optionalAttrs (url != null) { TASK_SYNC_URL = url; };
    };
  };
}
