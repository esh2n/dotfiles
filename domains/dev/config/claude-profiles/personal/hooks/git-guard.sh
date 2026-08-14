#!/usr/bin/env bash
# PreToolUse hook: guard destructive git operations, keep main/master safe,
# and let feature-branch work (commit / push / PR creation) flow freely.
#
# Policy tiers:
#   deny always : force push (-f/--force), push to main/master,
#                 reset --hard, checkout -- ., clean -f,
#                 commit/push --no-verify (replaces the former
#                 `npx block-no-verify` hook — no npx spawn per Bash call)
#   warn-once   : git commit while on main/master, push --force-with-lease
#                 (first attempt denied with the reason fed back to the agent;
#                  an identical retry in the same session passes)
#   allow       : commit / push on feature branches, gh pr create, etc.
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

if echo "$CMD" | grep -qEi "${G}(commit|push)" \
   && echo "$CMD" | grep -qEi "(^|[[:space:]])--no-verify([[:space:]]|$)"; then
  deny "--no-verify blocked. Hooks exist to catch what reviews miss — fix the failing check instead of skipping it."
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

if echo "$CMD" | grep -qEi "${G}push[[:space:]].*--force-with-lease"; then
  warn_once "force-with-lease" "force-with-lease rewrites remote history. If this is intentional (e.g. after rebase of your own feature branch), re-run the same command to proceed."
fi

if [ "$IS_WORKTREE" != "1" ] \
   && echo "$CMD" | grep -qEi "${G}commit" && { [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; }; then
  warn_once "commit-on-${BRANCH}" "You are committing directly on ${BRANCH} in the main working tree. Prefer a feature branch or a worktree. If the user explicitly asked for this, re-run the same command to proceed."
fi

exit 0
