#!/usr/bin/env bash
set -euo pipefail

# English Coach hook — injects coaching instructions on UserPromptSubmit
# Toggle: english-coach on/off (persisted to ~/.claude/.english-coach)

FLAG="$HOME/.claude/.english-coach"

# Skip if not enabled
[[ -f "$FLAG" ]] && [[ "$(cat "$FLAG")" == "1" ]] || exit 0

# Find the skill file (works whether skills are symlinked or not)
SKILL=""
for candidate in \
    "$HOME/.claude/skills/english-coach/SKILL.md" \
    "$(dirname "$0")/../skills/english-coach/SKILL.md"; do
    if [[ -f "$candidate" ]]; then
        SKILL="$candidate"
        break
    fi
done

[[ -z "$SKILL" ]] && exit 0

# Strip YAML frontmatter, then JSON-escape the content
CONTENT=$(sed '1{/^---$/!q}; /^---$/,/^---$/d' "$SKILL" | python3 -c '
import sys, json
print(json.dumps(sys.stdin.read()))
')

# Inject as additionalContext
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": ${CONTENT}
  }
}
EOF
