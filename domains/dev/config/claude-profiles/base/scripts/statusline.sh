#!/bin/bash
set -euo pipefail

# Color theme (override with CLAUDE_STATUSLINE_COLOR env var)
# Options: gray, orange, blue, teal, green, lavender, rose, gold, slate, cyan
COLOR="${CLAUDE_STATUSLINE_COLOR:-orange}"
# Powerline mode (override with CLAUDE_STATUSLINE_POWERLINE env var)
POWERLINE="${CLAUDE_STATUSLINE_POWERLINE:-1}"

# Powerline separator (requires Nerd Font)
# bash 3.2 doesn't support $'\uXXXX', use printf for U+E0B0
PL_SEP=$(printf '\xee\x82\xb0')

# Color codes (fg and bg pairs for powerline)
C_RESET='\033[0m'
C_GRAY='\033[38;5;245m'
C_BAR_EMPTY='\033[38;5;238m'

# Truecolor support: if CLAUDE_STATUSLINE_COLOR_HEX is set, use exact theme color
HEX="${CLAUDE_STATUSLINE_COLOR_HEX:-}"
if [[ -n "$HEX" && "$HEX" =~ ^#[0-9a-fA-F]{6}$ ]]; then
    # Parse hex → RGB
    _r=$((16#${HEX:1:2}))
    _g=$((16#${HEX:3:2}))
    _b=$((16#${HEX:5:2}))
    C_ACCENT="\033[38;2;${_r};${_g};${_b}m"
    C_ACCENT_BG="\033[48;2;${_r};${_g};${_b}m"
    # For powerline segments, store as truecolor marker
    C_ACCENT_FG="truecolor:${_r};${_g};${_b}"
else
    # Fallback: 256-color palette by name
    case "$COLOR" in
        orange)   C_ACCENT='\033[38;5;173m'; C_ACCENT_BG='\033[48;5;173m'; C_ACCENT_FG='173' ;;
        blue)     C_ACCENT='\033[38;5;74m';  C_ACCENT_BG='\033[48;5;74m';  C_ACCENT_FG='74' ;;
        teal)     C_ACCENT='\033[38;5;66m';  C_ACCENT_BG='\033[48;5;66m';  C_ACCENT_FG='66' ;;
        green)    C_ACCENT='\033[38;5;71m';  C_ACCENT_BG='\033[48;5;71m';  C_ACCENT_FG='71' ;;
        lavender) C_ACCENT='\033[38;5;139m'; C_ACCENT_BG='\033[48;5;139m'; C_ACCENT_FG='139' ;;
        rose)     C_ACCENT='\033[38;5;132m'; C_ACCENT_BG='\033[48;5;132m'; C_ACCENT_FG='132' ;;
        gold)     C_ACCENT='\033[38;5;136m'; C_ACCENT_BG='\033[48;5;136m'; C_ACCENT_FG='136' ;;
        slate)    C_ACCENT='\033[38;5;60m';  C_ACCENT_BG='\033[48;5;60m';  C_ACCENT_FG='60' ;;
        cyan)     C_ACCENT='\033[38;5;37m';  C_ACCENT_BG='\033[48;5;37m';  C_ACCENT_FG='37' ;;
        *)        C_ACCENT="$C_GRAY";        C_ACCENT_BG='\033[48;5;245m'; C_ACCENT_FG='245' ;;
    esac
fi

# Secondary bg for alternating powerline segments
C_DIM_BG='\033[48;5;236m'
C_DIM_FG='236'

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

# Powerline segment helper
# Usage: pl_segment "text" bg_color prev_bg_color
# Color values: "123" (256-color) or "truecolor:R;G;B"
_color_fg() { if [[ "$1" == truecolor:* ]]; then echo "\033[38;2;${1#truecolor:}m"; else echo "\033[38;5;${1}m"; fi; }
_color_bg() { if [[ "$1" == truecolor:* ]]; then echo "\033[48;2;${1#truecolor:}m"; else echo "\033[48;5;${1}m"; fi; }

