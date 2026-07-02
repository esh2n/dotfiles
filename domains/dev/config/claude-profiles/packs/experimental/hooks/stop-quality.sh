#!/usr/bin/env bash
# Stop: remind about quality checks before finishing
INPUT=$(cat)

# Prevent infinite loop
ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')
[ "$ACTIVE" = "true" ] && exit 0

# Check if there are unstaged changes (meaning work was done)
DIR="${CLAUDE_PROJECT_DIR:-.}"
CHANGES=$(git -C "$DIR" diff --name-only 2>/dev/null | wc -l | tr -d ' ')
STAGED=$(git -C "$DIR" diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')

if [ "$CHANGES" -gt 0 ] || [ "$STAGED" -gt 0 ]; then
  echo "Uncommitted changes detected ($CHANGES unstaged, $STAGED staged). Ensure tests pass and lint is clean before finishing." >&2
  exit 2
fi

exit 0
