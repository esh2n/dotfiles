import { describe, expect, test } from "bun:test";
import type { ApplyPorts, ProvenanceInfo } from "../../src/app/apply/ports";
import { applyCli } from "../../src/cli/apply";

const TIERS_JSON_PATH = "/repo/policy/tiers.json";
const PI_PATH = "/repo/config/pi/models.json";
const DSH_PATH = "/repo/config/dsh/settings.yaml";
const LITELLM_PATH = "/repo/config/litellm/config.yaml";

const MINIMAL_TIERS = {
  version: 1,
  connections: {
    proxy: {
      baseUrl: "http://localhost:4000/v1",
      api: "openai-completions",
      compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" },
      pi: { apiKey: "sk-local-proxy" },
      dsh: { displayName: "LiteLLM (local)", apiKeyEnv: "LITELLM_API_KEY" },
    },
  },
  tiers: {
    main: {
      alias: "main",
      displayName: "DeepSeek Flash",
      backend: { provider: "deepseek", model: "deepseek-flash", apiKeyEnv: "DEEPSEEK_API_KEY" },
      reasoning: true,
      input: ["text"],
      contextWindow: 1000000,
      maxTokens: 16384,
      compat: { thinkingFormat: "deepseek" },
      pi: { name: "main" },
      dsh: { name: "main" },
    },
    complex: {
      alias: "complex",
      displayName: "DeepSeek V4 Pro",
      backend: { provider: "deepseek", model: "deepseek-v4-pro", apiKeyEnv: "DEEPSEEK_API_KEY" },
      reasoning: true,
      input: ["text"],
      contextWindow: 1000000,
      maxTokens: 32768,
      compat: { thinkingFormat: "deepseek" },
      pi: { name: "complex" },
      dsh: { name: "complex" },
    },
    deterministic: {
      alias: "deterministic",
      displayName: "local Qwen",
      backend: { provider: "lm_studio", model: "qwen/qwen3.8-27b" },
      reasoning: true,
      input: ["text"],
      contextWindow: 131072,
      maxTokens: 32768,
      compat: { thinkingFormat: "qwen-chat-template", supportsReasoningEffort: false },
      pi: { name: "deterministic" },
      dsh: { name: "deterministic" },
    },
  },
};

function fakePorts(initialFiles: Record<string, string>): {
  ports: ApplyPorts;
  files: Record<string, string>;
} {
  const files: Record<string, string> = { ...initialFiles };
  const manifest: Record<string, string> = {};
  const provenance: Record<string, ProvenanceInfo> = {};

  const ports: ApplyPorts = {
    async readFile(path) {
      return files[path];
    },
    async writeAtomic(path, content) {
      files[path] = content;
    },
    sha256(content) {
      let h = 0;
      for (let i = 0; i < content.length; i++) h = (h * 31 + content.charCodeAt(i)) | 0;
      return `fake:${h}`;
    },
    async readManifest() {
      return { ...manifest };
    },
    async writeManifest(next) {
      for (const key of Object.keys(manifest)) {
        if (!(key in next)) delete manifest[key];
      }
      Object.assign(manifest, next);
    },
    async writeProvenance(destDir, info) {
      provenance[destDir] = info;
    },
    now: () => new Date("2026-09-20T00:00:00.000Z"),
    jigVersion: "0.0.0-test",
  };

  return { ports, files };
}

const paths = {
  tiersJsonPath: TIERS_JSON_PATH,
  destPaths: { pi: PI_PATH, dsh: DSH_PATH, litellm: LITELLM_PATH },
};

describe("applyCli", () => {
  test("defaults to all targets, dry-run, exit 0", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli([], ports, paths);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("== pi ==");
    expect(result.stdout).toContain("== dsh ==");
    expect(result.stdout).toContain("== litellm ==");
  });

  test("--target pi restricts to one target", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target", "pi"], ports, paths);

    expect(result.stdout).toContain("== pi ==");
    expect(result.stdout).not.toContain("== dsh ==");
  });

  test("--target=pi (equals form) works too", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target=pi"], ports, paths);
    expect(result.stdout).toContain("== pi ==");
  });

  test("rejects an unknown --target", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target", "bogus"], ports, paths);
    expect(result.code).toBe(2);
    expect(result.stdout).toMatch(/unknown --target/);
  });

  test("--target all never reaches claude: that target writes into $HOME and must be named", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli([], ports, paths);
    expect(result.stdout).toContain("== pi ==");
    expect(result.stdout).not.toContain("== claude ==");
  });

  test("--target claude with no claude context is refused rather than silently doing nothing", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target", "claude"], ports, paths);
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("not wired");
  });
});

/**
 * The claude dry-run's report, which is what a reader agrees to before
 * `--write`. Exercised through the CLI because the wording — what is owned,
 * what leaves, where the sandbox list came from — IS the contract; a correct
 * composition reported badly is still a surprise.
 */
