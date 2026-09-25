# Personal commands in ~/bin that work on every platform. code-graph-cache-gc
# and nvim-switch are dotctl now (installed under those names by its package).
{ config, lib, ... }:
let
  link = config.lib.dotfiles.link;
  commands = {
    artifact = "domains/dev/bin/artifact";
    codebase-memory-mcp-managed = "domains/dev/bin/codebase-memory-mcp-managed";
    gh-pr-graph-update = "domains/dev/bin/gh-pr-graph-update";
    git-credential-gh-owner = "domains/dev/bin/git-credential-gh-owner";
    jig = "domains/dev/bin/jig";
    setup-neovim-distros = "domains/dev/bin/setup-neovim-distros";
    gh-switch = "domains/workspace/bin/gh-switch";
  };
in
{
  home.file = lib.mapAttrs' (
    name: path: lib.nameValuePair "bin/${name}" { source = link path; }
  ) commands;
}
