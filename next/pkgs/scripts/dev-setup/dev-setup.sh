# dev-setup <checkout> <step>: one idempotent setup step each. Declared by the
# feature modules as dotfiles.setup.<name> (next/lib/mk-setup.nix), ported
# from the old installers (domains/dev/install.sh, core/install/installer.sh).
# Every step looks first and acts only on what is missing; a tool that is not
# installed skips its step with a warning.

ROOT="${1:?usage: dev-setup <checkout> <step>}"
STEP="${2:?usage: dev-setup <checkout> <step>}"

warn() { printf 'dev-setup %s: %s\n' "${STEP}" "$*" >&2; }
note() { printf 'dev-setup %s: %s\n' "${STEP}" "$*"; }
need() { # need <command>: false (and a warning) when it is not installed
	command -v "$1" >/dev/null 2>&1 || {
		warn "$1 is not installed; skipped"
		return 1
	}
}

step_capsule_daemon() {
	need capsule || return 0
	[[ -S "${HOME}/.capsule/capsule.sock" ]] && return 0
	capsule daemon install
}

# mise withdraws trust whenever the file's content changes; this checkout
# changes it, so trust is renewed before every install.
step_mise_trust() {
	need mise || return 0
	local cfg="${HOME}/.config/mise/config.toml"
	[[ -f "${cfg}" ]] || return 0
	mise trust "${cfg}" >/dev/null
}

step_nvim_default() {
	[[ -L "${HOME}/.config/nvim" || -e "${HOME}/.config/nvim" ]] && return 0
	dotctl nvim lazyvim
}

# --skip-repo: global filters only. A plain `git lfs install` inside this
# checkout adds a pre-push hook that fails under the agent sandbox.
step_git_lfs() {
	need git-lfs || return 0
	git lfs install --skip-repo
}

step_gh_extensions() {
	need gh || return 0
	local extensions=(orangain/gh-pr-graph) ext installed
	# read once: under pipefail, `gh ... | grep -q` can fail on a match
	installed="$(gh extension list 2>/dev/null || true)"
	for ext in "${extensions[@]}"; do
		grep -Fq "${ext}" <<<"${installed}" && continue
		gh extension install "${ext}"
	done
}

step_codebase_memory() {
	need codebase-memory-mcp || return 0
	codebase-memory-mcp config set auto_index true >/dev/null
	codebase-memory-mcp config set auto_watch true >/dev/null
}

# The native installer keeps Claude Code up to date by itself.
step_claude_cli() {
	[[ -x "${HOME}/.local/bin/claude" ]] && return 0
	curl -fsSL https://claude.ai/install.sh | bash
}

# User-scoped MCP servers live in ~/.claude.json, which only `claude mcp add`
# writes. jig prints one such line per server; run the ones not registered
# yet. What is registered is read from ~/.claude.json itself: `claude mcp
# list` connects to every server first, and under activation's time limit it
# can return nothing, which made every add fail as "already exists".
step_claude_mcp() {
	need claude || return 0
	need bun || return 0
	local registered line name out
	registered="$(jq -r '.mcpServers // {} | keys[]' "${HOME}/.claude.json" 2>/dev/null || true)"
	while IFS= read -r line; do
		name="$(awk '{for(i=1;i<=NF;i++) if($i=="--scope"){print $(i+2); exit}}' <<<"${line}")"
		[[ -z "${name}" ]] && continue
		grep -qx "${name}" <<<"${registered}" && continue
		note "registering ${name}"
		out="$(timeout 60 bash -c "${line}" 2>&1)" || warn "failed: ${line}: ${out}"
	done < <(bash "${ROOT}/domains/dev/bin/jig" apply --target claude 2>/dev/null | sed -n 's/^  \(claude mcp add .*\)$/\1/p')
}

step_pi_packages() {
	need pi || return 0
	local settings="${HOME}/.pi/agent/settings.json" pkg
	for pkg in pi-mcp-adapter @tintinweb/pi-subagents; do
		[[ -f "${settings}" ]] && grep -q "\"npm:${pkg}" "${settings}" && continue
		timeout 180 pi install "npm:${pkg}" >/dev/null 2>&1 || warn "pi install npm:${pkg} failed"
	done
}

step_pacifica() {
	command -v pacifica >/dev/null 2>&1 && return 0
	need cargo || return 0
	cargo install --git https://github.com/serinuntius/pacifica
}

# Warp rewrites settings.toml itself, so the live file is machine-local:
# seeded once from the tracked default, never overwritten.
step_warp_seed() {
	local dir="${ROOT}/domains/dev/config/warp"
	[[ -f "${dir}/settings.toml" || ! -f "${dir}/settings.toml.default" ]] && return 0
	cp "${dir}/settings.toml.default" "${dir}/settings.toml"
}

# ~/.config/git/config.local (included by ~/.gitconfig) holds who commits.
# Values come from the environment or the checkout's untracked .env.
step_git_identity() {
	local out="${HOME}/.config/git/config.local"
	[[ -f "${out}" ]] && grep -qE '^[[:space:]]*email[[:space:]]*=' "${out}" && return 0
	local name="${GIT_USER_NAME:-}" email="${GIT_USER_EMAIL:-}"
	if [[ (-z "${name}" || -z "${email}") && -f "${ROOT}/.env" ]]; then
		name="${name:-$(sed -n 's/^GIT_USER_NAME=//p' "${ROOT}/.env" | tail -1)}"
		email="${email:-$(sed -n 's/^GIT_USER_EMAIL=//p' "${ROOT}/.env" | tail -1)}"
	fi
	if [[ -z "${name}" || -z "${email}" ]]; then
		warn "no identity: put GIT_USER_NAME and GIT_USER_EMAIL in ${ROOT}/.env (or write ${out})"
		return 0
	fi
	mkdir -p "$(dirname "${out}")"
	printf '# Machine-specific git identity (not tracked).\n[user]\n    name = %s\n    email = %s\n' "${name}" "${email}" >"${out}"
}

