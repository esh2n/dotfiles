{
  lib,
  stdenv,
  rustPlatform,
  fetchFromGitHub,
  pkg-config,
  openssl,
  zlib,
  libiconv,
}:
rustPlatform.buildRustPackage rec {
  pname = "cargo-compete";
  version = "0.10.6";
  src = fetchFromGitHub {
    owner = "qryxip";
    repo = "cargo-compete";
    rev = "v${version}";
    hash = "sha256-trtnxWDXzCeZ7ICLbPgCrBFZZzOmpkGOjjrpus6t+is=";
  };
  cargoHash = "sha256-Vys9t3ES8ZhxjNt3LDe6NW9WbkYbNWTdp6kxl3daQj4=";
  nativeBuildInputs = [ pkg-config ];
  buildInputs = [
    openssl
    zlib
  ]
  ++ lib.optionals stdenv.hostPlatform.isDarwin [ libiconv ];
  doCheck = false;
}
