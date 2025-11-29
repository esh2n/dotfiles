# Custom packages not in nixpkgs
final: prev: {
  # ===========================================
  # Rust packages (cargo.txt)
  # ===========================================

  cargo-compete = prev.rustPlatform.buildRustPackage rec {
    pname = "cargo-compete";
    version = "0.10.6";
    src = prev.fetchFromGitHub {
      owner = "qryxip";
      repo = "cargo-compete";
      rev = "v${version}";
      hash = "sha256-PLACEHOLDER"; # Run: nix-prefetch-github qryxip cargo-compete --rev v0.10.6
    };
    cargoHash = "sha256-PLACEHOLDER"; # Will be shown in build error
    doCheck = false;
  };

  pacifica = prev.rustPlatform.buildRustPackage rec {
    pname = "pacifica";
    version = "main";
    src = prev.fetchFromGitHub {
      owner = "serinuntius";
      repo = "pacifica";
      rev = "main";
      hash = "sha256-PLACEHOLDER"; # Run: nix-prefetch-github serinuntius pacifica
    };
    cargoHash = "sha256-PLACEHOLDER"; # Will be shown in build error
    doCheck = false;
  };

  # ===========================================
  # Go packages (go.txt)
  # ===========================================

  spanner-cli = prev.buildGoModule rec {
    pname = "spanner-cli";
    version = "main";
    src = prev.fetchFromGitHub {
      owner = "cloudspannerecosystem";
      repo = "spanner-cli";
      rev = "main";
      hash = "sha256-PLACEHOLDER"; # Run: nix-prefetch-github cloudspannerecosystem spanner-cli
    };
    vendorHash = "sha256-PLACEHOLDER"; # Will be shown in build error
    doCheck = false;
  };

  spanner-dump = prev.buildGoModule rec {
    pname = "spanner-dump";
    version = "main";
    src = prev.fetchFromGitHub {
      owner = "cloudspannerecosystem";
      repo = "spanner-dump";
      rev = "main";
      hash = "sha256-PLACEHOLDER"; # Run: nix-prefetch-github cloudspannerecosystem spanner-dump
    };
    vendorHash = "sha256-PLACEHOLDER"; # Will be shown in build error
    doCheck = false;
  };
}

