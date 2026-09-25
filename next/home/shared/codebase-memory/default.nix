# Codebase-Memory: index and watch projects by itself (every harness is given
# it as an MCP server; rules/decisions/2026-09-22-mcp-list-by-industry-and-use-case.md).
{ config, ... }:
let
  setup = config.lib.dotfiles.setupStep;
in
{
  dotfiles.setup.codebase-memory.command = setup "codebase-memory";
}