describe("applyCli --target claude", () => {
  const CLAUDE_PATHS = {
    guardRules: "/repo/policy/guard-rules.json",
    mcpServers: "/repo/mcp/servers.json",
    sandbox: "/repo/policy/sandbox.json",
    decisions: "/repo/rules/decisions",
    settings: "/home/u/.claude/settings.json",
    home: "/home/u",
  };

  const SOURCES: Record<string, string> = {
    [CLAUDE_PATHS.guardRules]: JSON.stringify({ version: 1, floor: [], rules: [] }),
    [CLAUDE_PATHS.mcpServers]: JSON.stringify({ schemaVersion: "jig.mcp.v1", servers: [] }),
    [`${CLAUDE_PATHS.decisions}/a.md`]: "# 題\n\nStatus: accepted — x\n\nrule: Do the thing.\n",
  };

  function claudeContext(extra: Record<string, string> = {}) {
    const files: Record<string, string> = { ...SOURCES, ...extra };
    const manifest: Record<string, string> = {};
    return {
      ports: {
        async readFile(path: string) {
          return files[path];
        },
        async writeAtomic(path: string, content: string) {
          files[path] = content;
        },
        async listDir(path: string) {
          const prefix = `${path}/`;
          return Object.keys(files)
            .filter((file) => file.startsWith(prefix))
            .map((file) => file.slice(prefix.length));
        },
        sha256: (content: string) => `fake:${content.length}`,
        async readManifest() {
          return { ...manifest };
        },
        async writeManifest(next: Readonly<Record<string, string>>) {
          Object.assign(manifest, next);
        },
        async writeProvenance() {},
        now: () => new Date("2026-09-23T00:00:00.000Z"),
        jigVersion: "0.0.0-test",
      },
      paths: CLAUDE_PATHS,
      hookPaths: { bun: "/abs/bun", jig: "/abs/jig.ts" },
    };
  }

  test("reports the five hooks, the owned keys, and the paste-ready permit fragment", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target", "claude"], ports, paths, claudeContext());

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("hooks (5):");
    expect(result.stdout).toContain("hooks stop-gate --harness claude");
    expect(result.stdout).toContain("keys jig now owns (6):");
    // The policy file is not agent-writable, so the dry-run hands over the text.
    expect(result.stdout).toContain("not agent-writable by design");
    expect(result.stdout).toContain('"id": "permit-git-commit"');
  });

  test("names permissions.deny a backstop and the PreToolUse hook the enforcement", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target", "claude"], ports, paths, claudeContext());
    expect(result.stdout).toContain("permissions.deny is a backstop only");
  });

  test("excludedCommands and its provenance are reported when policy/sandbox.json exists", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const context = claudeContext({
      [CLAUDE_PATHS.sandbox]: JSON.stringify({ excludedCommands: ["gh", "docker", "open"] }),
    });
    const result = await applyCli(["--target", "claude"], ports, paths, context);

    expect(result.stdout).toContain(
      "excludedCommands copied from /repo/policy/sandbox.json: gh, docker, open",
    );
    expect(result.stdout).toContain("still goes through jig's guard");
  });

  test("without that file the report says the empty list was a default, not a choice", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target", "claude"], ports, paths, claudeContext());
    expect(result.stdout).toContain("NO policy/sandbox.json");
  });

  test("an accepted note with no rule line is a WARNING, not a silent omission", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const context = claudeContext({
      [`${CLAUDE_PATHS.decisions}/b.md`]: "# 題\n\nStatus: accepted — x\n",
    });
    const result = await applyCli(["--target", "claude"], ports, paths, context);

    expect(result.stdout).toContain("WARNING: 1 accepted decision note(s) carry no `rule:` line");
    expect(result.stdout).toContain("- b.md");
  });

  test("dry-run writes nothing even with a real destination path", async () => {
    const { ports, files } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    await applyCli(["--target", "pi"], ports, paths);
    expect(files[PI_PATH]).toBeUndefined();
  });

  test("--write actually writes pi", async () => {
    const { ports, files } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const result = await applyCli(["--target", "pi", "--write"], ports, paths);
    expect(result.code).toBe(0);
    expect(files[PI_PATH]).toContain('"id": "main"');
  });

  test("litellm --write is refused but exits 0 (documented, correct behavior)", async () => {
    const { ports, files } = fakePorts({
      [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS),
      [LITELLM_PATH]: "model_list:\n",
    });
    const result = await applyCli(["--target", "litellm", "--write"], ports, paths);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/deferred/);
    expect(files[LITELLM_PATH]).toBe("model_list:\n");
  });

  test("pi --write with a hand-edit conflict exits nonzero", async () => {
    const { ports, files } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    await applyCli(["--target", "pi", "--write"], ports, paths);
    files[PI_PATH] = "hand edited";

    const result = await applyCli(["--target", "pi", "--write"], ports, paths);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/conflict/);
  });

  test("dsh --write with markers missing exits nonzero (the write was requested but couldn't happen)", async () => {
    const { ports } = fakePorts({
      [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS),
      [DSH_PATH]: "llm-pi-ai:\n  providers:\n    local-proxy:\n      displayName: x\n",
    });
    const result = await applyCli(["--target", "dsh", "--write"], ports, paths);
    expect(result.code).toBe(1);
  });
});
