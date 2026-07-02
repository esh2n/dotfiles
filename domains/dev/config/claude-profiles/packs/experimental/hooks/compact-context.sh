#!/usr/bin/env bash
# SessionStart(compact): re-inject critical context after compaction
DIR="${CLAUDE_PROJECT_DIR:-.}"
BRANCH=$(git -C "$DIR" branch --show-current 2>/dev/null || echo "unknown")
REMOTE=$(git -C "$DIR remote get-url origin 2>/dev/null | sed -E 's#.*(github\.com|gitlab\.com)[:/]##' | sed 's/\.git$//' || echo "unknown")
RECENT=$(git -C "$DIR" log --oneline -3 2>/dev/null || echo "no commits")

cat <<EOF
Post-compaction context:
- Branch: $BRANCH
- Repo: $REMOTE
- Recent commits:
$RECENT
- IMPORTANT: Never commit/push without user instruction. Use conventional commits.
- SDD specs: ~/.config/work/$REMOTE/tasks/
EOF

exit 0
