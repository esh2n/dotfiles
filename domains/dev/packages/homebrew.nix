{ ... }: {
  homebrew.brews = [
    "thefuck"
    "staticcheck"
    "protoc-gen-go-grpc"
    "ollama"
    "satococoa/tap/wtp"
  ];

  homebrew.casks = [
    "android-studio"
    "warp"
  ];
}
