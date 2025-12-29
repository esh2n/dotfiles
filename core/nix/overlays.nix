final: prev: {
  gotools = prev.gotools.overrideAttrs (old: {
    postInstall = (old.postInstall or "") + ''
      rm -f $out/bin/bundle
    '';
  });

  # Go
  spanner-cli = prev.buildGoModule rec {
    pname = "spanner-cli";
    version = "0d0904f";
    src = prev.fetchFromGitHub {
      owner = "cloudspannerecosystem";
      repo = "spanner-cli";
      rev = "0d0904f873b0712f3114ff62728281b7dc0e9092";
      hash = "sha256-pccPbxKbqQnQDsIhFXUBhX0NPyjWsUCez4gvbdmoB3U=";
    };
    vendorHash = "sha256-BHULxJgFQZd3RmRJNTBGIXhJb6b/aGQSAdIDUiAb5Bo=";
    doCheck = false;
  };

  spanner-dump = prev.buildGoModule rec {
    pname = "spanner-dump";
    version = "6983541";
    src = prev.fetchFromGitHub {
      owner = "cloudspannerecosystem";
      repo = "spanner-dump";
      rev = "6983541f4cffd4f032e4577efdf27222f3a5df99";
      hash = "sha256-dEayfG9XLP3zFzGlNtVga5qtJp6sY1JbFfi5BpG9P/4=";
    };
    vendorHash = "sha256-poMojfYnSn6X4qEa311r24ZUxR+ED8xNKDIwpGV7tDE=";
    doCheck = false;
  };

  go-mockgen = prev.buildGoModule rec {
    pname = "mockgen";
    version = "1.6.0";
    src = prev.fetchFromGitHub {
      owner = "golang";
      repo = "mock";
      rev = "v${version}";
      hash = "sha256-5Kp7oTmd8kqUN+rzm9cLqp9nb3jZdQyltGGQDiRSWcE=";
    };
    vendorHash = "sha256-5gkrn+OxbNN8J1lbgbxM8jACtKA7t07sbfJ7gVJWpJM=";
    subPackages = [ "mockgen" ];
    doCheck = false;
  };

  go-protoc-gen-go = prev.buildGoModule rec {
    pname = "protoc-gen-go";
    version = "1.35.2";
    src = prev.fetchFromGitHub {
      owner = "protocolbuffers";
      repo = "protobuf-go";
      rev = "v${version}";
      hash = "sha256-mgAMO7B9lYAtgcW5RjDzyjRzQL+v8jqvgo0eTswamHE=";
    };
    vendorHash = "sha256-nGI/Bd6eMEoY0sBwWEtyhFowHVvwLKjbT4yfzFz6Z3E=";
    subPackages = [ "cmd/protoc-gen-go" ];
    doCheck = false;
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

  # Node.js packages via node2nix
  node2nix-generated = import ../../domains/dev/packages/node2nix {
    pkgs = prev;
    nodejs = prev.nodejs_20;
  };

  # Claude Code CLI - properly wrapped
  claude-code = prev.stdenv.mkDerivation rec {
    pname = "claude-code";
    version = "2.0.76";

    nativeBuildInputs = [ prev.makeWrapper ];
    buildInputs = [ prev.nodejs_20 ];

    dontUnpack = true;

    installPhase = ''
      mkdir -p $out/bin

      # Create wrapper script that sets up NODE_PATH and runs claude
      # Named claude-cli to avoid conflict with Homebrew Cask claude GUI app
      makeWrapper ${prev.nodejs_20}/bin/node $out/bin/claude-cli \
        --add-flags "${final.node2nix-generated.nodeDependencies}/lib/node_modules/@anthropic-ai/claude-code/cli.js" \
        --set NODE_PATH "${final.node2nix-generated.nodeDependencies}/lib/node_modules"
    '';
  };

  # aicommits CLI - properly wrapped
  aicommits = prev.stdenv.mkDerivation rec {
    pname = "aicommits";
    version = "1.11.0";

    nativeBuildInputs = [ prev.makeWrapper ];
    buildInputs = [ prev.nodejs_20 ];

    dontUnpack = true;

    installPhase = ''
      mkdir -p $out/bin

      # Create wrapper script that sets up NODE_PATH and runs aicommits
      makeWrapper ${prev.nodejs_20}/bin/node $out/bin/aicommits \
        --add-flags "${final.node2nix-generated.nodeDependencies}/lib/node_modules/aicommits/dist/cli.mjs" \
        --set NODE_PATH "${final.node2nix-generated.nodeDependencies}/lib/node_modules"
    '';
  };
}
