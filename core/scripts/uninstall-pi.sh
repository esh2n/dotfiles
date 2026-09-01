#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# uninstall-pi.sh — remove the leftover pi (pi-coding-agent) install and the
# symlinks this repo used to place into it (task T34).
# -----------------------------------------------------------------------------
# pi (@earendil-works/pi-coding-agent) was retired on 2026-08-24 in favor of
# omp; the repo-owned wiring (domains/dev/config/pi/, link_pi_resources() in
# core/config/manager.sh, the pi() shell wrapper, the ypi sbx entry point) is
# gone. What is left is whatever pi itself put on this machine, and this repo
# never touches that automatically — running this script is opt-in and
# manual, exactly once, on each machine that ever ran pi.
#
# Safe to re-run: every step only removes something if it is still there.
# -----------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

PI_HOME="${HOME}/.pi"

log_info "Removing dotfiles-owned symlinks under ${PI_HOME}/agent ..."
for path in \
    "${PI_HOME}/agent/settings.json" \
    "${PI_HOME}/agent/prompts" \
    "${PI_HOME}/agent/agents/go-reviewer.md" \
    "${PI_HOME}/agent/agents/python-reviewer.md" \
    "${PI_HOME}/agent/agents/react-reviewer.md" \
    "${PI_HOME}/agent/agents/rust-reviewer.md" \
    "${PI_HOME}/agent/agents/typescript-reviewer.md" \
    "${PI_HOME}/agent/agents/claude-worker.md" \
    "${PI_HOME}/agent/extensions/yoki-guard.ts"; do
    if [[ -L "$path" ]]; then
        rm -f "$path"
        log_success "removed symlink: $path"
    fi
done

log_info "The rest of ${PI_HOME} (auth.json, sessions/, git/, npm/) is pi's"
log_info "own runtime state, not a dotfiles symlink — left untouched."
log_info "To remove pi entirely (including that state), run:"
log_info "  rm -rf ${PI_HOME}"
log_info "  npm uninstall -g --prefix ~/.local @earendil-works/pi-coding-agent"
