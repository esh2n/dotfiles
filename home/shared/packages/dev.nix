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
      go-tools # staticcheck, which the rules ask for before completion
      declscope # file-scoped unexported names, run by the go-reviewer (pkgs)
      golangci-lint
      govulncheck
      protobuf
      bundler
      pnpm
      yarn

      # uvx starts serena, an MCP server every harness is given
      uv

      # Coding-agent harnesses jig delivers to (Claude Code comes from its own
      # installer, dotctl setup claude-cli; DSH runs through npx). codex must
      # be >= 0.147.0: jig codex register writes the [hooks.state] trust hash
      # format it introduced.
      codex
      omp
      pi-coding-agent

      # Terminal and git
      wtp # git worktrees (zsh functions)
      diffnav # git's diff pager
      ov # git's log pager
      glow # Markdown in the terminal
      pay-respects # command correction (was thefuck)

      # Code graph MCP server, given to every harness (pkgs)
      codebase-memory-mcp

      # Built by this repo (overlays)
      cargo-compete
      crit

      # Cloudflare
      wrangler # Cloudflare Workers CLI (artifact deploy/login)

    ]
  );
}
