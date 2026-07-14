{ ... }: {
  homebrew.brews = [
    "thefuck"
    "staticcheck"
    "protoc-gen-go-grpc"
    "ollama"
    "satococoa/tap/wtp"
    "rtk"
    "karinushka/paneru/paneru"
    "k1LoW/tap/mo"
    "dlvhdr/formulae/diffnav"
    "noborus/tap/ov"
    "sesh"
    "codex"
    "herdr" # not in nixpkgs
    "hunk" # not in nixpkgs
  ];

  homebrew.casks = [
    "android-studio"
    "warp"
  ];
}
