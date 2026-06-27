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
  ];

  homebrew.casks = [
    "android-studio"
    "warp"
  ];
}
