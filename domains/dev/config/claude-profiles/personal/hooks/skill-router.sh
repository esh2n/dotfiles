#!/usr/bin/env bash
#
# Skill router: hand the submitted prompt to jig, which asks the judgment service
# which skill it matches, and return that skill's path as context.
#
# Why this hook exists. A harness renders its skill list into the system prompt
# before the model sees a request, and nothing a hook does can remove what is
# already in that prompt — so the list (58 skills, 4,674 tokens on this machine)
# is a fixed cost on every request, and the model's own selection over it degrades
# as it grows. Dropping the list from the prompt (disable-model-invocation) trades
# that fixed cost for one judgment per prompt, and this hook puts the single skill
# that fits back into the request.
#
# Failure policy: fail open, always. This hook can only ADD text to a request.
# jig already returns the empty string for every failure it knows about (no
# service, unreadable catalog, malformed payload, confidence below the gate), so
# this wrapper only has to survive its own mistakes: a missing interpreter or a
# moved checkout must print nothing and exit 0, never delay the prompt or turn a
# broken router into a blocked request. Exit code 2 on this event erases the
# user's prompt, so a non-zero exit is never allowed to escape.
set -uo pipefail

JIG_DIR="${JIG_DIR:-$HOME/go/github.com/esh2n/dotfiles/domains/dev/llm/harness/jig}"

# Bun is normally a mise shim on PATH; fall back to the version-pinned install the
# judgment service's own launcher uses, so the hook works with launchd's minimal
# PATH as well as an interactive shell's.
bun_bin="$(command -v bun 2>/dev/null || true)"
if [[ ! -x "$bun_bin" ]]; then
    bun_bin="$HOME/.local/share/mise/installs/bun/1.3.13/bin/bun"
fi
[[ -x "$bun_bin" ]] || exit 0
[[ -f "$JIG_DIR/src/cli/jig.ts" ]] || exit 0

out="$("$bun_bin" "$JIG_DIR/src/cli/jig.ts" hooks user-prompt-submit 2>/dev/null)" || exit 0
printf '%s' "$out"
