#!/usr/bin/env bash
# PreToolUse hook: block git commit/push/reset without user approval
# Catches all bypass methods: pipes, &&, ;, ||, option insertion

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ "$TOOL" != "Bash" ] && exit 0

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Block: git push (any form including -C, --no-pager, piped)
if echo "$CMD" | grep -qEi '(^|[;&|]\s*)git\s+(-\S+\s+)*push'; then
  echo '{"decision":"block","reason":"git push blocked. Use /commit-push-pr skill or ask user explicitly."}'
  exit 0
fi

# Block: git commit (any form)
if echo "$CMD" | grep -qEi '(^|[;&|]\s*)git\s+(-\S+\s+)*commit'; then
  echo '{"decision":"block","reason":"git commit blocked. Use /commit skill or ask user explicitly."}'
  exit 0
fi

# Block: git reset --hard
if echo "$CMD" | grep -qEi '(^|[;&|]\s*)git\s+(-\S+\s+)*reset\s+--hard'; then
  echo '{"decision":"block","reason":"git reset --hard blocked. Destructive operation requires explicit user approval."}'
  exit 0
fi

# Block: git checkout -- . (discard all changes)
if echo "$CMD" | grep -qEi '(^|[;&|]\s*)git\s+(-\S+\s+)*checkout\s+--\s+\.'; then
  echo '{"decision":"block","reason":"git checkout -- . blocked. Discards all changes."}'
  exit 0
fi

# Block: git clean -f
if echo "$CMD" | grep -qEi '(^|[;&|]\s*)git\s+(-\S+\s+)*clean\s+-f'; then
  echo '{"decision":"block","reason":"git clean -f blocked. Removes untracked files."}'
  exit 0
fi

# Block: force push
if echo "$CMD" | grep -qEi '(^|[;&|]\s*)git\s+(-\S+\s+)*push\s+.*--force'; then
  echo '{"decision":"block","reason":"Force push blocked."}'
  exit 0
fi

exit 0
