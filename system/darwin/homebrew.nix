# Homebrew on macOS: formulae without a nixpkgs equivalent, GUI apps (casks)
# that need a system extension, a self-updater or a signed installer, and
# App Store apps. CLI tools that nixpkgs has live in home/*/packages instead.
#
# By kind, as the Nix packages are; the roles turn the kinds on
# (roles/system.nix): dev is the development formulae and CLI casks, desktop
# the GUI apps, fonts and App Store apps (GUI development apps need both),
# models the local model runners; the taps and Tailscale are on every Mac.
# cleanup stays "none", so turning a kind off never uninstalls.
{ config, lib, ... }:
let
  on = kind: config.dotfiles.homebrew.${kind}.enable;
in
{
  options.dotfiles.homebrew = lib.genAttrs [ "dev" "desktop" "models" ] (kind: {
    enable = lib.mkEnableOption "the ${kind} Homebrew formulae and casks";
  });

  config.homebrew = {
    enable = true;
    onActivation = {
      autoUpdate = true;
      # "zap" removed 25 undeclared casks + 11 MAS apps + fish (2026-08-05).
      # Keep "none" until the declarations catch up with reality, then decide
      # whether to go back to strict cleanup.
      cleanup = "none";
    };

    taps = [
      "felixkratz/formulae"
      "satococoa/tap"
      "nikitabobko/tap"
      "BarutSRB/tap"
    ];

    brews =
      lib.optionals (on "dev") [
        "thefuck"
        "staticcheck"
        "golangci-lint"
        "govulncheck"
        "protoc-gen-go-grpc"
        "satococoa/tap/wtp"
        "rtk"
        "k1LoW/tap/mo"
        "dlvhdr/formulae/diffnav"
        "noborus/tap/ov"
        "sesh"
        "can1357/tap/omp" # oh-my-pi coding agent; tap trusted by dotctl up
        "herdr" # not in nixpkgs
        "hunk" # not in nixpkgs
      ]
      ++ lib.optionals (on "models") [
        "ollama"
      ]
      # window management and the bar
      ++ lib.optionals (on "desktop") [
        "sketchybar"
        "borders"
        "karinushka/paneru/paneru"
      ];

    casks =
      # every machine is on the tailnet
      [
        # Tailscale, Standalone variant (the .pkg from pkgs.tailscale.com). Cask
        # because it is a GUI app with a system extension; the formula `tailscale`
        # is the open-source tailscaled (root daemon, no GUI, "only recommended
        # for unattended installs managed by experienced macOS system
        # administrators" — https://tailscale.com/kb/1065/macos-variants) and the
        # App Store variant cannot `tailscale serve`. Tailscale's own advice:
        # "Always start by downloading and installing our Standalone variant".
        # Token renamed from `tailscale` to `tailscale-app` (old_tokens:
        # ["tailscale"]; https://formulae.brew.sh/api/cask/tailscale-app.json);
        # the pkg puts the CLI at /usr/local/bin/tailscale (bundle path:
        # /Applications/Tailscale.app/Contents/MacOS/Tailscale,
        # https://tailscale.com/kb/1080/cli). Once per machine, by hand: log in
        # from the menu-bar app; on the Mac that hosts LM Studio also run
        # `tailscale serve --bg --tcp 1234 127.0.0.1:1234` (persists across
        # reboots; rules/decisions/2026-09-23-home-llm-…). The app registers its
        # own login item, so no launchd job is needed.
        "tailscale-app"
      ]
      ++ lib.optionals (on "dev") [
        # codex ships as a cask only — there is no `codex` formula, so listing it
        # under brews made `brew bundle` fail and left the install unmanaged.
        # Minimum 0.147.0 (the hooks.json `[hooks.state]` trust-hash format
        # `jig codex register` writes assumes it), recommended 0.150.0+ (adds the
        # Interrupt hook event). Below these floors the fix is
        # `brew upgrade --cask codex`, then `make up`.
        "codex"
        # microVM sandbox for coding agents. docker/tap is casks-only too (same
        # trap as codex); the tap is trusted by dotctl up.
        "docker/tap/sbx"
      ]
      # GUI development apps
      ++ lib.optionals (on "dev" && on "desktop") [
        "android-studio"
        "warp"
        "cursor"
        # Orca ADE (worktree IDE for coding agents, onorca.dev). MUST stay
        # tap-qualified: the untapped homebrew/cask "orca" is Plotly's chart
        # renderer, a different app. Tap trusted by dotctl up.
        # The app self-updates on the stable channel regardless of brew pinning.
        "stablyai/orca/orca"
      ]
      ++ lib.optionals (on "models") [
        # LM Studio (https://formulae.brew.sh/cask/lm-studio — installs
        # "LM Studio.app" only; the `lms` CLI is bootstrapped by the app into
        # ~/.lmstudio/bin/lms on first launch). Cask because it is the desktop
        # app; the headless server runs inside it. Once per machine, by hand:
        # open the app, Settings (Cmd+,) → check "run the LLM server on login",
        # then `lms server start --port 1234` once so the saved state is
        # "running" (https://lmstudio.ai/docs/app/api/headless). The sleep guard
        # is home/darwin/lmstudio/config/ (launchd + caffeinate).
        "lm-studio"
      ]
      ++ lib.optionals (on "desktop") [
        "discord"
        # Grok Bot (x.ai/bot, signed+built by Anysphere) — AI teammates desktop
        # app. Cask lives in homebrew-cask core; the app self-updates. First
        # install on a machine that already has the DMG-installed app needs
        # `brew install --cask grok-bot --adopt` once. No dotfile-manageable
        # config: ~/.grokbot mixes app state with daemon credentials.
        "grok-bot"

        # Workspace
        "azookey"
        "karabiner-elements"
        "aerospace"
        "omniwm"
        "loop"
        "displaylink"
        "desktoppr"
        "sf-symbols"
        "font-jetbrains-mono-nerd-font"
        "font-hack-nerd-font"
        "font-sf-mono"
        "font-sf-pro"
        "font-sketchybar-app-font"
        # named by the WezTerm (HackGen35 Console NF) and VS Code (Fira Code) configs
        "font-hackgen-nerd"
        "font-fira-code"

        # Creative
        "spotify"
        # Screenshot + screen recording + annotation in one OSS app; meant to
        # replace both cleanshot and screen-studio (see home/darwin/packages.nix). Requires
        # macOS 26.4+, so the cask fails to install until the OS is upgraded.
        # The tap is trusted by dotctl up.
        "fayazara/tap/screendrop"

        # Browsers and passwords
        "google-chrome"
        "thebrowsercompany-dia" # Dia Browser (AI browser from The Browser Company)
        "firefox"
        "1password"
      ];

    masApps = lib.optionalAttrs (on "desktop") {
      "Dropover" = 1355679052;
    };
  };
}
