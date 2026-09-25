# The coding-agent harness (Claude Code, Codex, pi, omp, DSH, and jig's guard
# policy). Files are links into the checkout; pi and omp get theirs one by
# one because their directories also hold runtime state and the user's own
# extensions. What is a command rather than a file — jig apply, the DSH
# plugin — runs as harness-apply after the links are written.
{
  config,
  lib,
  pkgs,
  facts,
  ...
}:
let
  link = config.lib.dotfiles.link;
  config' = "domains/dev/config";
  piFiles =
    dir: suffix:
    lib.filterAttrs (name: type: type != "directory" && lib.hasSuffix suffix name) (
      builtins.readDir (../../../../domains/dev/config/pi + "/${dir}")
    );
in
{
  home.file = {
    ".claude".source = link "${config'}/claude";
    ".pi/agent/settings.json".source = link "${config'}/pi/settings.json";
    ".pi/agent/models.json".source = link "${config'}/pi/models.json";
    ".omp/agent/config.yml".source = link "${config'}/omp/config.yml";
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
    "jig/policy".source = link "domains/dev/llm/harness/policy";
  };

  # bun (mise), codex and pnpm are the user's tools: harness-apply sees the
  # user's PATH, not only activation's
  home.activation.harnessApply = lib.hm.dag.entryAfter [ "linkGeneration" ] ''
    (PATH="$PATH:${config.lib.dotfiles.userPath}" && run ${lib.getExe pkgs.harness-apply} ${lib.escapeShellArg facts.repo})
  '';

  # Commands the harnesses need that jig does not run: Claude Code's native
  # installer, its user-scoped MCP servers (from jig's output, so after
  # harnessApply), pi's packages, and a reference checkout of ECC.
  dotfiles.setup = {
    claude-cli.command = config.lib.dotfiles.devSetup "claude-cli";
    claude-mcp = {
      command = config.lib.dotfiles.devSetup "claude-mcp";
      after = [
        "harnessApply"
        "setup-claude-cli"
      ];
    };
    pi-packages = {
      command = config.lib.dotfiles.devSetup "pi-packages";
      after = [ "harnessApply" ];
    };
    ecc.command = config.lib.dotfiles.devSetup "ecc";
  };
}
