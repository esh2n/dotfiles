{ ... }: {
  homebrew.brews = [
    # login shell (registered as /opt/homebrew/bin/fish in dscl) — keep
    # declared or onActivation.cleanup = "zap" will uninstall it
    "fish"
    "thefuck"
    "staticcheck"
    "golangci-lint"
    "govulncheck"
    "protoc-gen-go-grpc"
    "ollama"
    "satococoa/tap/wtp"
    "rtk"
    "k1LoW/tap/mo"
    "dlvhdr/formulae/diffnav"
    "noborus/tap/ov"
    "sesh"
    "can1357/tap/omp" # oh-my-pi coding agent; tap trusted by core/utils/homebrew.sh
    "herdr" # not in nixpkgs
    "hunk" # not in nixpkgs
  ];

  homebrew.casks = [
    "android-studio"
    "warp"
    "cursor"
    "discord"
    # codex ships as a cask only — there is no `codex` formula, so listing it
    # under brews made `brew bundle` fail and left the install unmanaged.
    # Minimum 0.147.0 (yoki's trust-hash format assumes it), recommended
    # 0.150.0+ (adds the Interrupt hook event; see
    # claude-profiles/runtime/yoki/scripts/lib/doctor.js and
    # lib/targets/codex.js's EVENT_MIN_CODEX_VERSION, and
    # claude-profiles/README.md's doctor section). `yoki-switch doctor`
    # warns/fails below these floors with the exact fix: `brew upgrade --cask codex`.
    "codex"
    # microVM sandbox for coding agents. docker/tap is casks-only too (same
    # trap as codex); the tap is trusted by core/utils/homebrew.sh.
    "docker/tap/sbx"
    # Orca ADE (worktree IDE for coding agents, onorca.dev). MUST stay
    # tap-qualified: the untapped homebrew/cask "orca" is Plotly's chart
    # renderer, a different app. Tap trusted by core/utils/homebrew.sh.
    # The app self-updates on the stable channel regardless of brew pinning.
    "stablyai/orca/orca"
  ];
}
