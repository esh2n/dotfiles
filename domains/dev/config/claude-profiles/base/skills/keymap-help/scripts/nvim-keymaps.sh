#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# nvim-keymaps.sh — Neovim keymap helper (distribution-agnostic, cwd-independent)
#
# Resolves the currently active nvim distribution (via ~/.config/nvim symlink),
# dumps every live keymap from a headless nvim session, and annotates the ones
# you defined yourself in dotfiles with a ★ marker.
#
#   nvim-keymaps.sh                 全キーマップ (customは★)
#   nvim-keymaps.sh <query>         lhs / 説明を横断検索
#   nvim-keymaps.sh -c [query]      dotfilesでカスタムしたキーだけ
#   nvim-keymaps.sh -k <lhs>        指定キーの動作 (例: -k '<leader>ff')
#   nvim-keymaps.sh -m <mode>       モード絞り込み (n/i/v/x/o/t)、他フラグと併用可
#   nvim-keymaps.sh --distro        アクティブなdistroと設定パス
#   nvim-keymaps.sh --refresh       ライブダンプのキャッシュを作り直す
#   nvim-keymaps.sh --raw           整形せずTSV出力 (mode\tlhs\tdesc\tcustom)
# -----------------------------------------------------------------------------

NVIM_LINK="${HOME}/.config/nvim"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/keymap-help"
CACHE_TTL_SEC=$((60 * 60)) # 1h; also invalidated when config files change

die() { printf 'nvim-keymaps: %s\n' "$*" >&2; exit 1; }

command -v nvim >/dev/null 2>&1 || die "nvim not found in PATH"

# --- resolve active distribution + its dotfiles config dir ---------------------
resolve_config_dir() {
  if [[ -L "$NVIM_LINK" ]]; then
    # follow symlinks fully so we land in the dotfiles source dir
    local real
    real="$(cd "$NVIM_LINK" 2>/dev/null && pwd -P)" || real=""
    [[ -n "$real" ]] && { echo "$real"; return; }
  fi
  [[ -d "$NVIM_LINK" ]] && { (cd "$NVIM_LINK" && pwd -P); return; }
  die "no nvim config at $NVIM_LINK"
}

active_distro() {
  local t
  t="$(readlink "$NVIM_LINK" 2>/dev/null || true)"
  [[ -n "$t" ]] && basename "$t" | sed 's/^nvim-//' || echo "unknown"
}

CONFIG_DIR="$(resolve_config_dir)"
DISTRO="$(active_distro)"

# --- flag parsing --------------------------------------------------------------
QUERY=""; MODE_FILTER=""; ONLY_CUSTOM=0; KEY_LOOKUP=""; RAW=0; REFRESH=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -c|--custom)  ONLY_CUSTOM=1; shift ;;
    -k|--key)     KEY_LOOKUP="${2:-}"; shift 2 ;;
    -m|--mode)    MODE_FILTER="${2:-}"; shift 2 ;;
    --distro)     printf 'active distro : %s\nconfig dir    : %s\n' "$DISTRO" "$CONFIG_DIR"; exit 0 ;;
    --refresh)    REFRESH=1; shift ;;
    --raw)        RAW=1; shift ;;
    -h|--help)    sed -n '5,25p' "$0"; exit 0 ;;
    -*)           die "unknown flag: $1" ;;
    *)            QUERY="${QUERY:+$QUERY }$1"; shift ;;
  esac
done

# --- live keymap dump (cached) -------------------------------------------------
# Emits TSV: mode<TAB>lhs<TAB>desc   (leader/localleader expanded to <leader>/<localleader>)
mkdir -p "$CACHE_DIR"
CACHE_FILE="$CACHE_DIR/${DISTRO}.tsv"

# Portable file mtime in epoch seconds. Handles BSD stat (`-f %m`, macOS default)
# and GNU stat (`-c %Y`, from nix/coreutils). BSD's `-f` is a format flag while
# GNU's `-f` means --file-system and prints non-numeric output, so we accept a
# result only when it is purely numeric and otherwise fall through.
_mtime() {
  local m
  m=$(stat -f '%m' "$1" 2>/dev/null) && [[ "$m" =~ ^[0-9]+$ ]] && { echo "$m"; return; }
  m=$(stat -c '%Y' "$1" 2>/dev/null) && [[ "$m" =~ ^[0-9]+$ ]] && { echo "$m"; return; }
  echo 0
}

newest_config_mtime() {
  local newest=0 m f
  while IFS= read -r f; do
    m=$(_mtime "$f"); [[ "$m" -gt "$newest" ]] && newest="$m"
  done < <(find "$CONFIG_DIR" -name '*.lua' -type f 2>/dev/null)
  echo "$newest"
}

