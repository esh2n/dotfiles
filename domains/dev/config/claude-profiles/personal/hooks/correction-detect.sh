#!/usr/bin/env bash
# Stop hook: detect user-correction utterances and record them as learning
# candidates (correction-driven learning: signal fires only when the user
# pushes back, instead of observing every tool call).
#
# Detection only — no headless analyzer is launched. A matched correction is
# appended to ~/.claude/homunculus/corrections.jsonl (the instinct pipeline's
# input) and a systemMessage suggests distilling it via /learn or
# retrospective-codify.
#
# Contract for Stop hooks: ALWAYS exit 0, never block the user.

set -u

finish() { exit 0; }
trap finish ERR

[ "${CORRECTION_DETECT_DISABLED:-}" = "1" ] && exit 0

INPUT=$(cat 2>/dev/null) || exit 0

# Recursion guard: do nothing when this Stop fired from a stop-hook loop.
echo "$INPUT" | jq -e '.stop_hook_active == true' >/dev/null 2>&1 && exit 0

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null | tr -cd 'a-zA-Z0-9_-')
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

# Input validation (defense in depth): session id shape, transcript must live
# under ~/.claude/ so arbitrary files can never be snapshotted.
case "$SESSION_ID" in ????????*) : ;; *) exit 0 ;; esac
case "$TRANSCRIPT" in "$HOME/.claude/"*) : ;; *) exit 0 ;; esac
[ -f "$TRANSCRIPT" ] || exit 0

STATE_DIR="${HOME}/.claude/.cache/correction-detect"
DAY=$(date +%Y%m%d)

# Debounce: at most one detection per session, capped per day.
[ -f "${STATE_DIR}/${SESSION_ID}.done" ] && exit 0
DAILY_CAP=${CORRECTION_DETECT_DAILY_CAP:-5}
COUNT=0
[ -f "${STATE_DIR}/count-${DAY}" ] && COUNT=$(tr -cd '0-9' < "${STATE_DIR}/count-${DAY}")
[ -z "$COUNT" ] && COUNT=0
[ "$COUNT" -ge "$DAILY_CAP" ] && exit 0

# Last user utterance from the transcript tail.
LAST_USER=$(tail -n 80 "$TRANSCRIPT" 2>/dev/null \
  | jq -r 'select(.type == "user") | .message.content
           | if type == "array" then (map(select(.type == "text") | .text) | join(" ")) else tostring end' 2>/dev/null \
  | grep -v '^\s*$' | tail -n 1)
[ -z "$LAST_USER" ] && exit 0

# Correction signal patterns (JP + EN). Deliberately biased toward false
# positives — the output is only a log line and a suggestion.
PATTERN='違う|ちがう|そうじゃな|じゃなくて|なんで(そう|こう|これ)|間違|まちがって|やめて|戻して|直して|修正して|しないで|するな|ルール|指示した|言ったのに|覚えて|してほしかった|wrong|not what I|why did you|I said|undo that|revert that|don.t do'
echo "$LAST_USER" | grep -qE "$PATTERN" || exit 0

# Record the candidate (mkdir-based mutex is unnecessary: appends are line-
# atomic at this size and the debounce already serializes per session).
mkdir -p "$STATE_DIR" "${HOME}/.claude/homunculus" 2>/dev/null
SNIPPET=$(echo "$LAST_USER" | head -c 500)
jq -cn --arg ts "$(date +%Y-%m-%dT%H:%M:%S)" --arg sid "$SESSION_ID" \
      --arg cwd "$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)" \
      --arg text "$SNIPPET" \
      '{ts:$ts, session:$sid, cwd:$cwd, correction:$text}' \
  >> "${HOME}/.claude/homunculus/corrections.jsonl" 2>/dev/null

: > "${STATE_DIR}/${SESSION_ID}.done" 2>/dev/null
echo $((COUNT + 1)) > "${STATE_DIR}/count-${DAY}" 2>/dev/null

printf '{"systemMessage":"是正シグナルを検出しました（homunculus/corrections.jsonl に記録）。/learn か retrospective-codify で恒久ルール化を検討してください。"}\n'
exit 0
