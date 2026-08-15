#!/usr/bin/env bash
# PreToolUse hook: guard destructive git operations, keep main/master safe,
# and let feature-branch work (commit / push / PR creation) flow freely.
#
# Policy tiers:
#   deny always : force push (-f/--force), push to main/master,
#                 reset --hard, checkout -- ., clean -f,
#                 --no-verify on commit/merge/push and `commit -n` (replaces
#                 the former `npx block-no-verify` hook — no npx spawn per
#                 Bash call, and no network fetch)
#   warn-once   : git commit while on main/master, push --force-with-lease
#                 (first attempt denied with the reason fed back to the agent;
#                  an identical retry in the same session passes)
#   pr-gate     : gh pr create requires the preflight pass marker (content
#                 hash match); gate-side failures pass through, and the 3rd
#                 attempt for the same content passes with a disclosure
#                 instruction for the PR body
#   allow       : commit / push on feature branches, etc.
#
# Regex anchors at command boundaries ((^|[;&|(]|$() ) so occurrences inside
# commit messages or heredocs do not trigger the guard.

[ "${GIT_GUARD_DISABLED:-}" = "1" ] && exit 0

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null) || exit 0
[ "$TOOL" != "Bash" ] && exit 0

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -z "$CMD" ] && exit 0

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "nosession"' 2>/dev/null | tr -cd 'a-zA-Z0-9_-')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# Command-boundary anchor: start of string, after ; & | ( or $(
B='(^|[;&|(]|\$\()[[:space:]]*'
G="${B}git[[:space:]]+(-[^[:space:]]+[[:space:]]+)*"

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}

# Current branch + worktree detection (fail-open: guard must not break git
# when repo state is odd). Inside a linked worktree, commit/push flow freely —
# worktrees are the sanctioned isolation for agent work.
BRANCH=""
IS_WORKTREE=0
if [ -n "$CWD" ] && [ -d "$CWD" ]; then
  BRANCH=$(git -C "$CWD" rev-parse --abbrev-ref HEAD 2>/dev/null) || BRANCH=""
  GIT_DIR=$(git -C "$CWD" rev-parse --git-dir 2>/dev/null) || GIT_DIR=""
  GIT_COMMON=$(git -C "$CWD" rev-parse --git-common-dir 2>/dev/null) || GIT_COMMON=""
  if [ -n "$GIT_DIR" ] && [ -n "$GIT_COMMON" ] && [ "$GIT_DIR" != "$GIT_COMMON" ]; then
    IS_WORKTREE=1
  fi
fi

# ---- deny always -----------------------------------------------------------

if echo "$CMD" | grep -qEi "${G}push([[:space:]]|$)" \
   && echo "$CMD" | grep -qEi "(^|[[:space:]])(-f|--force)([[:space:]]|$)"; then
  deny "Force push blocked. Use --force-with-lease if rewriting a feature branch is truly needed."
fi

if echo "$CMD" | grep -qEi "${G}push([[:space:]]+[^[:space:]]+)*[[:space:]]+(origin[[:space:]]+)?(main|master)([[:space:]]|:|$)"; then
  deny "Push to main/master blocked. Push a feature branch and open a PR instead."
fi

