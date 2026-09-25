#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
# dev-setup <checkout> <step>: the setup steps the old dev installer ran,
# one subcommand each. Every step looks first and acts only on what is
# missing, so running it twice changes nothing the second time.

SCRIPT="${BATS_TEST_DIRNAME}/../../next/pkgs/scripts/dev-setup/dev-setup.sh"

setup() {
	ROOT="${BATS_TEST_TMPDIR}/repo"
	BIN="${BATS_TEST_TMPDIR}/bin"
	LOG="${BATS_TEST_TMPDIR}/calls.log"
	export HOME="${BATS_TEST_TMPDIR}/home"
	mkdir -p "${ROOT}/domains/dev/bin" "${ROOT}/domains/dev/config/warp" "${BIN}" "${HOME}"
	touch "${LOG}"
}

fake() { # fake <name> [body]: records "<name> <args>", then runs body
	printf '#!/usr/bin/env bash\necho "%s $*" >>"%s"\n%s\n' "$1" "${LOG}" "${2:-}" >"${BIN}/$1"
	chmod +x "${BIN}/$1"
}

step() { PATH="${BIN}:/usr/bin:/bin" bash "${SCRIPT}" "${ROOT}" "$@"; }

@test "dev-setup: an unknown step is refused by name" {
	run step no-such-step
	[ "$status" -ne 0 ]
	[[ "$output" == *"no-such-step"* ]]
}

@test "dev-setup: a missing tool skips its step with a warning" {
	run --separate-stderr step gh-extensions
	[ "$status" -eq 0 ]
	[[ "$stderr" == *"gh"* ]]
	[ ! -s "${LOG}" ]
}

@test "dev-setup capsule-daemon: registers once, not when the socket exists" {
	fake capsule
	run step capsule-daemon
	[ "$status" -eq 0 ]
	grep -qx "capsule daemon install" "${LOG}"
	: >"${LOG}"
	mkdir -p "${HOME}/.capsule"
	python3 -c 'import socket,sys; s=socket.socket(socket.AF_UNIX); s.bind(sys.argv[1])' "${HOME}/.capsule/capsule.sock" 2>/dev/null ||
		skip "unix sockets cannot be created here (agent sandbox)"
	run step capsule-daemon
	[ ! -s "${LOG}" ]
}

@test "dev-setup mise-trust: trusts the managed config when it exists" {
	fake mise
	run step mise-trust
	[ "$status" -eq 0 ]
	[ ! -s "${LOG}" ]
	mkdir -p "${HOME}/.config/mise" && touch "${HOME}/.config/mise/config.toml"
	run step mise-trust
	grep -qx "mise trust ${HOME}/.config/mise/config.toml" "${LOG}"
}

@test "dev-setup nvim-default: picks lazyvim only when ~/.config/nvim is absent" {
	fake dotctl
	run step nvim-default
	[ "$status" -eq 0 ]
	grep -qx "dotctl nvim lazyvim" "${LOG}"
	: >"${LOG}"
	mkdir -p "${HOME}/.config" && ln -s /elsewhere "${HOME}/.config/nvim"
	run step nvim-default
	[ ! -s "${LOG}" ]
}

@test "dev-setup git-lfs: global filters only, never a hook in this checkout" {
	fake git-lfs
	fake git
	run step git-lfs
	[ "$status" -eq 0 ]
	grep -qx "git lfs install --skip-repo" "${LOG}"
}

@test "dev-setup gh-extensions: installs what is missing, leaves installed ones alone" {
	fake gh 'if [ "$1 $2" = "extension list" ]; then cat "'"${BATS_TEST_TMPDIR}"'/ext" 2>/dev/null; fi'
	run step gh-extensions
	[ "$status" -eq 0 ]
	grep -qx "gh extension install orangain/gh-pr-graph" "${LOG}"
	: >"${LOG}"
	echo "gh pr-graph  orangain/gh-pr-graph  v1" >"${BATS_TEST_TMPDIR}/ext"
	run step gh-extensions
	! grep -q "extension install" "${LOG}"
}

@test "dev-setup codebase-memory: turns on auto index and watch" {
	fake codebase-memory-mcp
	run step codebase-memory
	[ "$status" -eq 0 ]
	grep -qx "codebase-memory-mcp config set auto_index true" "${LOG}"
	grep -qx "codebase-memory-mcp config set auto_watch true" "${LOG}"
}

