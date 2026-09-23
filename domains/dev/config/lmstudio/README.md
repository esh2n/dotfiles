# LM Studio — the home model server (headless, at login, awake while serving)

The one model server this dotfiles setup exposes to other machines. It stays
on `127.0.0.1:1234`; only Tailscale puts it on the tailnet, and every LiteLLM
instance (loopback-only, one per machine) points at it — see
`domains/dev/llm/harness/rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md`.

## What runs

| piece | how it starts | where it comes from |
|---|---|---|
| LM Studio server (llmster inside `LM Studio.app`) on `127.0.0.1:1234` | LM Studio's own "run the LLM server on login" setting (built-in login item) | `lm-studio` cask, `domains/dev/packages/homebrew.nix` |
| `com.esh2n.lmstudio-awake` — `caffeinate -s -w <server pid>` | launchd, `RunAtLoad` + `KeepAlive` | this directory |
| Tailscale (Standalone variant) + `tailscale serve --bg --tcp 1234 127.0.0.1:1234` | the app's own login item; `serve --bg` persists across reboots | `tailscale-app` cask, `homebrew.nix` |

There is deliberately **no** `com.esh2n.lmstudio-server` launchd job. LM
Studio documents its own autostart for the desktop app
(https://lmstudio.ai/docs/app/api/headless, "Option 2: Desktop app in headless
mode" → heading "Run the LLM service on machine login": "check the box to run
the LLM server on login. When this setting is enabled, exiting the app will
minimize it to the system tray, and the LLM server will continue to run in the
background. Your last server state will be saved and restored on app or
service launch."). Only the standalone `llmster` ("Option 1") has no autostart
of its own, and its startup-task guide is Linux/systemd only ("This guide is
for Linux systems without a graphical interface. For machines with a GUI, you
can configure LM Studio to run as a service on login instead."). We install
the desktop app, so we use its setting.

Why `caffeinate` and not `pmset disablesleep`: `pmset -a disablesleep 1` keeps
the whole machine awake forever; `caffeinate -s -w <pid>` holds a sleep
assertion "only when system is running on AC power" and releases it "once the
process exits" (`caffeinate(8)`). launchd `KeepAlive` re-arms the wait after
each exit, so the Mac is awake exactly while the server lives.

Process-name fact (measured 2026-09-23, matters for `awake.sh`): with the
desktop app, the listener on `:1234` is the `LM Studio` process itself
(`/Applications/LM Studio.app/Contents/MacOS/LM Studio`), and
`~/.lmstudio/.internal/llmster-pid.lock` holds that same pid. There is no
process named `llmster` to `pgrep`, so `awake.sh` waits for the loopback
listener on the port instead (`lsof -iTCP@127.0.0.1:1234 -sTCP:LISTEN -t`),
which also keeps working if the standalone `llmster` is ever used.

## How it is installed

1. Apps: `darwin-rebuild switch` (nix-darwin `homebrew.casks`) installs
   `lm-studio` and `tailscale-app`. The cask installs `LM Studio.app` only;
   the app bootstraps the `lms` CLI into `~/.lmstudio/bin/lms` on first launch
   ("lms ships with LM Studio", https://lmstudio.ai/docs/cli).
2. Files: `make link` (`core/config/manager.sh link`) symlinks this directory
   to `~/.config/lmstudio` and writes the launchd job as an **expanded copy**
   to `~/Library/LaunchAgents/com.esh2n.lmstudio-awake.plist`
   (`link_launch_agents` → `install_expanded` resolves `{{HOME}}`; launchd
   expands nothing itself, so the source plist must keep the placeholder).
   Loading the job is a separate, deliberate step (below); `make link` never
   does it.

## Once-only owner steps (per machine)

On the Mac that hosts the models:

1. Open LM Studio once. Settings (`Cmd+,`) → check **run the LLM server on
   login**. Keep the server on `127.0.0.1` (Server → network interface
   "localhost only"; never `0.0.0.0` — the ruling forbids LAN exposure).
2. Start the server so the saved state is "running":
   `lms server start --port 1234` (`--bind 127.0.0.1` is the default). Check:
   `curl -s http://127.0.0.1:1234/v1/models`.
3. Load the awake job:
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.esh2n.lmstudio-awake.plist`.
   Verify: `pmset -g assertions | grep -i caffeinate` shows a
   `PreventSystemSleep` assertion while the server is up;
   `~/Library/Logs/lmstudio-awake.log` names the pid it is holding.
4. Tailscale: log in from the menu-bar app, then publish the server to the
   tailnet: `tailscale serve --bg --tcp 1234 127.0.0.1:1234`. `--bg` "runs
   persistently in the background until you disable it"
   (https://tailscale.com/kb/1242/tailscale-serve). Check with
   `tailscale serve status`; undo with `tailscale serve reset`. If
   `tailscale` is not on PATH, the CLI is the app binary:
   `/Applications/Tailscale.app/Contents/MacOS/Tailscale`
   (https://tailscale.com/kb/1080/cli).

On every other machine: log in to Tailscale, and give LiteLLM the Mac's
MagicDNS name once (`LM_STUDIO_REMOTE_HOST`, see
`domains/dev/config/litellm/litellm-up.sh`). Nothing from this directory is
needed there.

## Re-apply / remove

- Changed the plist or `awake.sh`: `make link`, then
  `launchctl bootout gui/$(id -u)/com.esh2n.lmstudio-awake` and `bootstrap`
  again (the deployed plist is a copy, not a link).
- Stop holding the Mac awake: `launchctl bootout gui/$(id -u)/com.esh2n.lmstudio-awake`.
- Battery: `caffeinate -s` is AC-only by definition; on battery the Mac
  sleeps as usual. That is the intended scope.
