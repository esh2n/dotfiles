#!/usr/bin/env bash
# Bring one machine up to the home-LLM ruling, idempotently, in one run.
#
# Ruling: rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md
#   - LM Studio on the Mac ("hub"), served on the tailnet (tcp:1234) and the
#     phone's Open WebUI (https:3001); every machine runs its own loopback
#     LiteLLM; the Mac's Prometheus scrapes each machine's metrics port 4001.
#
# Every step checks the machine first and only acts on what is missing, so
# re-running after a partial failure (or after `make link`) is safe. What a
# script cannot do (a GUI login, a checkbox inside an app, the tailnet ACL
# in the admin console) is collected and printed at the end as the remaining
# owner steps — the only list the owner has to read.
#
# Roles (auto-detected, override with --hub / --node):
#   hub   the Mac that hosts LM Studio: apps, LM Studio server + awake job,
#         LiteLLM, tailscale serve 1234 + 3001, Prometheus, Open WebUI,
#         pi packages, Claude MCP registrations
#   node  any other machine: Tailscale, LiteLLM pointed at the hub
#         (LM_STUDIO_REMOTE_HOST), tailscale serve 4001, pi packages,
#         Claude MCP registrations
#
# Usage: home-llm-up.sh [--hub|--node] [--remote-host <mac.tailnet.ts.net>]
#        home-llm-up.sh --acl   render tailscale/acl.hujson with this tailnet's
#                               real login + IP, copy it to the clipboard and
#                               open the admin console page to paste it into
#        `make home-llm` / `make home-llm-acl` run these from the canonical checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
export DOTFILES_ROOT="${DOTFILES_ROOT:-$ROOT}"
export PATH="$HOME/.lmstudio/bin:/etc/profiles/per-user/$(id -un)/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

ROLE=""
ACL_ONLY=0
REMOTE_HOST="${LM_STUDIO_REMOTE_HOST:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --hub) ROLE=hub ;;
    --node) ROLE=node ;;
    --acl) ACL_ONLY=1 ;;
    --remote-host) REMOTE_HOST="$2"; shift ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

