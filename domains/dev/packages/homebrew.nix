{ ... }: {
  homebrew.brews = [
    "thefuck"
    "staticcheck"
    "protoc-gen-go-grpc"
    "ollama"
  ];

  homebrew.casks = [
    "warp"
  ];
}
