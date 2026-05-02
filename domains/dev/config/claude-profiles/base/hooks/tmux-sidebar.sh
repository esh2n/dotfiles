#!/usr/bin/env bash
# Wrapper for tmux-agent-sidebar plugin hooks. Toggleable via chooks.
# Default: disabled (env.TMUX_SIDEBAR_DISABLED="1" in settings.json).
# Skips silently when disabled, outside tmux, or plugin not installed.

# Use ${VAR-1} (no colon) so empty string means "explicitly enabled".
if [[ "${TMUX_SIDEBAR_DISABLED-1}" == "1" ]]; then
  exit 0
fi

[[ -z "${TMUX:-}" ]] && exit 0

plugin_hook="$HOME/.tmux/plugins/tmux-agent-sidebar/hook.sh"
[[ -f "$plugin_hook" ]] || exit 0

exec bash "$plugin_hook" "$@"
