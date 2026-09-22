import { describe, expect, test } from "bun:test";
import {
  BOX_NETWORK_ALLOW,
  JIG_HOME,
  normalizeAgent,
  renderAgentKit,
} from "../../../src/app/box/kit";

const SOURCE = {
  "package.json": '{"name":"jig"}',
  "bun.lock": "lock",
  "tsconfig.json": "{}",
  "src/cli/jig.ts": "// entry",
};

function render(agent: "claude" | "codex"): Record<string, string> {
  return renderAgentKit({
    agent,
    jigSource: SOURCE,
    guardRules: '{"version":3,"rules":[]}',
    instructions: "# instructions",
  });
}

/** The argv sbx would actually launch, read from the parsed spec. */
function entrypoint(agent: "claude" | "codex"): string[] {
  const parsed = Bun.YAML.parse(render(agent)["spec.yaml"] ?? "") as {
    sandbox?: { entrypoint?: string[] };
  };
  return parsed.sandbox?.entrypoint ?? [];
}

describe("renderAgentKit", () => {
  test("jig's source lands under the agent user's home, not the workspace", () => {
    const files = render("claude");
    expect(files["files/home/.local/share/jig/src/cli/jig.ts"]).toBe("// entry");
    expect(files["files/home/.local/share/jig/package.json"]).toBe('{"name":"jig"}');
    expect(files["files/home/.local/share/jig/bun.lock"]).toBe("lock");
  });

  test("the guard policy lands where jig's hook already looks for it", () => {
    // `app/hooks/environment.ts` defaults to ~/.config/jig/policy/guard-rules.json,
    // so no environment variable is needed inside the box.
    expect(render("claude")["files/home/.config/jig/policy/guard-rules.json"]).toBe(
      '{"version":3,"rules":[]}',
    );
  });

  test("instructions go to the file each agent actually reads", () => {
    expect(render("claude")["files/home/.claude/CLAUDE.md"]).toBe("# instructions");
    expect(render("claude")["files/home/.codex/AGENTS.md"]).toBeUndefined();
    expect(render("codex")["files/home/.codex/AGENTS.md"]).toBe("# instructions");
    expect(render("codex")["files/home/.claude/CLAUDE.md"]).toBeUndefined();
  });

  test("no static file targets a managed path", () => {
    // sbx owns these; a static file over them is either clobbered or clobbers.
    const managed = [
      "files/home/.claude.json",
      "files/home/.claude/settings.json",
      "files/home/.claude/.config.json",
      "files/home/.codex/config.toml",
    ];
    for (const agent of ["claude", "codex"] as const) {
      const files = render(agent);
      for (const path of managed) expect(files[path]).toBeUndefined();
    }
  });

  test("the spec is a FORK of the built-in agent, not a mixin", () => {
    // A mixin "must not declare a sandbox: block, extends:, or mixins:", so a
    // mixin cannot reach the entrypoint — which is the whole reason for this.
    for (const agent of ["claude", "codex"] as const) {
      const spec = render(agent)["spec.yaml"] ?? "";
      expect(spec).toContain("kind: sandbox");
      expect(spec).toContain(`extends: ${agent}`);
      expect(spec).not.toContain("kind: mixin");
      expect(spec).not.toContain("requires:");
    }
  });

  test("the entrypoint replaces the built-in --dangerously-* one", () => {
    // Read out of the sbx v0.43.0 binary: the built-in kits launch
    // [claude, "--dangerously-skip-permissions"] and
    // [codex, "--dangerously-bypass-approvals-and-sandbox"]. Asserted on the
    // parsed argv, not the text — the comments above it quote those flags.
    expect(entrypoint("claude")).toEqual(["claude", "--permission-mode", "auto"]);
    expect(entrypoint("codex")).toEqual(["codex", "--approve-for-me"]);
  });

  test("no --dangerously-* flag survives into either entrypoint", () => {
    for (const agent of ["claude", "codex"] as const) {
      expect(entrypoint(agent).some((arg) => arg.startsWith("--dangerously"))).toBe(false);
    }
  });

  test("hook trust is persisted, not bypassed", () => {
    // `jig codex register --write` writes codex's own [hooks.state.…] entry,
    // so the box never needs --dangerously-bypass-hook-trust.
    expect(entrypoint("codex")).not.toContain("--dangerously-bypass-hook-trust");
    expect(render("codex")["spec.yaml"]).toContain("codex register --write");
  });

  test("every allowed domain is listed in the spec", () => {
    const spec = render("claude")["spec.yaml"] ?? "";
    for (const domain of BOX_NETWORK_ALLOW) expect(spec).toContain(`      - ${domain}`);
  });

  test("bun is installed and jig's dependencies are resolved at create time", () => {
    const spec = render("claude")["spec.yaml"] ?? "";
    expect(spec).toContain("npm install -g bun");
    // In `install`, not `startup`: startup does not gate the agent entrypoint.
    const install = spec.slice(spec.indexOf("install:"), spec.indexOf("startup:"));
    expect(install).toContain(`cd ${JIG_HOME} && bun install --frozen-lockfile`);
  });

  test("claude gets bubblewrap and its own sandbox turned on, fail-closed", () => {
    const spec = render("claude")["spec.yaml"] ?? "";
    expect(spec).toContain("apt-get install -y bubblewrap socat");
    expect(spec).toContain('"failIfUnavailable": True');
    expect(spec).toContain('"allowUnsandboxedCommands": False');
    for (const domain of BOX_NETWORK_ALLOW) expect(spec).toContain(`"${domain}"`);
  });

  test("claude's guard is registered as a PreToolUse hook without clobbering other keys", () => {
    const spec = render("claude")["spec.yaml"] ?? "";
    expect(spec).toContain("Bash|Read|Write|Edit|MultiEdit|WebFetch");
    expect(spec).toContain(`${JIG_HOME}/src/cli/jig.ts hooks pre-tool-use --harness claude`);
    // Merged, not replaced: existing settings and other hook groups survive.
    expect(spec).toContain("s = json.load(open(p)) if os.path.exists(p) else {}");
    expect(spec).toContain('hooks = s.setdefault("hooks", {})');
    expect(spec).toContain('kept = [g for g in hooks.get("PreToolUse", [])');
  });

  test("the settings' default permission mode is brought in line with the entrypoint", () => {
    // The parent image ships bypassPermissions there; the flag wins for the
    // session, but the file should not say the opposite of the argv.
    const spec = render("claude")["spec.yaml"] ?? "";
    expect(spec).toContain('s.setdefault("permissions", {})["defaultMode"] = "auto"');
    expect(spec).not.toContain('"bypassPermissions"');
  });

  test("the hook command carries an absolute bun, and fails loudly when there is none", () => {
    // The hook runs in Claude Code's environment, not a login shell, so a
    // bare `bun` is a guard that silently never runs.
    const spec = render("claude")["spec.yaml"] ?? "";
    expect(spec).toContain('bun = shutil.which("bun")');
    expect(spec).toContain('"command": bun + " " + ');
    expect(spec).toContain("jig: bun not found — guard NOT registered");
    expect(spec).toContain("sys.exit(1)");
  });

  test("codex drops danger-full-access and registers the guard", () => {
    const spec = render("codex")["spec.yaml"] ?? "";
    expect(spec).toContain("sed -i 's/danger-full-access/workspace-write/g'");
    expect(spec).toContain("[sandbox_workspace_write]");
    expect(spec).toContain("network_access = true");
    expect(spec).toContain(`bun ${JIG_HOME}/src/cli/jig.ts codex register --write`);
    // codex has no second-layer sandbox of its own, so nothing is apt-installed for one.
    expect(spec).not.toContain("apt-get install");
  });

  test("no credential is ever declared by the agent kit", () => {
    for (const agent of ["claude", "codex"] as const) {
      expect(render(agent)["spec.yaml"]).not.toContain("credentials:");
    }
  });

  test("the spec parses as YAML with the fields sbx composes on", () => {
    for (const agent of ["claude", "codex"] as const) {
      const spec = render(agent)["spec.yaml"] ?? "";
      const parsed = Bun.YAML.parse(spec) as Record<string, unknown>;
      expect(parsed.schemaVersion).toBe("2");
      expect(parsed.kind).toBe("sandbox");
      expect(parsed.extends).toBe(agent);
      expect(parsed.name).toBe(`jig-${agent}`);

      const sandbox = parsed.sandbox as { entrypoint?: unknown };
      expect(Array.isArray(sandbox.entrypoint)).toBe(true);
      expect((sandbox.entrypoint as string[])[0]).toBe(agent);
      // No image: inherited from the parent, which is the point of extends.
      expect(Object.keys(sandbox)).toEqual(["entrypoint"]);
    }
  });
});

describe("normalizeAgent", () => {
  test("maps a fork kit's name back to the built-in agent behind it", () => {
    expect(normalizeAgent("jig-claude")).toBe("claude");
    expect(normalizeAgent("jig-codex")).toBe("codex");
  });

  test("leaves a plain built-in agent alone", () => {
    expect(normalizeAgent("claude")).toBe("claude");
    expect(normalizeAgent("gemini")).toBe("gemini");
  });
});