OS="$(uname -s)"
TS_BIN="$(command -v tailscale || true)"
[ -z "$TS_BIN" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && TS_BIN=/Applications/Tailscale.app/Contents/MacOS/Tailscale
if [ -z "$ROLE" ]; then
  if [ "$OS" = Darwin ] && [ -d "/Applications/LM Studio.app" ]; then ROLE=hub; else ROLE=node; fi
fi

REMAINING=()
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
did()  { printf '  \033[36m→\033[0m %s\n' "$*"; }
skip() { printf '  \033[33m·\033[0m %s\n' "$*"; }
todo() { REMAINING+=("$*"); printf '  \033[31m✗\033[0m %s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
port_answers() { curl -sf --max-time 2 "$1" >/dev/null 2>&1; }
uid_gui() { echo "gui/$(id -u)"; }
agent_loaded() { launchctl print "$(uid_gui)/$1" >/dev/null 2>&1; }
# Every CLI that can sit waiting on a GUI or the network runs under a cap, so
# a stuck tool becomes an owner step instead of a script that never returns
# (`timeout` is coreutils from the nix profile; without it, run bare).
capped() { if command -v timeout >/dev/null 2>&1; then timeout "$@"; else shift; "$@"; fi; }

# --acl: the tailnet policy is the one piece that lives in Tailscale's admin
# console, not on any machine. The repo file keeps placeholders (no login or
# IP committed); this fills them from the live tailnet, puts the result on the
# clipboard and opens the page — the owner pastes (Cmd+A, Cmd+V) and saves.
if [ "$ACL_ONLY" = 1 ]; then
  acl="$DOTFILES_ROOT/domains/dev/config/tailscale/acl.hujson"
  [ -n "$TS_BIN" ] || { echo "tailscale CLI not found — install/log in first (make home-llm)" >&2; exit 1; }
  ts_json="$(capped 10 "$TS_BIN" status --json 2>/dev/null || true)"
  read -r ts_ip ts_login < <(printf '%s' "$ts_json" | python3 -c '
import json, sys
d = json.load(sys.stdin)
me = d["Self"]
print(me["TailscaleIPs"][0], d["User"][str(me["UserID"])]["LoginName"])
' 2>/dev/null || true)
  [ -n "${ts_ip:-}" ] || { echo "tailscale status --json gave no Self/User — log in first (make home-llm)" >&2; exit 1; }
  rendered="$(sed -e "s|owner@example.com|$ts_login|" -e "s|mac.example.ts.net|$ts_ip|g" "$acl")"
  if command -v pbcopy >/dev/null 2>&1; then printf '%s\n' "$rendered" | pbcopy; where=clipboard
  elif command -v wl-copy >/dev/null 2>&1; then printf '%s\n' "$rendered" | wl-copy; where=clipboard
  elif command -v xclip >/dev/null 2>&1; then printf '%s\n' "$rendered" | xclip -selection clipboard; where=clipboard
  else printf '%s\n' "$rendered"; where=stdout
  fi
  echo "tailnet policy rendered for $ts_login / $ts_ip → $where"
  echo "paste it over the whole editor at https://login.tailscale.com/admin/acls/file (Cmd+A, Cmd+V), then Save."
  echo "SSH or anything else between your own devices over Tailscale? Uncomment the '\"ip\": [\"*\"]' grant before saving."
  [ "$OS" = Darwin ] && open "https://login.tailscale.com/admin/acls/file" 2>/dev/null || true
  exit 0
fi

echo "home-llm-up: role=$ROLE os=$OS root=$DOTFILES_ROOT"

# ---------------------------------------------------------------- 1. apps
step "1. Apps (Tailscale$([ "$ROLE" = hub ] && echo ', LM Studio'))"
if [ "$OS" = Darwin ]; then
  # The casks are declared in domains/dev/packages/homebrew.nix (nix-darwin
  # homebrew.casks, cleanup "none"), so installing the same cask here directly
  # is what the next `make update` would do, minus the full system switch —
  # and minus the failure mode measured 2026-09-23: `brew bundle` inside the
  # switch dies on an app that was installed from a DMG by hand (chgrp
  # "Operation not permitted", then the whole activation aborts). An app that
  # exists but is not brew-managed is adopted (`--adopt` records it when its
  # version equals the cask's), and anything brew cannot settle becomes an
  # owner step instead of killing this script.
  cask_app() {
    local cask="$1" app="$2"
    if brew list --cask "$cask" >/dev/null 2>&1; then ok "$cask (brew)"; return; fi
    if [ -d "$app" ]; then
      # `--adopt` only records an app whose version equals the cask's; compare
      # first, because a doomed attempt still asks for sudo (chgrp) and shows
      # the owner a bare "Password:" with no explanation (measured 2026-09-23).
      local have want
      have="$(defaults read "$app/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || true)"
      want="$(brew info --cask --json=v2 "$cask" 2>/dev/null | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -1 | tr ',' '+')"
      if [ -n "$have" ] && [ "$have" = "$want" ] && brew install --cask --adopt "$cask" >/dev/null 2>&1; then
        did "$cask adopted (was installed by hand, version $have)"
      else
        todo "$app is installed by hand at version ${have:-?}, the cask ($cask) is ${want:-?}: update it from inside the app, or quit it and move it to the Trash (models and settings live under ~/.lmstudio and ~/Library, not in the app); then re-run"
      fi
    else
      brew install --cask "$cask" >/dev/null 2>&1 && did "$cask installed" || todo "brew install --cask $cask failed — run it by hand to see why"
    fi
  }
  cask_app tailscale-app /Applications/Tailscale.app
  [ "$ROLE" = hub ] && cask_app lm-studio "/Applications/LM Studio.app"
  [ -z "$TS_BIN" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && TS_BIN=/Applications/Tailscale.app/Contents/MacOS/Tailscale
else
  [ -n "$TS_BIN" ] && ok "tailscale on PATH" || todo "install tailscale (https://tailscale.com/download/linux) and re-run"
fi

# ------------------------------------------------------------ 2. tailscale
step "2. Tailscale login"
TS_UP=0
if [ -n "$TS_BIN" ]; then
  # A freshly installed Tailscale has no backend yet: from a sandbox the CLI
  # answers "The Tailscale CLI failed to start: Failed to load preferences"
  # at once, but from the owner's GUI session it launches the app and waits
  # for a backend that never comes until someone logs in — the script hung
  # here on 2026-09-23. So: open the app first (a no-op when it runs), give
  # the CLI ten seconds, and treat anything but Running as "log in".
  [ "$OS" = Darwin ] && { open -a Tailscale 2>/dev/null || true; sleep 2; }
  ts_json="$(capped 10 "$TS_BIN" status --json 2>/dev/null || true)"
  state="$(printf '%s' "$ts_json" | sed -n 's/.*"BackendState": *"\([A-Za-z]*\)".*/\1/p' | head -1)"
  if [ "$state" = Running ]; then
    TS_UP=1; ok "logged in ($(printf '%s' "$ts_json" | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -1))"
  else
    todo "log in to Tailscale (menu-bar app on macOS: Log in; Linux: sudo tailscale up), then re-run this script for the serve steps"
  fi
fi

# ----------------------------------------------------------------- 3. link
step "3. make link (config symlinks, launchd plists, jig apply for every harness)"
# ~/.config/litellm becomes a symlink to the repo directory (an existing real
# directory is backed up by link_file first); the launchd plists are written
# as expanded copies. Idempotent.
make -C "$DOTFILES_ROOT" link >"${TMPDIR:-/tmp}/home-llm-link.log" 2>&1 \
  && ok "linked (log: ${TMPDIR:-/tmp}/home-llm-link.log)" \
  || todo "make link failed — see ${TMPDIR:-/tmp}/home-llm-link.log"

# -------------------------------------------------------------- 4. litellm
step "4. LiteLLM (loopback :4000, metrics :4001)"
if [ "$OS" = Darwin ]; then
  if security find-generic-password -s litellm-op-token -w >/dev/null 2>&1; then
    ok "1Password service-account token in the login Keychain"
  else
    todo "put the 1Password service-account token in the Keychain once: security add-generic-password -a \"\$USER\" -s litellm-op-token -w '<token>' (litellm/README.md, 'Interactive vs headless op')"
  fi
  if [ "$ROLE" = node ] && [ -z "$REMOTE_HOST" ]; then
    todo "node needs the hub's MagicDNS name: re-run with --remote-host mac.<tailnet>.ts.net (litellm-up.sh reads LM_STUDIO_REMOTE_HOST)"
  fi
  plist="$HOME/Library/LaunchAgents/com.esh2n.litellm-proxy.plist"
  if [ -f "$plist" ]; then
    # Node: hand the hub's name to the job through launchd's environment. The
    # plist itself carries no EnvironmentVariables; setenv is per-session.
    [ -n "$REMOTE_HOST" ] && launchctl setenv LM_STUDIO_REMOTE_HOST "$REMOTE_HOST"
    # Restart so the job picks up the litellm-up.sh make link just deployed.
    # A loaded job is restarted in place (`kickstart -k`): bootout returns
    # before the job is gone, and a bootstrap right after it fails with
    # "Bootstrap failed: 5: Input/output error" (measured 2026-09-23).
    if agent_loaded com.esh2n.litellm-proxy; then
      launchctl kickstart -k "$(uid_gui)/com.esh2n.litellm-proxy" && did "litellm-proxy restarted" || todo "launchctl kickstart -k of com.esh2n.litellm-proxy failed"
    else
      launchctl bootstrap "$(uid_gui)" "$plist" && did "litellm-proxy loaded" || todo "launchctl bootstrap of com.esh2n.litellm-proxy failed"
    fi
    # The container is recreated: give both listeners the same two minutes.
    for _ in $(seq 1 60); do port_answers http://127.0.0.1:4001/metrics && break; sleep 2; done
    port_answers http://127.0.0.1:4000/health/liveliness && ok ":4000 answers" || todo "LiteLLM did not come up on :4000 within 2 min — tail ~/Library/Logs/litellm-proxy.log"
    port_answers http://127.0.0.1:4001/metrics && ok ":4001 metrics answers" || todo "LiteLLM metrics :4001 not answering within 2 min — tail ~/Library/Logs/litellm-proxy.log (the job must run the repo's litellm-up.sh with --prometheus_metrics_port)"
  else
    todo "$plist missing — make link should have written it"
  fi
else
  todo "Linux: no resident unit for LiteLLM yet — run once by hand: LM_STUDIO_REMOTE_HOST=${REMOTE_HOST:-<mac.tailnet.ts.net>} bash $HOME/.config/litellm/litellm-up.sh (a systemd unit is a separate ruling)"
fi

# ------------------------------------------------------------ 5. lm studio
if [ "$ROLE" = hub ]; then
  step "5. LM Studio server (127.0.0.1:1234) + awake job"
  if port_answers http://127.0.0.1:1234/v1/models; then
    ok "server answers"
  elif command -v lms >/dev/null 2>&1; then
    capped 30 lms server start --port 1234 >/dev/null 2>&1 && did "lms server start --port 1234" || true
    sleep 3
    port_answers http://127.0.0.1:1234/v1/models && ok "server answers" || todo "LM Studio server not answering — open LM Studio once, Settings → 'run the LLM server on login', network 'localhost only'"
  else
    open -a "LM Studio" 2>/dev/null || true
    todo "open LM Studio once (bootstraps ~/.lmstudio/bin/lms), tick Settings → 'run the LLM server on login', keep 'localhost only'; then re-run"
  fi
  awake="$HOME/Library/LaunchAgents/com.esh2n.lmstudio-awake.plist"
  if agent_loaded com.esh2n.lmstudio-awake; then
    ok "awake job loaded"
  elif [ -f "$awake" ]; then
    launchctl bootstrap "$(uid_gui)" "$awake" && did "awake job loaded (caffeinate while the server lives)" || todo "launchctl bootstrap of com.esh2n.lmstudio-awake failed"
  else
    todo "$awake missing — make link should have written it"
  fi
fi

# ------------------------------------------------------- 6. tailscale serve
step "6. tailscale serve"
if [ "$TS_UP" = 1 ]; then
  if [ "$ROLE" = hub ]; then
    capped 20 "$TS_BIN" serve --bg --tcp 1234 tcp://127.0.0.1:1234 >/dev/null && did "tcp:1234 → LM Studio" || todo "tailscale serve --tcp 1234 failed"
    capped 20 "$TS_BIN" serve --bg --https=3001 127.0.0.1:3001 >/dev/null && did "https:3001 → Open WebUI" || todo "tailscale serve --https=3001 failed (HTTPS needs MagicDNS + HTTPS certificates enabled in the admin console)"
  else
    capped 20 "$TS_BIN" serve --bg --tcp 4001 tcp://127.0.0.1:4001 >/dev/null && did "tcp:4001 → LiteLLM metrics" || todo "tailscale serve --tcp 4001 failed"
  fi
  capped 10 "$TS_BIN" serve status 2>/dev/null | sed 's/^/    /'
else
  skip "waiting for the Tailscale login (step 2)"
fi

# -------------------------------------------------------- 7. observability
if [ "$ROLE" = hub ]; then
  step "7. Prometheus + Open WebUI (docker)"
  obs="$DOTFILES_ROOT/domains/dev/config/litellm/observability"
  if docker info >/dev/null 2>&1; then
    bash "$obs/start.sh" >/dev/null && ok "Prometheus up (127.0.0.1:9090)" || todo "observability/start.sh failed"
    echo "    (first run pulls ghcr.io/open-webui/open-webui:main — a few minutes)"
    docker compose -f "$obs/docker-compose.yml" --profile webui up -d open-webui >/dev/null 2>&1 \
      && ok "Open WebUI up (127.0.0.1:3001)" || todo "open-webui did not start — docker compose -f $obs/docker-compose.yml --profile webui up -d open-webui"
  else
    todo "docker is not answering (start OrbStack), then re-run for Prometheus / Open WebUI"
  fi
fi

# ----------------------------------------------------------- 8. pi packages
step "8. pi packages (pi-mcp-adapter, pi-subagents)"
if command -v pi >/dev/null 2>&1; then
  settings="$HOME/.pi/agent/settings.json"
  for pkg in pi-mcp-adapter @tintinweb/pi-subagents; do
    if [ -f "$settings" ] && grep -q "\"npm:$pkg" "$settings"; then
      ok "$pkg present"
    else
      capped 180 pi install "npm:$pkg" >/dev/null 2>&1 && did "pi install npm:$pkg" || todo "pi install npm:$pkg failed"
    fi
  done
else
  skip "pi not on PATH"
fi

# ------------------------------------------------------------ 9. claude mcp
step "9. Claude Code MCP servers (user scope)"
# jig prints one `claude mcp add --scope user …` line per server and never
# runs the claude CLI itself; this owner script runs the missing ones.
if command -v claude >/dev/null 2>&1; then
  registered="$(capped 60 claude mcp list 2>/dev/null || true)"
  while IFS= read -r line; do
    name="$(printf '%s' "$line" | awk '{for(i=1;i<=NF;i++) if($i=="--scope"){print $(i+2); exit}}')"
    [ -z "$name" ] && continue
    if printf '%s' "$registered" | grep -q "^$name:"; then
      ok "$name registered"
    else
      capped 60 bash -c "$line" >/dev/null 2>&1 && did "$name: $line" || todo "failed: $line"
    fi
  done < <(bash "$DOTFILES_ROOT/domains/dev/bin/jig" apply --target claude 2>/dev/null | sed -n 's/^  \(claude mcp add .*\)$/\1/p')
else
  skip "claude not on PATH"
fi

# --------------------------------------------------------------- 10. manual
step "10. Owner-only (no API for these)"
todo "tailnet ACL (once per tailnet): make home-llm-acl — renders acl.hujson with your login + IP into the clipboard and opens the console page to paste it into"
[ "$ROLE" = hub ] && todo "for each node, uncomment its target in domains/dev/config/litellm/observability/prometheus/prometheus.yml (name from 'tailscale status') and re-run observability/start.sh"

# --------------------------------------------------------------- summary
# ${arr[@]+"${arr[@]}"}: an empty array under `set -u` is an error on the
# bash 3.2 macOS ships; this expands to nothing instead.
printf '\n\033[1mRemaining owner steps (%d)\033[0m\n' "${#REMAINING[@]}"
for r in ${REMAINING[@]+"${REMAINING[@]}"}; do printf '  - %s\n' "$r"; done
