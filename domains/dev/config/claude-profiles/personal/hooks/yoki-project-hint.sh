#!/usr/bin/env bash
# SessionStart hook: read the project's .yoki.json `langs` declaration and
# point out packs that are declared but not enabled on this machine.
#
# Full per-directory pack switching is not possible today (the harness merges
# skills globally), so this narrows the gap: default-off packs + a one-command
# enable prompt exactly when a project needs one. Always exits 0.

set -u

INPUT=$(cat 2>/dev/null) || exit 0
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$CWD" ] && [ -d "$CWD" ] || exit 0

# find .yoki.json upward (same search as hook-flags.js)
DIR="$CWD"
CFG=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [ -f "$DIR/.yoki.json" ]; then CFG="$DIR/.yoki.json"; break; fi
  PARENT=$(dirname "$DIR")
  [ "$PARENT" = "$DIR" ] && break
  DIR="$PARENT"
done
[ -n "$CFG" ] || exit 0

LANGS=$(jq -r '.langs[]? // empty' "$CFG" 2>/dev/null) || exit 0
[ -n "$LANGS" ] || exit 0

PACKS_FILE="$HOME/.claude/.claude-packs"
MISSING=""
for l in $LANGS; do
  grep -qx "$l" "$PACKS_FILE" 2>/dev/null || MISSING="$MISSING $l"
done
MISSING=$(echo "$MISSING" | tr -s ' ' | sed 's/^ //')
[ -n "$MISSING" ] || exit 0

jq -cn --arg msg "このプロジェクトの .yoki.json は langs=[$(echo "$LANGS" | tr '\n' ' ' | sed 's/ $//')] を宣言していますが、pack未有効: ${MISSING}。必要なら 'claude-switch pack enable ${MISSING}' で有効化できます（言語reviewerとpattern skillが載ります）。" \
  '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$msg}}'
exit 0
