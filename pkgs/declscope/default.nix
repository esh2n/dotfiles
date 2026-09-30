# declscope, the Go analyzer that keeps an unexported name to the file that
# declares it (rules/decisions/2026-09-30-declscope-file-scoped-private.md).
# Upstream's release binary, not a source build: the module wants Go 1.27 and
# moves fast, so the version stays pinned and moves by hand.
{
  lib,
  stdenv,
  stdenvNoCC,
  fetchurl,
}:
let
  platform =
    {
      aarch64-darwin = {
        name = "darwin_arm64";
        hash = "sha256-xHc0II8LNgnO43k0re9C/GzFYG15uGp5JS/aBCv5T4w=";
      };
      x86_64-darwin = {
        name = "darwin_amd64";
        hash = "sha256-2TaBepwtCGil+vScmcGvrLA1vipnfqJqW5qjSIVlZxE=";
      };
      x86_64-linux = {
        name = "linux_amd64";
        hash = "sha256-xGKadc4kAVmC9HpyG2jeKJaVvSfQhFBzmBYIDyOqSM0=";
      };
      aarch64-linux = {
        name = "linux_arm64";
        hash = "sha256-s487dAKTp627yTGUt+hRfFAfkIMrt8fIefqoTUMfA0U=";
      };
    }
    .${stdenv.hostPlatform.system}
      or (throw "declscope: no release binary for ${stdenv.hostPlatform.system}");
in
stdenvNoCC.mkDerivation rec {
  pname = "declscope";
  version = "0.15.1";

  src = fetchurl {
    url = "https://github.com/mpyw/declscope/releases/download/v${version}/declscope_${version}_${platform.name}.tar.gz";
    inherit (platform) hash;
  };

  sourceRoot = ".";
  installPhase = ''
    runHook preInstall
    install -Dm755 declscope "$out/bin/declscope"
    install -Dm644 LICENSE "$out/share/licenses/${pname}/LICENSE"
    runHook postInstall
  '';

  meta = {
    description = "Go analyzer for file-scoped unexported declarations";
    homepage = "https://github.com/mpyw/declscope";
    license = lib.licenses.mit;
    mainProgram = "declscope";
    platforms = [
      "aarch64-darwin"
      "x86_64-darwin"
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
}
