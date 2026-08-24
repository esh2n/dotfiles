#!/usr/bin/env bash
set -euo pipefail

DOTFILES_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GC="${DOTFILES_ROOT}/domains/dev/bin/code-graph-cache-gc"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

fake_bin="${fixture}/bin"
cache="${fixture}/cache"
fresh_repo="${fixture}/fresh"
stale_repo="${fixture}/stale"
mkdir -p "$fake_bin" "$cache" "$fresh_repo" "$stale_repo"

cat > "${fake_bin}/codebase-memory-mcp" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"list_projects"* ]]; then
    jq -n \
      --arg fresh "$FRESH_REPO" \
      --arg stale "$STALE_REPO" \
      '{projects:[
        {name:"fresh",root_path:$fresh,size_bytes:100},
        {name:"stale",root_path:$stale,size_bytes:200}
      ]}'
elif [[ "$*" == *"delete_project"* ]]; then
    printf '%s\n' "$*" >> "$DELETE_LOG"
fi
STUB
chmod +x "${fake_bin}/codebase-memory-mcp"

export PATH="${fake_bin}:$PATH"
export CBM_CACHE_DIR="$cache"
export FRESH_REPO="$(cd "$fresh_repo" && pwd -P)"
export STALE_REPO="$(cd "$stale_repo" && pwd -P)"
export DELETE_LOG="${fixture}/deletes.log"
export CODE_GRAPH_CACHE_TTL_DAYS=30
export CODE_GRAPH_CACHE_MAX_GIB=5

"$GC" --touch "$fresh_repo"
"$GC" --touch "$stale_repo"

stale_repo_canonical="$(cd "$stale_repo" && pwd -P)"
stale_hash="$(printf '%s' "$stale_repo_canonical" | shasum -a 256 | awk '{print $1}')"
jq --argjson old "$(( $(date +%s) - 31 * 86400 ))" \
  '.last_used = $old' "${cache}/dotfiles-access/${stale_hash}.json" \
  > "${cache}/dotfiles-access/${stale_hash}.tmp"
mv "${cache}/dotfiles-access/${stale_hash}.tmp" \
   "${cache}/dotfiles-access/${stale_hash}.json"

"$GC" --force --quiet

grep -q -- '--project stale' "$DELETE_LOG"
if grep -q -- '--project fresh' "$DELETE_LOG"; then
    echo "fresh project was deleted" >&2
    exit 1
fi

: > "$DELETE_LOG"
"$GC" --touch "$stale_repo"
jq --argjson old "$(( $(date +%s) - 31 * 86400 ))" \
  '.last_used = $old' "${cache}/dotfiles-access/${stale_hash}.json" \
  > "${cache}/dotfiles-access/${stale_hash}.tmp"
mv "${cache}/dotfiles-access/${stale_hash}.tmp" \
   "${cache}/dotfiles-access/${stale_hash}.json"
"$GC" --force --dry-run --quiet

[[ ! -s "$DELETE_LOG" ]]
echo "code graph cache GC tests passed"
