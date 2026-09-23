#!/usr/bin/env bash
# Keep the Mac awake exactly while the LM Studio server is up — no longer.
#
# Supervised by launchd (com.esh2n.lmstudio-awake.plist, KeepAlive). Loop:
# wait until something listens on 127.0.0.1:$PORT, then hand the rest of this
# process to `caffeinate -s -w <pid>`, which holds a sleep assertion until that
# pid exits. When the server goes away caffeinate exits, launchd relaunches
# this script, and it waits again. The machine is therefore never held awake
# by a stale assertion, and `pmset -a disablesleep 1` (whole machine, forever)
# is not needed — rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-
# litellm-local.md.
#
# caffeinate(8), verified locally with `mandoc /usr/share/man/man8/caffeinate.8`:
#   -s  "Create an assertion to prevent the system from sleeping. This
#        assertion is valid only when system is running on AC power."
#   -w  "Waits for the process with the specified pid to exit. Once the
#        process exits, the assertion is also released."
# So on battery the Mac still sleeps (by design: a server on battery is not a
# server), and the display is allowed to sleep (no -d).
#
# Why the port and not a process name: on the desktop-app variant installed by
# the `lm-studio` cask the llmster daemon runs INSIDE the "LM Studio" process
# (~/.lmstudio/.internal/llmster-pid.lock holds the pid of
# /Applications/LM Studio.app/Contents/MacOS/LM Studio — measured, 2026-09-23),
# so `pgrep -x llmster` never matches. If the owner later switches to the
# standalone llmster (https://lmstudio.ai/docs/app/api/headless, "Option 1"),
# the listener is still the thing to wait for, and this script does not change.
#
# Deployed to ~/.config/lmstudio by `make link` (manager.sh link_domain);
# launched by ~/Library/LaunchAgents/com.esh2n.lmstudio-awake.plist.
set -euo pipefail

# launchd hands us a minimal PATH; name the tools' real locations.
export PATH="/etc/profiles/per-user/$(id -un)/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# The LM Studio server port. Keep in step with the port LM Studio is started
# on (`lms server start --port 1234`) and with the `tailscale serve` target.
PORT="${LMSTUDIO_PORT:-1234}"
POLL_SECONDS=30

# Wait for a LISTENing TCP socket bound to loopback on $PORT. Loopback only:
# the decision keeps LM Studio on 127.0.0.1, and the tailnet side is served by
# tailscaled, which must not be mistaken for the model server.
find_server_pid() {
  lsof -nP -iTCP@127.0.0.1:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true
}

pid="$(find_server_pid)"
while [ -z "$pid" ]; do
  sleep "$POLL_SECONDS"
  pid="$(find_server_pid)"
done

echo "lmstudio-awake: LM Studio server pid $pid listening on 127.0.0.1:$PORT — preventing system sleep until it exits" >&2
exec caffeinate -s -w "$pid"
