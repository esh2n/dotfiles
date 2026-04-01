#!/usr/bin/env bash
# PostToolUse(Bash): log all executed bash commands
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$CMD" ] && exit 0

DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG="$DIR/.claude/audit.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null

echo "$(date +%Y-%m-%dT%H:%M:%S) $CMD" >> "$LOG" 2>/dev/null
exit 0
