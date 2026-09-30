# The coding-agent harness (Claude Code, Codex, pi, omp, DSH, and jig's guard
# policy). Files are links into the checkout; pi and omp get theirs one by
# one because their directories also hold runtime state and the user's own
# extensions. What is a command rather than a file — jig apply, the DSH
# plugin — runs as `jig setup` after the links are written.
{
  config,
  lib,
  pkgs,
  facts,
  ...
}:
let
  link = config.lib.dotfiles.link;
  # each harness's own files, beside this module
  config' = "home/shared/harness";
  piFiles =
    dir: suffix:
    lib.filterAttrs (name: type: type != "directory" && lib.hasSuffix suffix name) (
      builtins.readDir (./pi + "/${dir}")
    );
in
{
  home.file = {
    ".claude".source = link "${config'}/claude";
    ".pi/agent/settings.json".source = link "${config'}/pi/settings.json";
    ".pi/agent/models.json".source = link "${config'}/pi/models.json";
    ".omp/agent/models.yml".source = link "${config'}/omp/models.yml";
    ".omp/agent/lsp.yml".source = link "${config'}/omp/lsp.yml";
    ".dsh/settings.yaml".source = link "${config'}/dsh/settings.yaml";
  }
  // lib.mapAttrs' (
    name: _:
    lib.nameValuePair ".pi/agent/extensions/${name}" {
      source = link "${config'}/pi/extensions/${name}";
    }
  ) (piFiles "extensions" ".ts")
  // lib.mapAttrs' (
    name: _:
    lib.nameValuePair ".pi/agent/themes/${name}" { source = link "${config'}/pi/themes/${name}"; }
  ) (piFiles "themes" ".json");

  xdg.configFile = {
    codex.source = link "${config'}/codex";
    "jig/policy".source = link "harness/policy";
  };

  # bun (mise), codex and pnpm are the user's tools: jig setup sees the
  # user's PATH, not only activation's. jig runs on bun, so without it the
  # step is skipped with a warning; activation still finishes.
  home.activation.harnessApply = lib.hm.dag.entryAfter [ "linkGeneration" ] ''
    if PATH="$PATH:${config.lib.dotfiles.userPath}" command -v bun >/dev/null 2>&1; then
      (PATH="$PATH:${config.lib.dotfiles.userPath}" && run bash ${lib.escapeShellArg "${facts.repo}/harness/bin/jig"} setup) \
        || warnEcho "jig setup failed"
    else
      warnEcho "bun is not on PATH; skipping jig setup (run make up again once mise has installed bun)"
    fi
  '';

  # Commands the harnesses need that jig does not run: Claude Code's native
  # installer, pi's packages, and the git filter that keeps pi's runtime key
  # out of the tracked settings.json (.gitattributes). (Claude Code's MCP
  # servers are jig's: harnessApply writes them into ~/.claude.json.)
  dotfiles.setup = {
    claude-cli.command = config.lib.dotfiles.setupStep "claude-cli";
    records-ttl.command = config.lib.dotfiles.setupStep "records-ttl";
    git-filters.command = config.lib.dotfiles.setupStep "git-filters";
    pi-packages = {
      command = config.lib.dotfiles.setupStep "pi-packages";
      after = [ "harnessApply" ];
    };
  };
}
