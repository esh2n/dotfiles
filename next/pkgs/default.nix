# Packages this repository builds. Each lives in its own directory as a
# callPackage-style function; the overlay (next/overlays) puts them into pkgs
# and the flake exposes them as packages.<system>.
{ callPackage }:
{
  cargo-compete = callPackage ./cargo-compete { };
  codebase-memory-mcp = callPackage ./codebase-memory-mcp { };
  dev-setup = callPackage ./scripts/dev-setup { };
  go-mockgen = callPackage ./go-mockgen { };
  go-protoc-gen-go = callPackage ./go-protoc-gen-go { };
  harness-apply = callPackage ./scripts/harness-apply { };
  render-templates = callPackage ./scripts/render-templates { };
  spanner-cli = callPackage ./spanner-cli { };
  spanner-dump = callPackage ./spanner-dump { };
}
