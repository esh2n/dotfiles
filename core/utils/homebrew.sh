#!/usr/bin/env bash

# Trust third-party taps before nix-darwin invokes `brew bundle`. Homebrew
# stores trust separately depending on XDG_CONFIG_HOME, while nix-darwin runs
# activation with a scrubbed environment, so both locations must be updated.
# Keep this list in sync with core/nix/darwin.nix taps and tap-qualified
# packages declared in domains/*/packages/homebrew.nix.
trust_brew_taps() {
    if ! command -v brew >/dev/null 2>&1 || ! brew trust --help >/dev/null 2>&1; then
        return 0
    fi

    log_info "Trusting third-party Homebrew taps..."
    local taps=(
        felixkratz/formulae
        satococoa/tap
        nikitabobko/tap
        barutsrb/tap
        karinushka/paneru
        k1low/tap
        dlvhdr/formulae
        noborus/tap
        docker/tap
        can1357/tap
        fayazara/tap
    )

    brew trust --tap "${taps[@]}" \
        || log_warn "brew trust reported failure (non-critical)"
    env -u XDG_CONFIG_HOME brew trust --tap "${taps[@]}" \
        || log_warn "brew trust (no-XDG) reported failure (non-critical)"
}
