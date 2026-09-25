# Helpers the other fragments use: messages, command checks, a spinner for
# slow commands, and cached `<tool> init` output. Kept here, beside the
# fragments that use them; the old layout had them in core/.

typeset -g _c_red=$'\e[0;31m' _c_green=$'\e[0;32m' _c_yellow=$'\e[0;33m' \
  _c_blue=$'\e[0;34m' _c_gray=$'\e[0;90m' _c_reset=$'\e[0m'

log_info()    { print -r -- "${_c_blue}[INFO]${_c_reset} $1"; }
log_success() { print -r -- "${_c_green}[SUCCESS]${_c_reset} $1"; }
log_warn()    { print -r -- "${_c_yellow}[WARN]${_c_reset} $1"; }
log_error()   { print -r -- "${_c_red}[ERROR]${_c_reset} $1" >&2; }
log_debug()   { [[ "${DEBUG:-0}" == 1 ]] && print -r -- "${_c_gray}[DEBUG]${_c_reset} $1"; return 0; }

has_command() { (( $+commands[$1] )) || command -v "$1" >/dev/null 2>&1; }
ensure_dir()  { [[ -d "$1" ]] || mkdir -p "$1"; }

# run_with_spinner <message> <command...>: a spinner while it runs, then ✓
# or ✗ (with its output on failure).
run_with_spinner() {
  local message="$1"; shift
  local out; out="$(mktemp)" || return 1
  "$@" >"$out" 2>&1 &
  local pid=$! frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏' i=0
  while kill -0 $pid 2>/dev/null; do
    printf '\r%s %s...' "${frames:$(( i++ % ${#frames} )):1}" "$message"
    sleep 0.1
  done
  wait $pid
  local code=$?
  if (( code == 0 )); then
    printf '\r%s✓%s %s\n' "$_c_green" "$_c_reset" "$message"
  else
    printf '\r%s✗%s %s\n' "$_c_red" "$_c_reset" "$message"
    cat "$out" >&2
  fi
  rm -f "$out"
  return $code
}

# cached_eval <cache-name> <command...>: source a `<tool> init` output,
# cached until the tool's binary is newer than the cache. Empty output is not
# cached (`brew shellenv` prints nothing when its variables are inherited).
cached_eval() {
  local name="$1"; shift
  local dir="${XDG_CACHE_HOME:-$HOME/.cache}/zsh"
  local cache="$dir/$name.zsh" bin out
  bin="$(command -v "$1")" || return 1
  if [[ ! -f "$cache" || "$bin" -nt "$cache" ]]; then
    [[ -d "$dir" ]] || mkdir -p "$dir"
    out="$("$@" 2>/dev/null)" || return 1
    [[ -n "$out" ]] || return 1
    print -r -- "$out" >"$cache"
  fi
  source "$cache"
}
