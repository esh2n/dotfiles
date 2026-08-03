#!/usr/bin/env bash
# SessionStart hook: warn when the repo has accumulated too many worktrees.
#
# Why: Claude Code's sandbox adds every worktree as a write root and inlines
# the seatbelt profile into argv. Past ~15 worktrees the profile can exceed
# ARG_MAX and every Bash call fails with posix_spawn E2BIG (observed at 67
# worktrees). Warning early keeps the failure mode from ever being reached.
#
# Always exits 0; silent unless the threshold is crossed.

set -u

THRESHOLD=${WORKTREE_HYGIENE_THRESHOLD:-12}

INPUT=$(cat 2>/dev/null) || exit 0
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$CWD" ] && [ -d "$CWD" ] || exit 0

git -C "$CWD" rev-parse --git-dir >/dev/null 2>&1 || exit 0

COUNT=$(git -C "$CWD" worktree list --porcelain 2>/dev/null | grep -c '^worktree ') || exit 0
[ "$COUNT" -gt "$THRESHOLD" ] || exit 0

jq -cn --arg msg "このリポジトリのworktreeが${COUNT}個あります（推奨: ${THRESHOLD}個以下）。多すぎるとsandboxのプロファイルが肥大しBash実行がE2BIGで全滅します。不要なものを 'git worktree list' で確認し 'git worktree remove <path>' で掃除してください（--forceなしならdirtyで止まるため安全）。" \
  '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$msg}}'
exit 0
