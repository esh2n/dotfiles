#!/usr/bin/env bash
# PostToolUse(Bash): log all executed bash commands
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$CMD" ] && exit 0

DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG="$DIR/.claude/audit.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null

# Rotate: keep the log under ~1MB (trim to last 2000 lines)
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then
    tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

echo "$(date +%Y-%m-%dT%H:%M:%S) $CMD" >> "$LOG" 2>/dev/null
exit 0
