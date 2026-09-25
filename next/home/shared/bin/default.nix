# Personal commands in ~/bin that work on every platform: the thin entry
# points that hand off to another program. Everything with output of its own
# is dotctl now, installed under the old names by its package
# (rules/decisions/2026-09-25-dotctl-owns-every-command-with-output.md).
{ config, lib, ... }:
let
  link = config.lib.dotfiles.link;
  commands = {
    artifact = "domains/dev/bin/artifact";
    jig = "domains/dev/bin/jig";
  };
in
{
  home.file = lib.mapAttrs' (
    name: path: lib.nameValuePair "bin/${name}" { source = link path; }
  ) commands;
}
