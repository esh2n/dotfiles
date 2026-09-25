# dotctl, the dotfiles' own CLI (rules/decisions/2026-09-25-dotctl-in-go.md).
# Standard library only, so there is nothing to vendor. The source is the Go
# files alone: editing this file does not rebuild the binary.
{ lib, buildGoModule }:
buildGoModule {
  pname = "dotctl";
  version = "0.1.0";
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [
      ./go.mod
      (lib.fileset.fileFilter (f: f.hasExt "go") ./.)
    ];
  };
  vendorHash = null;
  subPackages = [ "cmd/dotctl" ];
  # the old command names still work: argv[0] picks the subcommand
  postInstall = ''
    ln -s dotctl $out/bin/code-graph-cache-gc
    ln -s dotctl $out/bin/nvim-switch
  '';
  meta = {
    description = "The dotfiles' own CLI";
    mainProgram = "dotctl";
  };
}
