#!/usr/bin/env bash
# PreToolUse hook for the Workflow tool: cost guardrail at the graph BOUNDARY.
#
# Graphs must run uninterrupted once started (no mid-graph approval), so the
# guard lives here instead: the first launch of a given workflow per session is
# denied once with a cost note (the reason is fed back to the agent, forcing a
# look-at-the-cost turn); an identical retry passes. A daily launch cap breaks
# runaway loops (workflow calls inside /loop or cron).
#
# Escape hatches: WORKFLOW_GUARD_DISABLED=1, or "workflow-guard" in the
# project's .yoki.json disabledHooks. Fails open on any internal error.

[ "${WORKFLOW_GUARD_DISABLED:-}" = "1" ] && exit 0

INPUT=$(cat 2>/dev/null) || exit 0
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null) || exit 0
[ "$TOOL" = "Workflow" ] || exit 0

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "nosession"' 2>/dev/null | tr -cd 'a-zA-Z0-9_-')
NAME=$(echo "$INPUT" | jq -r '.tool_input.name // .tool_input.scriptPath // "inline-script"' 2>/dev/null | tr -cd 'a-zA-Z0-9_./-' | tr '/' '_')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# .yoki.json opt-out (same upward search as hook-flags.js)
DIR="${CWD:-.}"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [ -f "$DIR/.yoki.json" ]; then
    jq -e '.disabledHooks // [] | index("workflow-guard")' "$DIR/.yoki.json" >/dev/null 2>&1 && exit 0
    break
  fi
  P=$(dirname "$DIR"); [ "$P" = "$DIR" ] && break; DIR="$P"
done

STATE="$HOME/.claude/.cache/workflow-guard"
DAY=$(date +%Y%m%d)
CAP=${YOKI_WORKFLOW_DAILY_CAP:-5}

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}

COUNT=0
[ -f "$STATE/count-$DAY" ] && COUNT=$(tr -cd '0-9' < "$STATE/count-$DAY")
[ -z "$COUNT" ] && COUNT=0
if [ "$COUNT" -ge "$CAP" ]; then
  deny "Workflow daily cap reached ($COUNT/$CAP). Workflows are expensive (recent runs: 0.6-1.5M tokens each). Raise YOKI_WORKFLOW_DAILY_CAP or set WORKFLOW_GUARD_DISABLED=1 if this is intentional."
fi

MARK="$STATE/$SESSION_ID-$NAME"
if [ ! -f "$MARK" ]; then
  mkdir -p "$STATE" 2>/dev/null && : > "$MARK" 2>/dev/null
  deny "Cost check for workflow '$NAME': recent runs consumed 0.6-1.5M subagent tokens. If the scope and model tier (default sonnet) are right, re-run the same call to launch. Today: $COUNT/$CAP launches used."
fi

echo $((COUNT + 1)) > "$STATE/count-$DAY" 2>/dev/null
exit 0
