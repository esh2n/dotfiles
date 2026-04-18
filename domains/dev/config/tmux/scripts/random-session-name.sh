#!/usr/bin/env bash
set -euo pipefail

adjectives=(swift calm bold bright cool dark fast keen mild warm
            sharp quiet brave noble fierce gentle lucky proud vivid
            amber coral azure golden silver rustic mossy frosty dusty
            crisp)

animals=(fox owl bear wolf lynx hawk deer crow dove elk
         orca hare wren swan moth frog toad newt crab lark
         seal puma vole mink ibis kite dace shad bass perch)

existing=$(tmux list-sessions -F '#{session_name}' 2>/dev/null || true)

for _ in {1..10}; do
    adj=${adjectives[RANDOM % ${#adjectives[@]}]}
    animal=${animals[RANDOM % ${#animals[@]}]}
    name="${adj}-${animal}"
    if ! echo "$existing" | grep -qx "$name"; then
        echo "$name"
        exit 0
    fi
done

# fallback
echo "session-$$"
