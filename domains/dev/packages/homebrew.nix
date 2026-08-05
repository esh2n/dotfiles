{ ... }: {
  homebrew.brews = [
    "thefuck"
    "staticcheck"
    "protoc-gen-go-grpc"
    "ollama"
    "satococoa/tap/wtp"
    "rtk"
    "k1LoW/tap/mo"
    "dlvhdr/formulae/diffnav"
    "noborus/tap/ov"
    "sesh"
    "herdr" # not in nixpkgs
    "hunk" # not in nixpkgs
  ];

  homebrew.casks = [
    "android-studio"
    "warp"
    # codex ships as a cask only — there is no `codex` formula, so listing it
    # under brews made `brew bundle` fail and left the install unmanaged.
    "codex"
  ];
}