pl_segment() {
    local text="$1" bg="$2" prev_bg="${3:-}"
    if [[ "$POWERLINE" != "1" ]]; then
        echo -n "$text"
        return
    fi
    local bg_code; bg_code=$(_color_bg "$bg")
    local fg_white="\033[38;5;255m"
    if [[ -n "$prev_bg" ]]; then
        local prev_fg; prev_fg=$(_color_fg "$prev_bg")
        printf '%b' "${prev_fg}${bg_code}${PL_SEP}${C_RESET}"
    fi
    printf '%b' "${bg_code}${fg_white} ${text} ${C_RESET}"
}

# Read input
input=$(cat)

# Extract all needed values in single jq call
eval "$(echo "$input" | jq -r '
    @sh "model=\(.model.display_name // .model.id // "?")",
    @sh "cwd=\(.cwd // "")",
    @sh "transcript_path=\(.transcript_path // "")",
    @sh "max_context=\(.context_window.context_window_size // 200000)",
    @sh "session_id=\(.session_id // "")",
    @sh "total_cost=\(.cost.total_cost_usd // "")",
    @sh "rl_5h_pct=\(.rate_limits.five_hour.used_percentage // "")",
    @sh "rl_5h_resets=\(.rate_limits.five_hour.resets_at // "")",
    @sh "rl_7d_pct=\(.rate_limits.seven_day.used_percentage // "")",
    @sh "rl_7d_resets=\(.rate_limits.seven_day.resets_at // "")"
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
    # Context length: latest usage entry is near the end — avoid slurping the whole transcript
    context_length=$(tail -n 300 "$transcript_path" 2>/dev/null | jq -rs '
        map(select(.message.usage and .isSidechain != true and .isApiErrorMessage != true)) | last |
        if . then
            (.message.usage.input_tokens // 0) +
            (.message.usage.cache_read_input_tokens // 0) +
            (.message.usage.cache_creation_input_tokens // 0)
        else 0 end
    ' 2>/dev/null || echo 0)
    # First message timestamp lives on line 1
    first_timestamp=$(head -n 1 "$transcript_path" 2>/dev/null \
        | jq -r '.snapshot.timestamp // .timestamp // "null"' 2>/dev/null || echo "null")

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

# Session cost
cost_display=""
if [[ -n "$total_cost" && "$total_cost" != "null" ]]; then
    cost_display="\$${total_cost}"
fi

# Rate limits (5-hour and 7-day windows)
rate_display=""
if [[ -n "$rl_5h_pct" && "$rl_5h_pct" != "null" ]]; then
    rl_5h_int=${rl_5h_pct%.*}
    now_epoch=$(/bin/date +%s)

    # 5h reset countdown
    rl_5h_countdown=""
    if [[ -n "$rl_5h_resets" && "$rl_5h_resets" != "null" ]]; then
        rl_5h_remaining=$((rl_5h_resets - now_epoch))
        [[ $rl_5h_remaining -gt 0 ]] && rl_5h_countdown=" $(format_duration "$rl_5h_remaining")"
    fi

    # Color: green < 50, yellow 50-80, red > 80
    if [[ $rl_5h_int -gt 80 ]]; then
        rl_5h_color='\033[38;5;167m'
    elif [[ $rl_5h_int -gt 50 ]]; then
        rl_5h_color='\033[38;5;172m'
    else
        rl_5h_color="${C_GRAY}"
    fi

    rate_display+="${rl_5h_color}5h:${rl_5h_int}%${rl_5h_countdown}${C_RESET}"

    # 7d limit
    if [[ -n "$rl_7d_pct" && "$rl_7d_pct" != "null" ]]; then
        rl_7d_int=${rl_7d_pct%.*}

        rl_7d_countdown=""
        if [[ -n "$rl_7d_resets" && "$rl_7d_resets" != "null" ]]; then
            rl_7d_remaining=$((rl_7d_resets - now_epoch))
            [[ $rl_7d_remaining -gt 0 ]] && rl_7d_countdown=" $(format_duration "$rl_7d_remaining")"
        fi

        if [[ $rl_7d_int -gt 80 ]]; then
            rl_7d_color='\033[38;5;167m'
        elif [[ $rl_7d_int -gt 50 ]]; then
            rl_7d_color='\033[38;5;172m'
        else
            rl_7d_color="${C_GRAY}"
        fi

        rate_display+="${C_GRAY}/${rl_7d_color}7d:${rl_7d_int}%${rl_7d_countdown}${C_RESET}"
    fi
fi

ctx="${bar} ${C_GRAY}${pct_prefix}${pct}% of ${max_k}k"
[[ -n "$session_duration" ]] && ctx+=" | ⏱ ${session_duration}"
[[ -n "$cost_display" ]] && ctx+=" | 💰${cost_display}"
[[ -n "$rate_display" ]] && ctx+=" | ${rate_display}"

# Detect terminal width for responsive layout
term_width=$(tput cols 2>/dev/null || echo 120)

# Estimate content width (strip ANSI for measurement)
strip_ansi() { echo "$1" | sed 's/\x1b\[[0-9;]*m//g'; }

line1_plain="${model} | 📁 ${dir}"
[[ -n "$branch" ]] && line1_plain+=" | 🔀 ${branch} ${git_status}"
ctx_plain=$(strip_ansi "$(printf '%b' "$ctx")")
full_plain="${line1_plain} | ${ctx_plain}"

# Narrow threshold: wrap if full line exceeds terminal width
narrow=$(( ${#full_plain} > term_width ? 1 : 0 ))

# Build output
if [[ "$POWERLINE" == "1" ]]; then
    output=""
    output+=$(pl_segment "$model" "$C_ACCENT_FG")
    output+=$(pl_segment "📁 ${dir}" "$C_DIM_FG" "$C_ACCENT_FG")
    if [[ -n "$branch" ]]; then
        output+=$(pl_segment "🔀 ${branch} ${git_status}" "$C_ACCENT_FG" "$C_DIM_FG")
        prev_bg="$C_ACCENT_FG"
    else
        prev_bg="$C_DIM_FG"
    fi
    tail_fg=$(_color_fg "$prev_bg")
    printf '%b' "${output}${tail_fg}${PL_SEP}${C_RESET}"
    if [[ "$narrow" -eq 1 ]]; then
        # Wrap: context info on next line
        printf '\n'
        printf '%b\n' "${ctx}${C_RESET}"
    else
        printf ' '
        printf '%b\n' "${ctx}${C_RESET}"
    fi
else
    if [[ "$narrow" -eq 1 ]]; then
        # Line 1: model + dir + git
        output="${C_ACCENT}${model}${C_GRAY} | 📁 ${dir}"
        [[ -n "$branch" ]] && output+=" | 🔀 ${branch} ${git_status}"
        printf '%b\n' "${output}${C_RESET}"
        # Line 2: context info
        printf '%b\n' "${ctx}${C_RESET}"
    else
        output="${C_ACCENT}${model}${C_GRAY} | 📁 ${dir}"
        [[ -n "$branch" ]] && output+=" | 🔀 ${branch} ${git_status}"
        output+=" | ${ctx}${C_RESET}"
        printf '%b\n' "$output"
    fi
fi

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
    ' < <(tail -n 1000 "$transcript_path" 2>/dev/null) 2>/dev/null || echo "")

    if [[ -n "$last_user_msg" ]]; then
        if [[ ${#last_user_msg} -gt $max_len ]]; then
            echo "💬 ${last_user_msg:0:$((max_len - 3))}..."
        else
            echo "💬 ${last_user_msg}"
        fi
    fi
fi
