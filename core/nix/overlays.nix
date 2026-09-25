final: prev: {
  gotools = prev.gotools.overrideAttrs (old: {
    postInstall = (old.postInstall or "") + ''
      rm -f $out/bin/bundle
      rm -f $out/bin/modernize
    '';
  });

  # gh from cli/cli trunk: carries `--attach` (issue/PR attachments from the
  # CLI, merged 2026-08-25, cli/cli#14186) which no release has yet — 2.98.0
  # (2026-08-20) predates it. Drop this override once a release ships it and
  # the flake's nixpkgs carries that release.
  gh = prev.gh.overrideAttrs (old: rec {
    version = "2.98.0-trunk-40b742f";
    src = prev.fetchFromGitHub {
      owner = "cli";
      repo = "cli";
      rev = "40b742f76d68e6b1f472942a6368db4b5d765641";
      hash = "sha256-nGquMOwkEZp6ysFJOw5qa1PqQqw7+WLqpPQiziEAPG0=";
    };
    vendorHash = "sha256-v9h17XD/fyHasgLsHHkGvoV1qITWpwGDJ6MtlvWnN4c=";
  });

  # Persistent code graph for Claude Code / Codex. Keep the release pinned:
  # upstream moves quickly and the graph is advisory, not a source of truth.
  codebase-memory-mcp = prev.stdenvNoCC.mkDerivation rec {
    pname = "codebase-memory-mcp";
    version = "0.11.0";

    src = prev.fetchurl {
      url = "https://github.com/DeusData/codebase-memory-mcp/releases/download/v${version}/codebase-memory-mcp-darwin-${
        if prev.stdenv.hostPlatform.isAarch64 then "arm64" else "amd64"
      }.tar.gz";
      hash = if prev.stdenv.hostPlatform.isAarch64
        then "sha256-Te5/OLY3QOZ1HXp+1+sQKRwfKj6iQV9ZncaDcMoKLRg="
        else "sha256-2/HHO/y95k593kzRMg2nr8AuLJcu4Xia4DlSFBH1Ey4=";
    };

    sourceRoot = ".";
    installPhase = ''
      runHook preInstall
      install -Dm755 codebase-memory-mcp "$out/bin/codebase-memory-mcp"
      install -Dm644 LICENSE "$out/share/licenses/${pname}/LICENSE"
      runHook postInstall
    '';

    meta = with prev.lib; {
      description = "Persistent code knowledge graph MCP server";
      homepage = "https://github.com/DeusData/codebase-memory-mcp";
      license = licenses.mit;
      platforms = platforms.darwin;
      mainProgram = "codebase-memory-mcp";
    };
  };

  # Rust
  cargo-compete = prev.rustPlatform.buildRustPackage rec {
    pname = "cargo-compete";
    version = "0.10.6";
    src = prev.fetchFromGitHub {
      owner = "qryxip";
      repo = "cargo-compete";
      rev = "v${version}";
      hash = "sha256-trtnxWDXzCeZ7ICLbPgCrBFZZzOmpkGOjjrpus6t+is=";
    };
    cargoHash = "sha256-Vys9t3ES8ZhxjNt3LDe6NW9WbkYbNWTdp6kxl3daQj4=";
    nativeBuildInputs = [ prev.pkg-config ];
    buildInputs = [ prev.openssl prev.zlib ]
      ++ prev.lib.optionals prev.stdenv.hostPlatform.isDarwin [ prev.libiconv ];
    doCheck = false;
  };

  # claude-code: managed by native installer (auto-updates), not nix.
  # aicommits: managed by mise, not nix.
}
