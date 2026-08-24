#!/usr/bin/env bash
# PreToolUse hook: while a session is marked unattended (YOKI_UNATTENDED=1 env
# or "unattended": true in the project's .yoki.json), block guardrail
# self-modification:
#   - Write/Edit/MultiEdit into ~/.claude/**        (installed config)
#   - Write/Edit/MultiEdit into **/claude-profiles/** (guardrail sources)
#   - Bash invoking yoki-switch/claude-switch         (config regeneration)
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
    # A relative or ..-laden path must not dodge the prefix match: deny raw
    # traversal outright, then canonicalize the directory (best-effort) and
    # match on the resolved path.
    case "$FILE" in
      */../*|../*)
        deny "Unattended session: paths containing .. are blocked. Use the canonical path in an attended session."
        ;;
    esac
    RESOLVED="$FILE"
    FILE_DIR=$(dirname "$FILE" 2>/dev/null)
    if [ -n "$FILE_DIR" ] && [ -d "$FILE_DIR" ]; then
      RESOLVED_DIR=$(cd "$FILE_DIR" 2>/dev/null && pwd -P) && RESOLVED="${RESOLVED_DIR}/$(basename "$FILE")"
    fi
    # ~/.claude is itself a symlink into the dotfiles repo, so the canonical
    # target must be denied as well as the ~-anchored spelling. Check the raw
    # path AND the resolved one: raw catches the common spelling, resolved
    # catches symlinked/relative routes to the same files.
    HOME_CLAUDE_REAL=$(cd "$HOME/.claude" 2>/dev/null && pwd -P) || HOME_CLAUDE_REAL=""
    for CANDIDATE in "$FILE" "$RESOLVED"; do
      case "$CANDIDATE" in
        "$HOME/.claude/"*|*/claude-profiles/*)
          deny "Unattended session: editing guardrail config is blocked. Queue the change for an attended session instead."
          ;;
      esac
      if [ -n "$HOME_CLAUDE_REAL" ]; then
        case "$CANDIDATE" in
          "$HOME_CLAUDE_REAL/"*)
            deny "Unattended session: editing guardrail config is blocked. Queue the change for an attended session instead."
            ;;
        esac
      fi
    done
    ;;
  Bash)
    CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
    [ -n "$CMD" ] || exit 0
    # Normalize standalone-quoted single words ("yoki-switch") to bare form,
    # then strip remaining quoted runs (multi-word strings) so a mention
    # inside a message does not trigger.
    CMD_NORM=$(echo "$CMD" | sed -E "s/\"([^\" ]+)\"/\1/g; s/'([^' ]+)'/\1/g")
    CMD_UNQUOTED=$(echo "$CMD_NORM" | sed -e "s/'[^']*'//g" -e 's/"[^"]*"//g')

    # yoki-switch or its claude-switch alias as a word anywhere: wrapper
    # prefixes (env, time, nohup, command, xargs, ...) must not slip past a
    # start-of-segment anchor.
    if echo "$CMD_UNQUOTED" | grep -qE '(^|[[:space:];&|(])(yoki-switch|claude-switch)([[:space:]]|$)'; then
      deny "Unattended session: yoki-switch/claude-switch (config regeneration) is blocked. Queue it for an attended session."
    fi

    # Any home-anchored .claude path in the ORIGINAL command (quoted or not):
    # enumerating write syntaxes (>, tee, cp, mv, sed -i, ...) is a losing
    # game, and an unattended session has no legitimate reason to touch the
    # installed config from Bash at all. Repo-local .claude/ (e.g. worktrees)
    # stays allowed.
    if echo "$CMD" | grep -qE '(~|\$HOME|\$\{HOME\}|'"$HOME"')/\.claude/'; then
      deny "Unattended session: touching ~/.claude from Bash is blocked. Queue the change for an attended session."
    fi
    # ~/.claude is a symlink into the dotfiles repo — mentioning its canonical
    # target is the same access by another spelling.
    HOME_CLAUDE_REAL=$(cd "$HOME/.claude" 2>/dev/null && pwd -P) || HOME_CLAUDE_REAL=""
    if [ -n "$HOME_CLAUDE_REAL" ] && echo "$CMD" | grep -qF "$HOME_CLAUDE_REAL/"; then
      deny "Unattended session: touching the installed claude config from Bash is blocked. Queue the change for an attended session."
    fi

    # Guardrail sources: block write-ish commands that mention claude-profiles/.
    if echo "$CMD_NORM" | grep -qE 'claude-profiles/' \
       && echo "$CMD_UNQUOTED" | grep -qE '(>>?|(^|[[:space:];&|(])(tee|cp|mv|install|ln|rsync)([[:space:]]|$)|sed[[:space:]]+-[a-zA-Z]*i)'; then
      deny "Unattended session: writing into claude-profiles sources is blocked. Queue the change for an attended session."
    fi
    ;;
esac

exit 0
