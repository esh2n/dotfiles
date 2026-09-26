#!/usr/bin/env bash
# Render acl.hujson for THIS tailnet and put it where the owner can paste it.
#
# The tailnet policy lives in Tailscale's admin console, not on any machine,
# and there is no CLI that writes it (GitOps needs a repo-to-Tailscale action;
# https://tailscale.com/kb/1204/gitops-acls). The repo file keeps placeholders
# — no login or IP is committed — so this fills them from `tailscale status`,
# copies the result to the clipboard and opens the page. The owner pastes over
# the whole editor (Cmd+A, Cmd+V) and saves; the console validates the
# `tests` block before it accepts.
#
# Run: `make tailscale-acl` (from the canonical checkout), once per tailnet
# and again after editing acl.hujson.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACL="${HERE}/acl.hujson"
export PATH="/etc/profiles/per-user/$(id -un)/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

TS_BIN="$(command -v tailscale || true)"
[ -z "$TS_BIN" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && TS_BIN=/Applications/Tailscale.app/Contents/MacOS/Tailscale
[ -n "$TS_BIN" ] || { echo "tailscale CLI not found — install and log in first (make up)" >&2; exit 1; }

ts_json="$(timeout 10 "$TS_BIN" status --json 2>/dev/null || true)"
read -r ts_ip ts_login < <(printf '%s' "$ts_json" | python3 -c '
import json, sys
d = json.load(sys.stdin)
me = d["Self"]
print(me["TailscaleIPs"][0], d["User"][str(me["UserID"])]["LoginName"])
' 2>/dev/null || true)
[ -n "${ts_ip:-}" ] || { echo "tailscale status --json gave no Self/User — log in first" >&2; exit 1; }

rendered="$(sed -e "s|owner@example.com|${ts_login}|" -e "s|mac.example.ts.net|${ts_ip}|g" "$ACL")"
if command -v pbcopy >/dev/null 2>&1; then printf '%s\n' "$rendered" | pbcopy; where=clipboard
elif command -v wl-copy >/dev/null 2>&1; then printf '%s\n' "$rendered" | wl-copy; where=clipboard
elif command -v xclip >/dev/null 2>&1; then printf '%s\n' "$rendered" | xclip -selection clipboard; where=clipboard
else printf '%s\n' "$rendered"; where=stdout
fi
echo "tailnet policy rendered for ${ts_login} / ${ts_ip} → ${where}"
echo "paste it over the whole editor at https://login.tailscale.com/admin/acls/file (Cmd+A, Cmd+V), then Save."
[ "$(uname -s)" = Darwin ] && open "https://login.tailscale.com/admin/acls/file" 2>/dev/null || true