cache_is_fresh() {
  [[ -s "$CACHE_FILE" ]] || return 1
  local now cache_m cfg_m age
  now=$(date +%s); cache_m=$(_mtime "$CACHE_FILE")
  age=$((now - cache_m)); [[ $age -lt $CACHE_TTL_SEC ]] || return 1
  cfg_m=$(newest_config_mtime); [[ "$cache_m" -ge "$cfg_m" ]] || return 1
  return 0
}

dump_live() {
  local tmp luaf
  tmp="$(mktemp)"; luaf="$(mktemp).lua"
  # Write the dump program to a file rather than passing it via `-c`. This keeps
  # nvim's argv tiny — important when the caller's environment is already large
  # (a bloated env can push exec past ARG_MAX and fail with posix_spawn E2BIG).
  cat > "$luaf" <<'LUA'
local KM_OUT = vim.env.KM_OUT
local lead = vim.g.mapleader or "\\"
local llead = vim.g.maplocalleader or "\\"
local function norm(lhs)
  if lead ~= "" and lhs:sub(1, #lead) == lead then
    return "<leader>" .. lhs:sub(#lead + 1)
  end
  if llead ~= "" and lhs:sub(1, #llead) == llead then
    return "<localleader>" .. lhs:sub(#llead + 1)
  end
  return lhs
end

local seen, out = {}, {}
local function add(mode, lhs, desc)
  if not lhs or lhs == "" then return end
  desc = (desc or ""):gsub("[\t\n]", " ")
  local key = mode .. "\t" .. lhs
  if seen[key] == nil then
    seen[key] = #out + 1
    out[#out + 1] = mode .. "\t" .. lhs .. "\t" .. desc
  elseif desc ~= "" then
    -- keep the entry that carries a description
    out[seen[key]] = mode .. "\t" .. lhs .. "\t" .. desc
  end
end

local function dump()
  -- 1) resolved global keymaps (leader menu, which-key, custom, plugin maps)
  for _, m in ipairs({ "n", "i", "v", "x", "o", "t", "c" }) do
    for _, k in ipairs(vim.api.nvim_get_keymap(m)) do
      add(m, norm(k.lhs or ""), k.desc or k.rhs or "")
    end
  end

  -- 2) lazy.nvim plugin specs: catches lazy-loaded and buffer-local keymaps that
  --    are NOT in the global table yet, notably LSP maps (gd/gr/gI/gy...) which
  --    are only bound on LspAttach. Works for any lazy-based distro.
  local ok, cfg = pcall(require, "lazy.core.config")
  if ok and cfg.plugins then
    local function add_spec(k)
      if type(k) ~= "table" or type(k[1]) ~= "string" then return end
      local desc = k.desc or (type(k[2]) == "string" and k[2]) or ""
      local modes = k.mode or "n"
      if type(modes) == "string" then modes = { modes } end
      for _, m in ipairs(modes) do add(m, k[1], desc) end
    end
    for _, plugin in pairs(cfg.plugins) do
      if type(plugin.keys) == "table" then
        for _, k in ipairs(plugin.keys) do add_spec(k) end
      end
      local o = plugin.opts
      if type(o) == "function" then
        local base = {}
        local ok2, r = pcall(o, plugin, base)
        o = (ok2 and type(r) == "table" and r) or base
      end
      if type(o) == "table" and type(o.servers) == "table" then
        for _, srv in pairs(o.servers) do
          if type(srv) == "table" and type(srv.keys) == "table" then
            for _, k in ipairs(srv.keys) do add_spec(k) end
          end
        end
      end
    end
  end

  local f = io.open(KM_OUT, "w")
  f:write(table.concat(out, "\n"))
  f:close()
  vim.cmd("qa!")
end

pcall(vim.api.nvim_exec_autocmds, "User", { pattern = "VeryLazy" })
vim.defer_fn(dump, 1500)
LUA
  KM_OUT="$tmp" timeout 90 nvim --headless -c "luafile $luaf" >/dev/null 2>&1 || true
  rm -f "$luaf"
  if [[ -s "$tmp" ]]; then
    mv "$tmp" "$CACHE_FILE"
  else
    rm -f "$tmp"
    die "headless nvim produced no keymaps (config error?). Try: nvim --headless -c 'qa!'"
  fi
}

if [[ $REFRESH -eq 1 ]] || ! cache_is_fresh; then
  dump_live
fi

# --- custom lhs set: keys defined in the dotfiles config source ----------------
# The active config dir contains ONLY your own config (framework code lives under
# ~/.local/share/nvim), so any keymap lhs found here is a customization.
CUSTOM_SET="$(mktemp)"
{
  # vim.keymap.set(<mode>, "<lhs>", ...)  /  vim.api.nvim_set_keymap(..., "<lhs>", ...)
  grep -rhoE 'keymap\.set\([^,]+,\s*["'\''][^"'\'']+["'\'']' "$CONFIG_DIR" 2>/dev/null \
    | sed -E 's/.*,[[:space:]]*["'\'']([^"'\'']+)["'\''].*/\1/'
  # mapping-table / which-key styles: maps.n["<lhs>"] , ["<lhs>"] = { , { "<lhs>",
  grep -rhoE '\["[^"]+"\][[:space:]]*=' "$CONFIG_DIR" 2>/dev/null \
    | sed -E 's/\["([^"]+)"\].*/\1/'
  grep -rhoE '\{[[:space:]]*"[^"]+"[[:space:]]*,' "$CONFIG_DIR" 2>/dev/null \
    | sed -E 's/\{[[:space:]]*"([^"]+)".*/\1/'
} | grep -E '<leader>|<localleader>|<[CMASD]-|<Tab>|<CR>|<Esc>|<Space>|^g|^z|^\[|^\]|^<' \
  | sort -u > "$CUSTOM_SET"
trap 'rm -f "$CUSTOM_SET"' EXIT

# --- build annotated rows: mode  lhs  desc  custom(0/1) ------------------------
# Single awk pass: load the custom lhs set, then flag each live row.
ANNOTATED="$(mktemp)"; trap 'rm -f "$CUSTOM_SET" "$ANNOTATED"' EXIT
awk -F'\t' '
  NR==FNR { if ($0 != "") custom[$0]=1; next }
  $1=="" { next }
  { printf "%s\t%s\t%s\t%s\n", $1, $2, $3, (($2 in custom)?1:0) }
' "$CUSTOM_SET" "$CACHE_FILE" > "$ANNOTATED"

# --- filter --------------------------------------------------------------------
result_filter() {
  local rows; rows="$(cat "$ANNOTATED")"
  if [[ -n "$MODE_FILTER" ]]; then
    rows="$(printf '%s\n' "$rows" | awk -F'\t' -v m="$MODE_FILTER" '$1==m')"
  fi
  if [[ $ONLY_CUSTOM -eq 1 ]]; then
    rows="$(printf '%s\n' "$rows" | awk -F'\t' '$4==1')"
  fi
  if [[ -n "$KEY_LOOKUP" ]]; then
    rows="$(printf '%s\n' "$rows" | awk -F'\t' -v k="$KEY_LOOKUP" 'tolower($2)==tolower(k)')"
  elif [[ -n "$QUERY" ]]; then
    # case-insensitive match on lhs OR desc, all terms must match (AND)
    rows="$(printf '%s\n' "$rows" | awk -F'\t' -v q="$QUERY" '
      BEGIN{ n=split(tolower(q), t, /[[:space:]]+/) }
      { hay=tolower($2 "\t" $3); ok=1; for(i=1;i<=n;i++) if(index(hay,t[i])==0){ok=0;break} if(ok) print }')"
  fi
  printf '%s\n' "$rows" | sed '/^$/d'
}

ROWS="$(result_filter)"

# --- output --------------------------------------------------------------------
if [[ $RAW -eq 1 ]]; then
  printf '%s\n' "$ROWS"
  exit 0
fi

count="$(printf '%s\n' "$ROWS" | sed '/^$/d' | wc -l | tr -d ' ')"
if [[ "$count" -eq 0 ]]; then
  echo "一致なし (distro: $DISTRO)"
  [[ -n "$QUERY$KEY_LOOKUP" ]] && echo "ヒント: --custom で自作キーだけ、--refresh でダンプ再取得"
  exit 0
fi

hdr="active: $DISTRO"
[[ $ONLY_CUSTOM -eq 1 ]] && hdr="$hdr | custom only"
[[ -n "$MODE_FILTER" ]] && hdr="$hdr | mode=$MODE_FILTER"
[[ -n "$QUERY" ]] && hdr="$hdr | query=\"$QUERY\""
printf '# %s (%s件)  ★=dotfilesでカスタム\n\n' "$hdr" "$count"

printf '%s\n' "$ROWS" \
  | awk -F'\t' '{ mark=($4=="1")?"★":" "; printf "%s  %-2s  %-22s  %s\n", mark, $1, $2, $3 }' \
  | sort -k2
