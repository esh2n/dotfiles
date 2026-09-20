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
