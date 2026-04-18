#!/bin/bash
# RTK (Rust Token Killer) — PreToolUse hook for Bash commands
# Rewrites CLI commands through rtk for 60-90% token reduction
# Gracefully degrades if rtk is not installed

set -euo pipefail

# Bail if rtk is not installed
if ! command -v rtk &>/dev/null; then
    exit 0
fi

# Bail if jq is not installed
if ! command -v jq &>/dev/null; then
    exit 0
fi

# Read hook input from stdin
input=$(cat)

# Extract the command from the tool input
cmd=$(echo "$input" | jq -r '.tool_input.command // empty')

if [[ -z "$cmd" ]]; then
    exit 0
fi

# Ask rtk to rewrite the command
rewritten=$(rtk rewrite "$cmd" 2>/dev/null) || exit_code=$?
exit_code=${exit_code:-0}

case "$exit_code" in
    0)
        # Rewrite found — output updated command and auto-allow
        jq -n --arg cmd "$rewritten" '{
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
                "permissionDecisionReason": "RTK auto-rewrite",
                "updatedInput": {
                    "command": $cmd
                }
            }
        }'
        ;;
    1)
        # No equivalent — pass through unchanged
        exit 0
        ;;
    2)
        # Deny rule matched
        jq -n '{
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "RTK deny rule"
            }
        }'
        ;;
    3)
        # Ask rule matched
        jq -n '{
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "ask",
                "permissionDecisionReason": "RTK ask rule"
            }
        }'
        ;;
    *)
        # Unknown exit code — pass through
        exit 0
        ;;
esac
