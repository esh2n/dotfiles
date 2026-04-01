#!/bin/bash
set -euo pipefail

# Color theme (override with CLAUDE_STATUSLINE_COLOR env var)
# Options: gray, orange, blue, teal, green, lavender, rose, gold, slate, cyan
COLOR="${CLAUDE_STATUSLINE_COLOR:-orange}"

# Color codes
C_RESET='\033[0m'
C_GRAY='\033[38;5;245m'
C_BAR_EMPTY='\033[38;5;238m'
case "$COLOR" in
    orange)   C_ACCENT='\033[38;5;173m' ;;
    blue)     C_ACCENT='\033[38;5;74m' ;;
    teal)     C_ACCENT='\033[38;5;66m' ;;
    green)    C_ACCENT='\033[38;5;71m' ;;
    lavender) C_ACCENT='\033[38;5;139m' ;;
    rose)     C_ACCENT='\033[38;5;132m' ;;
    gold)     C_ACCENT='\033[38;5;136m' ;;
    slate)    C_ACCENT='\033[38;5;60m' ;;
    cyan)     C_ACCENT='\033[38;5;37m' ;;
    *)        C_ACCENT="$C_GRAY" ;;
esac

# Generate progress bar
generate_bar() {
    local pct=$1 bar=""
    for ((i=0; i<10; i++)); do
        local progress=$((pct - i * 10))
        if [[ $progress -ge 8 ]]; then
            bar+="${C_ACCENT}█${C_RESET}"
        elif [[ $progress -ge 3 ]]; then
            bar+="${C_ACCENT}▄${C_RESET}"
        else
            bar+="${C_BAR_EMPTY}░${C_RESET}"
        fi
    done
    echo "$bar"
}

# Format time duration
format_duration() {
    local seconds=$1
    if [[ $seconds -lt 60 ]]; then
        echo "<1m"
    elif [[ $seconds -lt 3600 ]]; then
        echo "$((seconds / 60))m"
    elif [[ $seconds -lt 86400 ]]; then
        local h=$((seconds / 3600))
        local m=$(((seconds % 3600) / 60))
        if [[ $m -eq 0 ]]; then
            echo "${h}h"
        else
            echo "${h}h${m}m"
        fi
    else
        local d=$((seconds / 86400))
        local h=$(((seconds % 86400) / 3600))
        if [[ $h -eq 0 ]]; then
            echo "${d}d"
        else
            echo "${d}d${h}h"
        fi
    fi
}

# Read input
input=$(cat)

# Extract all needed values in single jq call
eval "$(echo "$input" | jq -r '
    @sh "model=\(.model.display_name // .model.id // "?")",
    @sh "cwd=\(.cwd // "")",
    @sh "transcript_path=\(.transcript_path // "")",
    @sh "max_context=\(.context_window.context_window_size // 200000)",
    @sh "session_id=\(.session_id // "")"
')"

dir=$(basename "$cwd" 2>/dev/null || echo "?")
max_k=$((max_context / 1000))

# Git status
branch=""
git_status=""
if [[ -n "$cwd" && -d "$cwd" ]]; then
    # Check if worktree
    if git -C "$cwd" rev-parse --is-inside-work-tree &>/dev/null; then
        branch=$(git -C "$cwd" branch --show-current 2>/dev/null)

        # Detect worktree
        git_dir=$(git -C "$cwd" rev-parse --git-dir 2>/dev/null)
        is_worktree=""
        [[ "$git_dir" == *".git/worktrees/"* ]] && is_worktree="🌲"

        if [[ -n "$branch" ]]; then
            # Count uncommitted files
            file_count=$(git -C "$cwd" --no-optional-locks status --porcelain -uall 2>/dev/null | wc -l | tr -d ' ')

            # Check sync status with upstream
            sync_status=""
            if upstream=$(git -C "$cwd" rev-parse --abbrev-ref @{upstream} 2>/dev/null); then
                # Get last fetch time
                fetch_head="$cwd/.git/FETCH_HEAD"
                [[ "$git_dir" == *".git/worktrees/"* ]] && fetch_head="${git_dir}/../../FETCH_HEAD"

                fetch_ago=""
                if [[ -f "$fetch_head" ]]; then
                    fetch_time=$(stat -f %m "$fetch_head" 2>/dev/null || stat -c %Y "$fetch_head" 2>/dev/null)
                    if [[ -n "$fetch_time" ]]; then
                        fetch_ago=$(format_duration $(($(date +%s) - fetch_time)))
                    fi
                fi

                counts=$(git -C "$cwd" rev-list --left-right --count HEAD...@{upstream} 2>/dev/null || echo "0	0")
                ahead=$(echo "$counts" | cut -f1)
                behind=$(echo "$counts" | cut -f2)

                if [[ "$ahead" -eq 0 && "$behind" -eq 0 ]]; then
                    sync_status="synced${fetch_ago:+ $fetch_ago ago}"
                elif [[ "$ahead" -gt 0 && "$behind" -eq 0 ]]; then
                    sync_status="↑${ahead}"
                elif [[ "$ahead" -eq 0 && "$behind" -gt 0 ]]; then
                    sync_status="↓${behind}"
                else
                    sync_status="↑${ahead}↓${behind}"
                fi
            else
                sync_status="no upstream"
            fi

            # Build git status string
            if [[ "$file_count" -eq 0 ]]; then
                git_status="(clean, ${sync_status})"
            elif [[ "$file_count" -eq 1 ]]; then
                single_file=$(git -C "$cwd" --no-optional-locks status --porcelain -uall 2>/dev/null | head -1 | sed 's/^...//')
                git_status="(${single_file}, ${sync_status})"
            else
                git_status="(${file_count} files, ${sync_status})"
            fi

            # Add worktree indicator
            [[ -n "$is_worktree" ]] && branch="${is_worktree}${branch}"
        fi
    fi