@test "dev-setup claude-cli: runs the native installer only when claude is absent" {
	fake curl 'echo "echo installer-ran >>'"${LOG}"'"'
	run step claude-cli
	[ "$status" -eq 0 ]
	grep -q "^curl .*claude.ai/install.sh" "${LOG}"
	grep -qx "installer-ran" "${LOG}"
	: >"${LOG}"
	mkdir -p "${HOME}/.local/bin" && printf '#!/bin/sh\n' >"${HOME}/.local/bin/claude" && chmod +x "${HOME}/.local/bin/claude"
	run step claude-cli
	[ ! -s "${LOG}" ]
}

@test "dev-setup claude-mcp: adds only the servers ~/.claude.json does not have yet, and says why one fails" {
	printf '#!/usr/bin/env bash\nprintf "wrote\\n  claude mcp add --scope user serena -- serena start\\n  claude mcp add --scope user context7 -- ctx7\\n  claude mcp add --scope user broken -- x\\n"\n' >"${ROOT}/domains/dev/bin/jig"
	fake bun
	fake claude 'case "$*" in *broken*) echo "boom: bad config" >&2; exit 1 ;; esac'
	fake timeout 'shift; exec "$@"'
	echo '{"mcpServers": {"serena": {"command": "serena"}}}' >"${HOME}/.claude.json"
	run --separate-stderr step claude-mcp
	[ "$status" -eq 0 ]
	grep -qx "claude mcp add --scope user context7 -- ctx7" "${LOG}"
	! grep -q "claude mcp add --scope user serena" "${LOG}"
	! grep -q "claude mcp list" "${LOG}"
	[[ "$stderr" == *"boom: bad config"* ]]
}

@test "dev-setup pi-packages: installs the packages settings.json does not name" {
	fake pi
	fake timeout 'shift; exec "$@"'
	mkdir -p "${HOME}/.pi/agent"
	echo '{"packages": ["npm:pi-mcp-adapter@1"]}' >"${HOME}/.pi/agent/settings.json"
	run step pi-packages
	[ "$status" -eq 0 ]
	grep -qx "pi install npm:@tintinweb/pi-subagents" "${LOG}"
	! grep -q "pi install npm:pi-mcp-adapter" "${LOG}"
}

@test "dev-setup pacifica: cargo-installs it only when missing" {
	fake cargo
	run step pacifica
	[ "$status" -eq 0 ]
	grep -qx "cargo install --git https://github.com/serinuntius/pacifica" "${LOG}"
	: >"${LOG}"
	fake pacifica
	run step pacifica
	! grep -q "^cargo" "${LOG}"
}

@test "dev-setup warp-seed: copies the default once and never over the live file" {
	echo default >"${ROOT}/domains/dev/config/warp/settings.toml.default"
	run step warp-seed
	[ "$status" -eq 0 ]
	[ "$(cat "${ROOT}/domains/dev/config/warp/settings.toml")" = default ]
	echo edited >"${ROOT}/domains/dev/config/warp/settings.toml"
	run step warp-seed
	[ "$(cat "${ROOT}/domains/dev/config/warp/settings.toml")" = edited ]
}

@test "dev-setup git-identity: writes config.local from .env, then leaves it alone" {
	printf 'GIT_USER_NAME=Someone\nGIT_USER_EMAIL=someone@example.com\n' >"${ROOT}/.env"
	run step git-identity
	[ "$status" -eq 0 ]
	grep -q "email = someone@example.com" "${HOME}/.config/git/config.local"
	grep -q "name = Someone" "${HOME}/.config/git/config.local"
	printf 'GIT_USER_NAME=Other\nGIT_USER_EMAIL=other@example.com\n' >"${ROOT}/.env"
	run step git-identity
	grep -q "email = someone@example.com" "${HOME}/.config/git/config.local"
}

@test "dev-setup git-identity: without values it says where to put them and writes nothing" {
	run --separate-stderr step git-identity
	[ "$status" -eq 0 ]
	[[ "$stderr" == *"GIT_USER_EMAIL"* ]]
	[ ! -e "${HOME}/.config/git/config.local" ]
}

@test "dev-setup tpm: clones tmux's plugin manager once" {
	fake git
	run step tpm
	[ "$status" -eq 0 ]
	grep -qx "git clone https://github.com/tmux-plugins/tpm ${HOME}/.tmux/plugins/tpm" "${LOG}"
	: >"${LOG}"
	mkdir -p "${HOME}/.tmux/plugins/tpm"
	run step tpm
	[ ! -s "${LOG}" ]
}

