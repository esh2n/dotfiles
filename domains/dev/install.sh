#!/usr/bin/env bash

# -----------------------------------------------------------------------------
# Dev Domain Installer
# -----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTFILES_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${DOTFILES_ROOT}/core/utils/common.sh"

log_info "Installing Dev Domain tools..."

# -----------------------------------------------------------------------------
# 0. Capsule prompt daemon (idempotent; requires capsule from nix flake input)
# -----------------------------------------------------------------------------

if has_command "capsule"; then
    if [[ ! -S "${HOME}/.capsule/capsule.sock" ]]; then
        log_info "Registering capsule prompt daemon (launchd)..."
        capsule daemon install || log_warn "capsule daemon install failed (non-critical)"
    fi
fi

# -----------------------------------------------------------------------------
# 1. Language Runtimes (mise)
# -----------------------------------------------------------------------------

if has_command "mise"; then
    log_info "Installing language runtimes via mise..."
    eval "$(mise activate bash)" 2>/dev/null || true

    if [[ -f "${HOME}/.config/mise/config.toml" ]]; then
        # This file is managed by these dotfiles. mise invalidates trust when
        # its content changes, so reconcile trust before every install/update.
        mise trust "${HOME}/.config/mise/config.toml" >/dev/null || \
            log_warn "Failed to trust managed mise config"
        mise install
    elif [[ -f "${SCRIPT_DIR}/config/mise/config.toml" ]]; then
        mise trust "${SCRIPT_DIR}/config/mise/config.toml" >/dev/null || \
            log_warn "Failed to trust managed mise config"
        MISE_CONFIG_DIR="${SCRIPT_DIR}/config/mise" mise install
    fi
    
    eval "$(mise activate bash)" 2>/dev/null || true
fi

# -----------------------------------------------------------------------------
# 2. Neovim Distributions
# -----------------------------------------------------------------------------

if [[ -f "${SCRIPT_DIR}/bin/nvim-switch" ]]; then
    chmod +x "${SCRIPT_DIR}/bin/nvim-switch"
fi

if [[ ! -d "${HOME}/.config/nvim-nvchad" ]]; then
    log_info "Cloning NvChad..."
    git clone https://github.com/NvChad/NvChad ~/.config/nvim-nvchad --depth 1
fi

if [[ ! -d "${HOME}/.config/nvim-lazyvim" ]]; then
    log_info "Cloning LazyVim..."
    git clone https://github.com/LazyVim/starter ~/.config/nvim-lazyvim
fi

if [[ ! -d "${HOME}/.config/nvim-astrovim" ]]; then
    log_info "Cloning AstroVim..."
    git clone --depth 1 https://github.com/AstroNvim/AstroNvim ~/.config/nvim-astrovim
fi

# Default ~/.config/nvim to lazyvim on first setup. Idempotent: skips if the
# user has already switched to a different distro (symlink / dir already present).
if [[ ! -L "${HOME}/.config/nvim" && ! -e "${HOME}/.config/nvim" ]]; then
    log_info "Setting default nvim config to 'lazyvim'..."
    bash "${SCRIPT_DIR}/bin/nvim-switch" lazyvim || log_warn "nvim-switch lazyvim failed (non-critical)"
fi

# -----------------------------------------------------------------------------
# 3. Zellij Plugins
# -----------------------------------------------------------------------------

log_info "Setting up Zellij plugins..."
ZELLIJ_PLUGIN_DIR="${HOME}/.config/zellij/plugins"
    mkdir -p "$ZELLIJ_PLUGIN_DIR"

if [[ ! -f "$ZELLIJ_PLUGIN_DIR/zjstatus.wasm" ]]; then
    curl -L -o "$ZELLIJ_PLUGIN_DIR/zjstatus.wasm" \
        "https://github.com/dj95/zjstatus/releases/latest/download/zjstatus.wasm" || \
        log_warn "Failed to download zjstatus plugin"
fi

