#!/usr/bin/env bash
# PreToolUse hook: while a session is marked unattended (YOKI_UNATTENDED=1 env
# or "unattended": true in the project's .yoki.json), block guardrail
# self-modification:
#   - Write/Edit/MultiEdit into ~/.claude/**        (installed config)
#   - Write/Edit/MultiEdit into **/claude-profiles/** (guardrail sources)
#   - Bash invoking claude-switch                    (config regeneration)
#   - Bash redirecting output into ~/.claude/**
#
# Attended sessions pass through untouched. Fail-open on parse errors: the
# guard must never block normal work because of its own failure.

[ "${UNATTENDED_GUARD_DISABLED:-}" = "1" ] && exit 0

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null) || exit 0
[ -n "$TOOL" ] || exit 0
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# Flag resolution follows the yoki gradient: env (fixed at session start)
# first, then .yoki.json (re-read per invocation, effective mid-session).
UNATTENDED=0
if [ "${YOKI_UNATTENDED:-}" = "1" ]; then
  UNATTENDED=1
elif [ -n "$CWD" ] && [ -f "$CWD/.yoki.json" ]; then
  [ "$(jq -r '.unattended // false' "$CWD/.yoki.json" 2>/dev/null)" = "true" ] && UNATTENDED=1
fi
[ "$UNATTENDED" = "1" ] || exit 0

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}

case "$TOOL" in
  Write|Edit|MultiEdit)
    FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
    [ -n "$FILE" ] || exit 0
    case "$FILE" in
      "$HOME/.claude/"*|*/claude-profiles/*)
        deny "Unattended session: editing guardrail config is blocked. Queue the change for an attended session instead."
        ;;
    esac
    ;;
  Bash)
    CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
    [ -n "$CMD" ] || exit 0
    # Strip quoted strings so a mention inside a message does not trigger.
    CMD_UNQUOTED=$(echo "$CMD" | sed -e "s/'[^']*'//g" -e 's/"[^"]*"//g')
    if echo "$CMD_UNQUOTED" | grep -qE '(^|[;&|(]|\$\()[[:space:]]*claude-switch([[:space:]]|$)'; then
      deny "Unattended session: claude-switch (config regeneration) is blocked. Queue it for an attended session."
    fi
    if echo "$CMD_UNQUOTED" | grep -qE '(>>?|[[:space:]]tee[[:space:]])[[:space:]]*(~|\$HOME|'"$HOME"')/\.claude/'; then
      deny "Unattended session: writing into ~/.claude is blocked. Queue the change for an attended session."
    fi
    ;;
esac

exit 0
