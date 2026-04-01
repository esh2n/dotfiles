#!/usr/bin/env bash
# PostToolUse(mcp__*): log MCP tool usage
INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ -z "$TOOL" ] && exit 0

DIR="${CLAUDE_PROJECT_DIR:-.}"
LOG="$DIR/.claude/mcp-audit.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null

echo "$(date +%Y-%m-%dT%H:%M:%S) $TOOL" >> "$LOG" 2>/dev/null
exit 0