# Harpoon: build from source with matching zellij-tile version
if [[ ! -f "$ZELLIJ_PLUGIN_DIR/harpoon.wasm" ]]; then
    if has_command "zellij" && has_command "cargo"; then
        ZELLIJ_VERSION=$(zellij --version | awk '{print $2}')
        log_info "Building harpoon plugin for Zellij ${ZELLIJ_VERSION}..."

        HARPOON_TMP="/tmp/harpoon-build-$$"
        git clone --depth 1 https://github.com/Nacho114/harpoon.git "$HARPOON_TMP" 2>/dev/null

        if [[ -d "$HARPOON_TMP" ]]; then
            cd "$HARPOON_TMP"
            # Update zellij-tile version to match installed zellij
            sed -i '' "s/zellij-tile = \".*\"/zellij-tile = \"${ZELLIJ_VERSION}\"/" Cargo.toml

            # Ensure wasm target is installed
            rustup target add wasm32-wasip1 2>/dev/null

            if cargo build --release --target wasm32-wasip1 2>/dev/null; then
                cp target/wasm32-wasip1/release/harpoon.wasm "$ZELLIJ_PLUGIN_DIR/"
                log_success "Harpoon plugin built successfully"
            else
                log_warn "Failed to build harpoon plugin"
            fi

            cd - > /dev/null
            rm -rf "$HARPOON_TMP"
        fi
    else
        log_warn "Skipping harpoon: zellij or cargo not installed"
    fi
fi

if [[ ! -f "$ZELLIJ_PLUGIN_DIR/monocle.wasm" ]]; then
    curl -L -o "$ZELLIJ_PLUGIN_DIR/monocle.wasm" \
        "https://github.com/imsnif/monocle/releases/latest/download/monocle.wasm" || \
        log_warn "Failed to download monocle plugin"
fi

# -----------------------------------------------------------------------------
# 4. Additional Setup
# -----------------------------------------------------------------------------

if has_command "git-lfs"; then
    log_info "Initializing git-lfs..."
    git lfs install
fi

# GitHub CLI extensions are state managed by gh itself. Install missing
# extensions here, but keep upgrades explicit so a dotfiles rebuild cannot
# silently change their behaviour.
if has_command "gh"; then
    if ! gh extension list 2>/dev/null | grep -Fq "orangain/gh-pr-graph"; then
        log_info "Installing gh-pr-graph extension..."
        gh extension install orangain/gh-pr-graph || \
            log_warn "gh-pr-graph installation failed (is gh authenticated?)"
    fi
fi

# Codebase-Memory is packaged by Nix. Its daemon coordinates concurrent
# Claude/Codex sessions and serializes per-project graph mutations.
if has_command "codebase-memory-mcp"; then
    codebase-memory-mcp config set auto_index true >/dev/null || \
        log_warn "Failed to enable Codebase-Memory auto-index"
    codebase-memory-mcp config set auto_watch true >/dev/null || \
        log_warn "Failed to enable Codebase-Memory watcher"
fi

# Claude stores user-scoped MCP servers in ~/.claude.json, outside the symlinked
# ~/.claude directory, and only `claude mcp add` writes that file. The list is
# llm/harness/mcp/servers.json (targets.claude); jig never runs the claude CLI
# itself (a ruling not yet made) and prints one `claude mcp add --scope user`
# line per server instead — this installer runs the ones not registered yet.
# (Until 2026-09-23 two of the five were hard-coded here; the generator's
# output is the one source now.)
if has_command "claude" && has_command "bun"; then
    jig_bin="${DOTFILES_ROOT}/domains/dev/bin/jig"
    registered="$(timeout 60 claude mcp list 2>/dev/null || true)"
    while IFS= read -r line; do
        name="$(printf '%s' "$line" | awk '{for(i=1;i<=NF;i++) if($i=="--scope"){print $(i+2); exit}}')"
        [[ -z "$name" ]] && continue
        if printf '%s' "$registered" | grep -q "^${name}:"; then
            continue
        fi
        log_info "Registering MCP server for Claude Code: ${name}..."
        timeout 60 bash -c "$line" >/dev/null 2>&1 || log_warn "failed: ${line}"
    done < <(bash "$jig_bin" apply --target claude 2>/dev/null | sed -n 's/^  \(claude mcp add .*\)$/\1/p')
fi

# pi reads MCP servers through the community extension pi-mcp-adapter and runs
# workflow scripts through tintinweb/pi-subagents; jig reports both as
# missing/present but does not install packages (`jig apply --target pi`).
if has_command "pi"; then
    pi_settings="${HOME}/.pi/agent/settings.json"
    for pkg in pi-mcp-adapter @tintinweb/pi-subagents; do
        if [[ -f "$pi_settings" ]] && grep -q "\"npm:${pkg}" "$pi_settings"; then
            continue
        fi
        log_info "Installing pi package: ${pkg}..."
        timeout 180 pi install "npm:${pkg}" >/dev/null 2>&1 || log_warn "pi install npm:${pkg} failed"
    done
fi

