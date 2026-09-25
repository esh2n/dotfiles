# Packages this repository builds. Each lives in its own directory as a
# callPackage-style function; the overlay (next/overlays) puts them into pkgs
# and the flake exposes them as packages.<system>. One package that needs
# another from this set gets it from `self`, since plain nixpkgs (the flake's
# packages output) does not have it.
{ callPackage }:
let
  self = {
    cargo-compete = callPackage ./cargo-compete { };
    codebase-memory-mcp = callPackage ./codebase-memory-mcp { };
    dotctl = callPackage ./dotctl { };
    dev-setup = callPackage ./scripts/dev-setup { inherit (self) dotctl; };
    go-mockgen = callPackage ./go-mockgen { };
    go-protoc-gen-go = callPackage ./go-protoc-gen-go { };
    harness-apply = callPackage ./scripts/harness-apply { };
    home-llm-setup = callPackage ./scripts/home-llm-setup { };
    render-templates = callPackage ./scripts/render-templates { };
    spanner-cli = callPackage ./spanner-cli { };
    spanner-dump = callPackage ./spanner-dump { };
  };
in
self
