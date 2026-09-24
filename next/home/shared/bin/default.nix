# Personal commands in ~/bin that work on every platform.
{ config, lib, ... }:
let
  link = config.lib.dotfiles.link;
  commands = {
    artifact = "domains/dev/bin/artifact";
    code-graph-cache-gc = "domains/dev/bin/code-graph-cache-gc";
    gh-pr-graph-update = "domains/dev/bin/gh-pr-graph-update";
    git-credential-gh-owner = "domains/dev/bin/git-credential-gh-owner";
    jig = "domains/dev/bin/jig";
    nvim-switch = "domains/dev/bin/nvim-switch";
    setup-neovim-distros = "domains/dev/bin/setup-neovim-distros";
    gh-switch = "domains/workspace/bin/gh-switch";
  };
in
{
  home.file = lib.mapAttrs' (name: path: lib.nameValuePair "bin/${name}" { source = link path; }) commands;
}