# Seed ~/.codex/config.toml (= the repo's domains/dev/config/codex/config.toml
# through the ~/.codex symlink) from the tracked default when it is missing.
#
# The seed is named `config.toml.default`, NOT `.template`, and that is the
# whole point: core/config/manager.sh's template pass renders every
# `*.template` under domains/ with an unconditional `cp`, so while this file
# carried that suffix, every installer run overwrote the live config —
# discarding yoki's managed block along with codex's own hook trust hashes,
# and restoring whatever stale MCP entries the seed still held. Same
# seed-once shape as installer.sh's ensure_warp_settings: never clobber a
# file that already exists.
ensure_codex_config() {
    local codex_dir="${DOTFILES_ROOT}/domains/dev/config/codex"
    local live="${codex_dir}/config.toml"
    local seed="${codex_dir}/config.toml.default"

    if [[ -f "$live" ]]; then
        return 0
    fi
    if [[ ! -f "$seed" ]]; then
        log_warn "Codex config seed not found: $seed"
        return 0
    fi
    cp "$seed" "$live"
    log_success "Seeded Codex config from default: $live"
}

# ~/.codex/config.toml contains machine-local trust and hook state, so it is
# intentionally not replaced wholesale by the tracked default — AGENTS.md,
# agents/*.toml, the ~/.agents/skills mount and the `[mcp_servers.<name>]`
# block all come from the jig generator (`jig apply --target codex`), and
# jig's PreToolUse guard is registered in hooks.json by `jig codex register`.
# A server already declared outside jig's managed block is left alone and
# reported rather than overwritten — see
# domains/dev/llm/harness/jig/README.md §Milestone 3a.
if has_command "codex"; then
    ensure_codex_config

    jig_bin="${DOTFILES_ROOT}/domains/dev/bin/jig"
    if [[ -f "$jig_bin" ]] && has_command "bun"; then
        log_info "Applying Codex config (AGENTS.md/agents/skills/mcp)..."
        bash "$jig_bin" apply --target codex --write || log_warn "jig apply --target codex --write failed (non-critical)"
        bash "$jig_bin" codex register --write || log_warn "jig codex register --write failed (non-critical)"
    fi
fi

# -----------------------------------------------------------------------------
# 5. Home LLM — one machine brought to the ruling
#    llm/harness/rules/decisions/2026-09-23-home-llm-lm-studio-over-tailscale-litellm-local.md
#
#    hub  = the Mac that hosts LM Studio (auto: LM Studio.app present):
#           LM Studio server + sleep guard, LiteLLM (:4000 chat, :4001 metrics),
#           `tailscale serve` 1234 (LM Studio) + https 3001 (Open WebUI),
#           Prometheus + Open WebUI.
#    node = any other machine: LiteLLM pointed at the hub
#           (LM_STUDIO_REMOTE_HOST), `tailscale serve` 4001 (metrics only).
#
#    Idempotent: every step looks first and acts only on what is missing.
#    What no script can do (a GUI login, a checkbox inside an app, the tailnet
#    policy in the admin console) is collected in HOME_LLM_TODO and printed at
#    the end. Anything that can wait on a GUI or the network runs under
#    `timeout` (coreutils, from the nix profile), so a stuck tool becomes a
#    line in that list instead of an installer that never returns.
# -----------------------------------------------------------------------------

HOME_LLM_TODO=()
hl_todo() { HOME_LLM_TODO+=("$*"); log_warn "$*"; }
hl_port() { curl -sf --max-time 2 "$1" >/dev/null 2>&1; }
hl_agent_loaded() { launchctl print "gui/$(id -u)/$1" >/dev/null 2>&1; }
hl_role() {
    if [[ "$(uname -s)" == Darwin && -d "/Applications/LM Studio.app" ]]; then echo hub; else echo node; fi
}