if echo "$CMD" | grep -qEi "${G}push" && { [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; }; then
  deny "You are on ${BRANCH}. Create a feature branch before pushing."
fi

if echo "$CMD" | grep -qEi "${G}reset[[:space:]]+--hard"; then
  deny "git reset --hard blocked. Destructive operation requires explicit user approval."
fi

if echo "$CMD" | grep -qEi "${G}checkout[[:space:]]+--[[:space:]]+\."; then
  deny "git checkout -- . blocked. Discards all working-tree changes."
fi

if echo "$CMD" | grep -qEi "${G}clean[[:space:]]+-[a-z]*f"; then
  deny "git clean -f blocked. Removes untracked files."
fi

# --no-verify skips pre-commit/commit-msg/pre-push hooks. Normalization:
# standalone-quoted single words ('--no-verify', "pr") are unquoted first so
# quoting a flag or verb cannot evade matching, THEN remaining quoted runs
# (multi-word strings like -m messages) are stripped so a message that merely
# mentions a flag does not trigger. -n is only checked for commit: on push
# it means --dry-run.
CMD_NORM=$(echo "$CMD" | sed -E "s/\"([^\" ]+)\"/\1/g; s/'([^' ]+)'/\1/g")
CMD_UNQUOTED=$(echo "$CMD_NORM" | sed -e "s/'[^']*'//g" -e 's/"[^"]*"//g')

# Scoped per shell segment (like the -n check below): the flag must sit in
# the same command segment as the git commit/merge/push, so an unrelated
# tool's --no-verify in a compound command is not a false positive.
NV_SEGS=$(printf '%s' "$CMD_UNQUOTED" | tr ';|&()' '\n' \
  | grep -Ei "(^|[[:space:]])git[[:space:]]+(-[^[:space:]]+[[:space:]]+)*(commit|merge|push)([[:space:]]|$)") || NV_SEGS=""

if [ -n "$NV_SEGS" ] \
   && printf '%s' "$NV_SEGS" | grep -qEi "(^|[[:space:]])--no-verify([[:space:]]|$)"; then
  deny "--no-verify blocked. It skips git hooks. Fix what the hooks report instead of bypassing them."
fi

# -n is scoped to the `git commit` segment only: matching it across the whole
# command misreads an unrelated `bash -n` / `grep -n` in a compound command.
COMMIT_SEG=$(printf '%s' "$CMD_UNQUOTED" | tr ';|&()' '\n' \
  | grep -Ei "(^|[[:space:]])git[[:space:]]+(-[^[:space:]]+[[:space:]]+)*commit([[:space:]]|$)" \
  | head -1)

if [ -n "$COMMIT_SEG" ] \
   && printf '%s' "$COMMIT_SEG" | grep -qEi "(^|[[:space:]])-n([[:space:]]|$)"; then
  deny "git commit -n blocked. It is short for --no-verify and skips git hooks."
fi

# ---- identity guard --------------------------------------------------------
# Optional untracked config ~/.config/git/identity-guard: lines of
# "<email-pattern> <required-remote-pattern>". If the resolved commit email
# matches a pattern but origin does NOT match its required remote, deny.
# Prevents a work identity from leaking into personal repos (and vice versa).

IDG="$HOME/.config/git/identity-guard"
if [ -f "$IDG" ] && echo "$CMD" | grep -qEi "${G}commit"; then
  EMAIL=$(git -C "${CWD:-.}" config user.email 2>/dev/null)
  ORIGIN=$(git -C "${CWD:-.}" remote get-url origin 2>/dev/null)
  if [ -n "$EMAIL" ]; then
    while read -r pat remote_pat; do
      case "$pat" in ''|'#'*) continue ;; esac
      if echo "$EMAIL" | grep -q "$pat" && ! echo "$ORIGIN" | grep -q "$remote_pat"; then
        deny "Identity mismatch: user.email ($EMAIL) matches a restricted pattern but origin ($ORIGIN) does not. Fix git config user.email before committing."
      fi
    done < "$IDG"
  fi
fi

# ---- warn-once -------------------------------------------------------------
# First attempt is denied with the reason fed back to the agent (forcing a
# reconsideration turn); an identical retry in the same session passes.

MARK_DIR="${HOME}/.claude/.cache/git-guard/${SESSION_ID}"

warn_once() {
  local key="$1" reason="$2"
  if [ -f "${MARK_DIR}/${key}" ]; then
    return 0 # already warned this session -> allow
  fi
  mkdir -p "$MARK_DIR" 2>/dev/null && : > "${MARK_DIR}/${key}" 2>/dev/null
  deny "$reason"
}

# ---- pr-gate ----------------------------------------------------------------
# The preflight workflow records sha256(git diff <merge-base(base, HEAD)>)
# into <repo>/.claude/.cache/preflight/<branch with / -> _>.pass. This gate is
# that marker's only consumer: it recomputes the hash for the current worktree
# content and compares. Tiers:
#   - gate-side failure (no repo, no base, no shasum, malformed marker): pass
#   - marker missing / hash mismatch: deny, at most twice per content — the
#     3rd attempt for the same content passes with an instruction to disclose
#     the skip in the PR body.