step_tpm() {
	[[ -d "${HOME}/.tmux/plugins/tpm" ]] && return 0
	need git || return 0
	mkdir -p "${HOME}/.tmux/plugins"
	git clone https://github.com/tmux-plugins/tpm "${HOME}/.tmux/plugins/tpm"
}

step_zellij_plugins() {
	local dir="${HOME}/.config/zellij/plugins" name repo
	mkdir -p "${dir}"
	for repo in dj95/zjstatus imsnif/monocle; do
		name="${repo#*/}"
		[[ -s "${dir}/${name}.wasm" ]] && continue
		curl -fsSL -o "${dir}/${name}.wasm" "https://github.com/${repo}/releases/latest/download/${name}.wasm" ||
			warn "download of ${name}.wasm failed"
	done
}

# harpoon has no prebuilt release that matches every zellij: build it against
# the installed zellij's plugin API.
step_zellij_harpoon() {
	local dir="${HOME}/.config/zellij/plugins"
	[[ -s "${dir}/harpoon.wasm" ]] && return 0
	need zellij || return 0
	need cargo || return 0
	local version src
	version="$(zellij --version | awk '{print $2}')"
	need git || return 0
	src="$(mktemp -d)"
	# shellcheck disable=SC2064 # expand now: src is local
	trap "rm -rf '${src}'" RETURN
	git clone --depth 1 https://github.com/Nacho114/harpoon.git "${src}"
	sed "s/zellij-tile = \".*\"/zellij-tile = \"${version}\"/" "${src}/Cargo.toml" >"${src}/Cargo.toml.new"
	mv "${src}/Cargo.toml.new" "${src}/Cargo.toml"
	rustup target add wasm32-wasip1 >/dev/null 2>&1 || true
	cargo build --manifest-path "${src}/Cargo.toml" --release --target wasm32-wasip1
	mkdir -p "${dir}"
	cp "${src}/target/wasm32-wasip1/release/harpoon.wasm" "${dir}/"
}

# Stylus's userstyles for every theme, generated in the checkout from its
# templates (domains/system/userstyles).
step_userstyles() {
	need lessc || return 0
	need jq || return 0
	bash "${ROOT}/domains/system/userstyles/scripts/generate-userstyle.sh" all
}

# SbarLua (sketchybar's Lua module; not on luarocks) built from source into
# ~/.local/share/sketchybar_lua. It vendors Lua and only loads in an
# interpreter of the same major.minor (a mismatch is an empty bar, no error),
# so it is rebuilt whenever the running Lua changes.
step_sbarlua() {
	if command -v mise >/dev/null 2>&1; then
		eval "$(mise env -s bash 2>/dev/null)" || true
	fi
	need lua || return 0
	local target="${HOME}/.local/share/sketchybar_lua/sketchybar.so"
	local src="${HOME}/.cache/sbarlua" host built
	host="$(lua -v 2>&1 | sed -n 's/^Lua \([0-9]*\.[0-9]*\).*/\1/p')"
	if [[ -f "${target}" ]]; then
		built="$(grep -a -o 'LuaVersion: Lua [0-9]*\.[0-9]*' "${target}" | head -1 | sed 's/.*Lua //' || true)"
		[[ -n "${built}" && "${built}" == "${host}" ]] && return 0
		note "built for Lua ${built:-unknown}, lua is ${host}: rebuilding"
	fi
	need git || return 0
	need make || return 0
	if [[ -d "${src}/.git" ]]; then
		git -C "${src}" fetch --depth 1 origin
		git -C "${src}" reset --hard origin/HEAD
	else
		rm -rf "${src}"
		git clone --depth 1 https://github.com/FelixKratz/SbarLua "${src}"
	fi
	# Under launchd the lua process's parent is PID 1 at once, and SbarLua's
	# orphan check exits ~1s after start: subscribed callbacks never fire.
	local c="${src}/src/sketchybar.c"
	if [[ -f "${c}" ]] && grep -q 'if (getppid() == 1) exit(0);' "${c}"; then
		sed 's|if (getppid() == 1) exit(0);|/* orphan_check disabled for launchd compatibility */|' "${c}" >"${c}.new"
		mv "${c}.new" "${c}"
	fi
	make -C "${src}" clean >/dev/null 2>&1 || true
	make -C "${src}" install
	[[ -f "${target}" ]] || {
		warn "make install finished but ${target} is missing"
		return 1
	}
}

# A reference checkout beside this one (jig does not read it).
step_ecc() {
	local dir
	dir="$(dirname "${ROOT}")/everything-claude-code"
	[[ -d "${dir}/.git" ]] && return 0
	need git || return 0
	git clone https://github.com/affaan-m/everything-claude-code.git "${dir}"
}

case "${STEP}" in
capsule-daemon | mise-trust | nvim-default | git-lfs | gh-extensions | codebase-memory | \
	claude-cli | claude-mcp | pi-packages | pacifica | warp-seed | git-identity | tpm | \
	zellij-plugins | zellij-harpoon | ecc | userstyles | sbarlua)
	"step_${STEP//-/_}"
	;;
*)
	printf 'dev-setup: unknown step: %s\n' "${STEP}" >&2
	exit 2
	;;
esac