home_llm() {
    local role ts_bin ts_json ts_state
    role="$(hl_role)"
    log_info "Home LLM (${role})..."
    export PATH="${HOME}/.lmstudio/bin:${PATH}"

    # Tailscale: the only thing that puts LM Studio (and, on a node, the
    # metrics port) on the tailnet. Installed by nix-darwin as the
    # `tailscale-app` cask (domains/dev/packages/homebrew.nix); the CLI is the
    # app binary. Open the app first: on a fresh install the CLI otherwise
    # launches it and waits for a backend that never comes until someone
    # logs in (measured 2026-09-23).
    ts_bin="$(command -v tailscale || true)"
    [[ -z "$ts_bin" && -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]] && ts_bin=/Applications/Tailscale.app/Contents/MacOS/Tailscale
    ts_state=""
    if [[ -n "$ts_bin" ]]; then
        [[ "$(uname -s)" == Darwin ]] && { open -a Tailscale 2>/dev/null || true; sleep 2; }
        ts_json="$(timeout 10 "$ts_bin" status --json 2>/dev/null || true)"
        ts_state="$(printf '%s' "$ts_json" | sed -n 's/.*"BackendState": *"\([A-Za-z]*\)".*/\1/p' | head -1)"
        if [[ "$ts_state" == Running ]]; then
            log_success "Tailscale: logged in ($(printf '%s' "$ts_json" | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -1))"
        else
            hl_todo "Tailscale: log in (menu-bar app → Log in; Linux: sudo tailscale up), then run make update again for the serve steps"
        fi
    else
        hl_todo "Tailscale: not installed — on macOS make update installs the tailscale-app cask; on Linux https://tailscale.com/download/linux"
    fi

    [[ "$(uname -s)" == Darwin ]] || {
        hl_todo "Linux: no resident unit for LiteLLM yet — run once by hand: LM_STUDIO_REMOTE_HOST=<hub.tailnet.ts.net> bash ${HOME}/.config/litellm/litellm-up.sh (a systemd unit is a separate ruling)"
        return 0
    }

    # The launchd jobs and the config directories the jobs point at. On the
    # first install this runs before the symlink phase, so link what this
    # section needs itself (same functions manager.sh uses; idempotent).
    source "${DOTFILES_ROOT}/core/config/manager.sh"
    link_file "${DOTFILES_ROOT}/domains/dev/config/litellm" "${HOME}/.config/litellm"
    link_file "${DOTFILES_ROOT}/domains/dev/config/lmstudio" "${HOME}/.config/lmstudio"
    link_launch_agents "${DOTFILES_ROOT}/domains/dev"

    # LiteLLM: loopback-only measuring proxy, one per machine. Secrets come
    # from 1Password through the login Keychain (litellm-up.sh); a loaded job
    # is restarted in place (`kickstart -k`) — bootout returns before the job
    # is gone and a bootstrap right after fails with "Input/output error".
    if security find-generic-password -s litellm-op-token -w >/dev/null 2>&1; then
        local plist="${HOME}/Library/LaunchAgents/com.esh2n.litellm-proxy.plist"
        if [[ "$role" == node ]]; then
            if [[ -n "${LM_STUDIO_REMOTE_HOST:-}" ]]; then
                launchctl setenv LM_STUDIO_REMOTE_HOST "$LM_STUDIO_REMOTE_HOST"
            else
                hl_todo "LiteLLM (node): set the hub's name once — LM_STUDIO_REMOTE_HOST=<hub.tailnet.ts.net or 100.x.y.z> make update (litellm-up.sh reads it; litellm/README.md)"
            fi
        fi
        if hl_agent_loaded com.esh2n.litellm-proxy; then
            launchctl kickstart -k "gui/$(id -u)/com.esh2n.litellm-proxy" || hl_todo "LiteLLM: launchctl kickstart -k failed"
        else
            launchctl bootstrap "gui/$(id -u)" "$plist" || hl_todo "LiteLLM: launchctl bootstrap failed (${plist})"
        fi
        local _i
        for _i in $(seq 1 60); do hl_port http://127.0.0.1:4001/metrics && break; sleep 2; done
        hl_port http://127.0.0.1:4000/health/liveliness && log_success "LiteLLM: :4000 answers" || hl_todo "LiteLLM: :4000 not answering within 2 min — tail ~/Library/Logs/litellm-proxy.log"
        hl_port http://127.0.0.1:4001/metrics && log_success "LiteLLM: :4001 metrics answers" || hl_todo "LiteLLM: :4001 metrics not answering within 2 min — tail ~/Library/Logs/litellm-proxy.log"
    else
        hl_todo "LiteLLM: put the 1Password service-account token in the login Keychain once — security add-generic-password -a \"\$USER\" -s litellm-op-token -w '<token>' (litellm/README.md, 'Interactive vs headless op'), then make update"
    fi

    if [[ "$role" == hub ]]; then
        # LM Studio: the app is the `lm-studio` cask; the server inside it
        # listens on 127.0.0.1:1234 and its own login setting restarts it.
        # The awake job holds a sleep assertion only while that server lives.
        if hl_port http://127.0.0.1:1234/v1/models; then
            log_success "LM Studio: server answers on :1234"
        elif has_command lms; then
            timeout 30 lms server start --port 1234 >/dev/null 2>&1 || true
            sleep 3
            hl_port http://127.0.0.1:1234/v1/models && log_success "LM Studio: server started" || hl_todo "LM Studio: open the app once, Settings → 'run the LLM server on login', network 'localhost only'"
        else
            open -a "LM Studio" 2>/dev/null || true
            hl_todo "LM Studio: open the app once (it bootstraps ~/.lmstudio/bin/lms), tick Settings → 'run the LLM server on login', keep 'localhost only'; then make update"
        fi
        if ! hl_agent_loaded com.esh2n.lmstudio-awake; then
            launchctl bootstrap "gui/$(id -u)" "${HOME}/Library/LaunchAgents/com.esh2n.lmstudio-awake.plist" || hl_todo "LM Studio: launchctl bootstrap of com.esh2n.lmstudio-awake failed"
        fi
    fi

    # tailscale serve — the ruling's only exposure. --bg persists across
    # reboots; re-running replaces the same entry.
    if [[ "$ts_state" == Running ]]; then
        if [[ "$role" == hub ]]; then
            timeout 20 "$ts_bin" serve --bg --tcp 1234 tcp://127.0.0.1:1234 >/dev/null || hl_todo "tailscale serve --tcp 1234 failed"
            timeout 20 "$ts_bin" serve --bg --https=3001 127.0.0.1:3001 >/dev/null || hl_todo "tailscale serve --https=3001 failed: enable HTTPS certificates once for the tailnet at https://login.tailscale.com/admin/dns ('HTTPS Certificates' → Enable HTTPS; https://tailscale.com/kb/1153/enabling-https), then make update"
        else
            timeout 20 "$ts_bin" serve --bg --tcp 4001 tcp://127.0.0.1:4001 >/dev/null || hl_todo "tailscale serve --tcp 4001 failed"
        fi
    fi

    # Prometheus (aggregates every machine's LiteLLM) and Open WebUI (the
    # phone's chat page), both resident, both on the hub only.
    if [[ "$role" == hub ]]; then
        local obs="${DOTFILES_ROOT}/domains/dev/config/litellm/observability"
        if docker info >/dev/null 2>&1; then
            bash "${obs}/start.sh" >/dev/null && log_success "Prometheus: up (127.0.0.1:9090)" || hl_todo "observability/start.sh failed"
            # Open WebUI fronts the LiteLLM tiers; compose reads the proxy key from the environment.
            local proxy_key
            proxy_key="$("${DOTFILES_ROOT}/domains/dev/config/litellm/proxy-key.sh" 2>/dev/null || true)"
            if [[ -z "$proxy_key" ]]; then
                hl_todo "Open WebUI: proxy key unresolved (litellm/proxy-key.sh), not started"
            else
                LITELLM_API_KEY="$proxy_key" docker compose -f "${obs}/docker-compose.yml" --profile webui up -d open-webui >/dev/null 2>&1 \
                    && log_success "Open WebUI: up (127.0.0.1:3001, tiers via LiteLLM)" || hl_todo "Open WebUI: docker compose --profile webui up -d open-webui failed"
            fi
        else
            hl_todo "docker is not answering (start OrbStack), then make update for Prometheus / Open WebUI"
        fi
    fi

    # Owner-only, no API: the tailnet policy lives in the admin console.
    # `make tailscale-acl` renders acl.hujson with this tailnet's login + IP
    # into the clipboard and opens the page (domains/dev/config/tailscale/).
    hl_todo "tailnet policy (once per tailnet, and after editing acl.hujson): make tailscale-acl, then paste + Save"
    # The phone is a tailnet device like any other: nothing on the Mac can
    # enrol it. (Missing from this list until 2026-09-23 — the owner found
    # the page unreachable because the phone had never joined.)
    if [[ "$role" == hub ]]; then
        hl_todo "phone: install the Tailscale app, log in with the same account, switch it on — it must appear in 'tailscale status' — then open https://$(printf '%s' "${ts_json:-}" | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -1):3001 and create the first (admin) account"
    fi

    # Does it actually answer? One real completion per tier and the plumbing
    # around it (litellm/check.sh) — the only proof that is not a log line.
    echo ""
    bash "${DOTFILES_ROOT}/domains/dev/config/litellm/check.sh" || hl_todo "home-llm check reported $? failing line(s) above — fix those, then make update"
}

home_llm

if [[ ${#HOME_LLM_TODO[@]} -gt 0 ]]; then
    echo ""
    log_info "Home LLM — steps left for the owner (${#HOME_LLM_TODO[@]}):"
    for line in "${HOME_LLM_TODO[@]}"; do echo "  - ${line}"; done
fi

log_success "Dev Domain installed."
