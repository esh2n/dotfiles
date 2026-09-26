# Codebase-Memory: index and watch projects by itself (every harness is given
# it as an MCP server; rules/decisions/2026-09-22-mcp-list-by-industry-and-use-case.md).
# The harnesses start it through ~/bin/codebase-memory-mcp-managed, beside
# this file: one stable entry that runs a throttled cache GC first.
{ config, ... }:
{
  home.file."bin/codebase-memory-mcp-managed".source =
    config.lib.dotfiles.link "home/shared/codebase-memory/codebase-memory-mcp-managed";
  dotfiles.setup.codebase-memory.command = config.lib.dotfiles.setupStep "codebase-memory";
}