PR_GATE_HASH=""

pr_gate_check() {
  # 0 = pass or fail-open, 1 = marker missing, 2 = hash mismatch
  command -v shasum >/dev/null 2>&1 || return 0
  local repo_root branch marker expected base actual
  repo_root=$(git -C "${CWD:-.}" rev-parse --show-toplevel 2>/dev/null) || return 0
  [ -n "$repo_root" ] || return 0
  branch=$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null) || return 0
  { [ -n "$branch" ] && [ "$branch" != "HEAD" ]; } || return 0
  base=$(git -C "$repo_root" merge-base origin/main HEAD 2>/dev/null \
    || git -C "$repo_root" merge-base main HEAD 2>/dev/null \
    || git -C "$repo_root" merge-base origin/master HEAD 2>/dev/null \
    || git -C "$repo_root" merge-base master HEAD 2>/dev/null) || base=""
  [ -n "$base" ] || return 0
  actual=$(git -C "$repo_root" diff --no-ext-diff --no-color "$base" 2>/dev/null | shasum -a 256 | cut -d' ' -f1)
  [ -n "$actual" ] || return 0
  PR_GATE_HASH="$actual"
  marker="$repo_root/.claude/.cache/preflight/$(echo "$branch" | tr '/' '_').pass"
  [ -f "$marker" ] || return 1
  expected=$(head -1 "$marker" 2>/dev/null | tr -cd 'a-f0-9')
  [ "${#expected}" -eq 64 ] || return 0
  [ "$actual" = "$expected" ] || return 2
  return 0
}

if [ "${GIT_GUARD_PR_GATE_DISABLED:-}" != "1" ] \
   && echo "$CMD_UNQUOTED" | grep -qEi "${B}gh[[:space:]]+(-[^[:space:]]+[[:space:]]+)*pr[[:space:]]+create"; then
  pr_gate_check
  PR_GATE_RC=$?
  if [ "$PR_GATE_RC" != "0" ]; then
    PR_GATE_KEY="pr-gate-$(printf '%s' "${PR_GATE_HASH:-nohash}" | head -c 12)"
    PR_GATE_N=$(tr -cd '0-9' 2>/dev/null < "${MARK_DIR}/${PR_GATE_KEY}")
    PR_GATE_N=$(( ${PR_GATE_N:-0} + 1 ))
    mkdir -p "$MARK_DIR" 2>/dev/null && echo "$PR_GATE_N" > "${MARK_DIR}/${PR_GATE_KEY}" 2>/dev/null
    if [ "$PR_GATE_N" -ge 3 ]; then
      # Release WITHOUT a permissionDecision: an explicit allow would
      # pre-approve the ENTIRE Bash command (anything chained after the
      # gh pr create included), so stay silent toward the permission system
      # and only inject the disclosure instruction.
      printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"pr-gate released after repeated denies for the same content. You MUST state clearly in the PR body that preflight did not pass for this content."}}\n'
      exit 0
    fi
    if [ "$PR_GATE_RC" = "1" ]; then
      deny "PR creation blocked: no preflight pass marker for this branch. Run /preflight first. (attempt ${PR_GATE_N}/3 for this content; the 3rd attempt passes but the PR body must disclose the skip)"
    fi
    deny "PR creation blocked: content changed since preflight passed (hash mismatch). Re-run /preflight. (attempt ${PR_GATE_N}/3 for this content; the 3rd attempt passes but the PR body must disclose the skip)"
  fi
fi

if echo "$CMD" | grep -qEi "${G}push[[:space:]].*--force-with-lease"; then
  warn_once "force-with-lease" "force-with-lease rewrites remote history. If this is intentional (e.g. after rebase of your own feature branch), re-run the same command to proceed."
fi

if [ "$IS_WORKTREE" != "1" ] \
   && echo "$CMD" | grep -qEi "${G}commit" && { [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; }; then
  warn_once "commit-on-${BRANCH}" "You are committing directly on ${BRANCH} in the main working tree. Prefer a feature branch or a worktree. If the user explicitly asked for this, re-run the same command to proceed."
fi

exit 0
