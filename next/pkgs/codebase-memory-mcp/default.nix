# Persistent code graph for Claude Code / Codex. Keep the release pinned:
# upstream moves quickly and the graph is advisory, not a source of truth.
# macOS gets upstream's darwin build; Linux its static ("portable") build, so
# it runs on a distribution's own libc with nothing to patch.
{
  lib,
  stdenv,
  stdenvNoCC,
  fetchurl,
}:
stdenvNoCC.mkDerivation rec {
  pname = "codebase-memory-mcp";
  version = "0.11.0";

  src =
    if stdenv.hostPlatform.isDarwin then
      fetchurl {
        url = "https://github.com/DeusData/codebase-memory-mcp/releases/download/v${version}/codebase-memory-mcp-darwin-${
          if stdenv.hostPlatform.isAarch64 then "arm64" else "amd64"
        }.tar.gz";
        hash =
          if stdenv.hostPlatform.isAarch64 then
            "sha256-Te5/OLY3QOZ1HXp+1+sQKRwfKj6iQV9ZncaDcMoKLRg="
          else
            "sha256-2/HHO/y95k593kzRMg2nr8AuLJcu4Xia4DlSFBH1Ey4=";
      }
    else
      fetchurl {
        url = "https://github.com/DeusData/codebase-memory-mcp/releases/download/v${version}/codebase-memory-mcp-linux-amd64-portable.tar.gz";
        hash = "sha256-H56Ck+srxcBc+ien6PwDPabXKf+tUlzPzao/1gYwZoM=";
      };

  sourceRoot = ".";
  installPhase = ''
    runHook preInstall
    install -Dm755 codebase-memory-mcp "$out/bin/codebase-memory-mcp"
    install -Dm644 LICENSE "$out/share/licenses/${pname}/LICENSE"
    runHook postInstall
  '';

  meta = with lib; {
    description = "Persistent code knowledge graph MCP server";
    homepage = "https://github.com/DeusData/codebase-memory-mcp";
    license = licenses.mit;
    platforms = platforms.darwin ++ [ "x86_64-linux" ];
    mainProgram = "codebase-memory-mcp";
  };
}