@test "dev-setup zellij-plugins: downloads the prebuilt plugins that are missing" {
	fake curl 'while [ $# -gt 0 ]; do if [ "$1" = -o ]; then echo wasm >"$2"; fi; shift; done'
	run step zellij-plugins
	[ "$status" -eq 0 ]
	grep -q "zjstatus/releases/latest/download/zjstatus.wasm" "${LOG}"
	grep -q "monocle/releases/latest/download/monocle.wasm" "${LOG}"
	[ -s "${HOME}/.config/zellij/plugins/zjstatus.wasm" ]
	: >"${LOG}"
	run step zellij-plugins
	! grep -q "zjstatus" "${LOG}"
}

@test "dev-setup ecc: clones the reference checkout beside this one, once" {
	fake git
	run step ecc
	[ "$status" -eq 0 ]
	grep -qx "git clone https://github.com/affaan-m/everything-claude-code.git ${BATS_TEST_TMPDIR}/everything-claude-code" "${LOG}"
}

@test "dev-setup gh-extensions: an installed extension is found under pipefail too" {
	echo "gh pr-graph  orangain/gh-pr-graph  v1" >"${BATS_TEST_TMPDIR}/ext"
	fake gh 'if [ "$1 $2" = "extension list" ]; then cat "'"${BATS_TEST_TMPDIR}"'/ext"; yes filler | head -100000; fi'
	PATH="${BIN}:/usr/bin:/bin" run bash -euo pipefail "${SCRIPT}" "${ROOT}" gh-extensions
	[ "$status" -eq 0 ]
	! grep -q "extension install" "${LOG}"
}

@test "dev-setup zellij-harpoon: a failed build leaves no scratch directory behind" {
	fake zellij 'echo "zellij 0.43.1"'
	fake cargo 'exit 1'
	fake git 'mkdir -p "$5"; echo "[dependencies]" >"$5/Cargo.toml"'
	fake rustup
	export TMPDIR="${BATS_TEST_TMPDIR}/scratch"
	mkdir -p "${TMPDIR}"
	PATH="${BIN}:/usr/bin:/bin" run bash -euo pipefail "${SCRIPT}" "${ROOT}" zellij-harpoon
	[ "$status" -ne 0 ]
	[ -z "$(ls -A "${TMPDIR}")" ]
}

@test "dev-setup userstyles: generates every theme's userstyle with the checkout's script" {
	mkdir -p "${ROOT}/domains/system/userstyles/scripts"
	printf '#!/usr/bin/env bash\necho "generate $*" >>"%s"\n' "${LOG}" >"${ROOT}/domains/system/userstyles/scripts/generate-userstyle.sh"
	fake lessc
	fake jq
	run step userstyles
	[ "$status" -eq 0 ]
	grep -qx "generate all" "${LOG}"
}

@test "dev-setup userstyles: without lessc it is skipped with a warning" {
	fake jq
	run --separate-stderr step userstyles
	[ "$status" -eq 0 ]
	[[ "$stderr" == *"lessc"* ]]
}

@test "dev-setup sbarlua: an installed module built for the running Lua is left alone" {
	fake lua 'echo "Lua 5.4.7  Copyright (C) 1994-2024"'
	mkdir -p "${HOME}/.local/share/sketchybar_lua"
	printf 'xx LuaVersion: Lua 5.4 xx' >"${HOME}/.local/share/sketchybar_lua/sketchybar.so"
	fake git
	fake make
	run step sbarlua
	[ "$status" -eq 0 ]
	! grep -q "^git\|^make" "${LOG}"
}

@test "dev-setup sbarlua: builds for the running Lua, patched for launchd, when missing or built for another Lua" {
	fake lua 'echo "Lua 5.5.0  Copyright"'
	fake git 'if [ "$1" = clone ]; then mkdir -p "$5/src"; echo "if (getppid() == 1) exit(0);" >"$5/src/sketchybar.c"; fi'
	fake make 'if [ "$3" = install ]; then mkdir -p "'"${HOME}"'/.local/share/sketchybar_lua"; printf "LuaVersion: Lua 5.5" >"'"${HOME}"'/.local/share/sketchybar_lua/sketchybar.so"; fi'
	run step sbarlua
	[ "$status" -eq 0 ]
	grep -q "^git clone --depth 1 https://github.com/FelixKratz/SbarLua ${HOME}/.cache/sbarlua" "${LOG}"
	grep -q "^make -C ${HOME}/.cache/sbarlua install" "${LOG}"
	! grep -q "getppid() == 1) exit" "${HOME}/.cache/sbarlua/src/sketchybar.c"
}

@test "dev-setup sbarlua: without lua it is skipped with a warning" {
	run --separate-stderr step sbarlua
	[ "$status" -eq 0 ]
	[[ "$stderr" == *"lua"* ]]
}