fi

# Context calculation and session time
pct=10
pct_prefix="~"
session_duration=""
if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
    # Get context and first message timestamp in single jq call
    read -r context_length first_timestamp < <(jq -rs '
        (map(select(.message.usage and .isSidechain != true and .isApiErrorMessage != true)) | last |
            if . then
                (.message.usage.input_tokens // 0) +
                (.message.usage.cache_read_input_tokens // 0) +
                (.message.usage.cache_creation_input_tokens // 0)
            else 0 end
        ) as $ctx |
        (.[0].snapshot.timestamp // .[0].timestamp // null) as $ts |
        "\($ctx) \($ts)"
    ' < "$transcript_path" 2>/dev/null || echo "0 null")

    if [[ "$context_length" -gt 0 ]]; then
        pct=$((context_length * 100 / max_context))
        pct_prefix=""
    fi

    # Calculate session duration
    if [[ -n "$first_timestamp" && "$first_timestamp" != "null" ]]; then
        # Try gdate (GNU) first, then BSD date
        if command -v gdate &>/dev/null; then
            first_epoch=$(gdate -d "$first_timestamp" +%s 2>/dev/null || echo "")
            now_epoch=$(gdate +%s)
        else
            first_epoch=$(/bin/date -j -f "%Y-%m-%dT%H:%M:%S" "${first_timestamp%%.*}" +%s 2>/dev/null || echo "")
            now_epoch=$(/bin/date +%s)
        fi
        if [[ -n "$first_epoch" ]]; then
            session_seconds=$((now_epoch - first_epoch))
            session_duration=$(format_duration "$session_seconds")
        fi
    fi
fi
[[ $pct -gt 100 ]] && pct=100

bar=$(generate_bar "$pct")
ctx="${bar} ${C_GRAY}${pct_prefix}${pct}% of ${max_k}k"
[[ -n "$session_duration" ]] && ctx+=" | ⏱ ${session_duration}"

# Build output
output="${C_ACCENT}${model}${C_GRAY} | 📁 ${dir}"
[[ -n "$branch" ]] && output+=" | 🔀 ${branch} ${git_status}"
output+=" | ${ctx}${C_RESET}"

printf '%b\n' "$output"

# Last user message
if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
    plain_output="${model} | 📁 ${dir}"
    [[ -n "$branch" ]] && plain_output+=" | 🔀 ${branch} ${git_status}"
    plain_output+=" | xxxxxxxxxx ${pct}% of ${max_k}k"
    max_len=${#plain_output}

    last_user_msg=$(jq -rs '
        def is_unhelpful:
            startswith("[Request interrupted") or
            startswith("[Request cancelled") or
            . == "";

        [.[] | select(.type == "user") |
         select(.message.content | type == "string" or
                (type == "array" and any(.[]; .type == "text")))] |
        reverse |
        map(.message.content |
            if type == "string" then .
            else [.[] | select(.type == "text") | .text] | join(" ") end |
            gsub("\n"; " ") | gsub("  +"; " ")) |
        map(select(is_unhelpful | not)) |
        first // ""
    ' < "$transcript_path" 2>/dev/null || echo "")

    if [[ -n "$last_user_msg" ]]; then
        if [[ ${#last_user_msg} -gt $max_len ]]; then
            echo "💬 ${last_user_msg:0:$((max_len - 3))}..."
        else
            echo "💬 ${last_user_msg}"
        fi
    fi
fi
