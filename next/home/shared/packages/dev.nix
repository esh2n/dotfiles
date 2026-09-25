# Tools for writing code (the dev role).
{
  config,
  lib,
  pkgs,
  ...
}:
{
  home.packages = lib.mkIf config.dotfiles.packages.dev.enable (
    with pkgs;
    [
      # DevOps
      docker
      kubectl
      kubernetes-helm
      k9s
      terraform
      awscli2

      # Databases
      mysql84
      redis

      # Language tooling
      cargo-generate
      gotools
      gopls
      delve
      protobuf
      bundler
      pnpm
      yarn

      # uvx starts serena, an MCP server every harness is given
      uv

      # Code graph MCP server, given to every harness (next/pkgs)
      codebase-memory-mcp

      # Built by this repo (overlays)
      cargo-compete
      crit

      # Cloudflare
      wrangler # Cloudflare Workers CLI (artifact deploy/login)

    ]
  );
}
