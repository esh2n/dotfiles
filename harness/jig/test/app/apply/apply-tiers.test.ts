import { describe, expect, test } from "bun:test";
import { applyTiers } from "../../../src/app/apply/apply-tiers";
import type { ApplyPorts, ProvenanceInfo } from "../../../src/app/apply/ports";
import { TIERS_MANAGED_BLOCK_MARKERS } from "../../../src/domain/tiers/markers";
import { TEST_CATALOG, TEST_CATALOG_JSON } from "../../domain/tiers/catalog-fixture";

const TIERS_JSON_PATH = "/repo/policy/tiers.json";
const PI_PATH = "/repo/config/pi/models.json";
const OMP_PATH = "/repo/config/omp/models.yml";
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
      use: ["deepseek-flash"],
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
      use: ["deepseek-v4-pro"],
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
      use: ["qwen-local"],
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
  manifest: Record<string, string>;
  provenance: Record<string, ProvenanceInfo>;
} {
  // the model catalog sits beside tiers.json
  const files: Record<string, string> = {
    [TIERS_JSON_PATH.replace(/tiers\.json$/, "models.json")]: JSON.stringify(TEST_CATALOG_JSON),
    ...initialFiles,
  };
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
      // Deterministic fake hash — good enough for plan-decision tests, no real crypto needed.
      let h = 0;
      for (let i = 0; i < content.length; i++) h = (h * 31 + content.charCodeAt(i)) | 0;
      return `fake:${h}`;
    },
    async readManifest() {
      return { ...manifest };
    },
    async writeManifest(next) {
      for (const key of Object.keys(manifest)) {
        if (!(key in next)) {
          delete manifest[key];
        }
      }
      Object.assign(manifest, next);
    },
    async writeProvenance(destDir, info) {
      provenance[destDir] = info;
    },
    now: () => new Date("2026-09-20T00:00:00.000Z"),
    jigVersion: "0.0.0-test",
  };

  return { ports, files, manifest, provenance };
}

function dshFixture(): string {
  const lines = [
    "llm-pi-ai:",
    "  providers:",
    `    ${TIERS_MANAGED_BLOCK_MARKERS.begin}`,
    "    old: content",
    `    ${TIERS_MANAGED_BLOCK_MARKERS.end}`,
  ];
  return `${lines.join("\n")}\n`;
}

describe("applyTiers", () => {
  test("dry-run never writes, even when the dest is missing", async () => {
    const { ports, files } = fakePorts({
      [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS),
    });

    const report = await applyTiers(
      {
        tiersJsonPath: TIERS_JSON_PATH,
        destPaths: { pi: PI_PATH, dsh: DSH_PATH, omp: OMP_PATH, litellm: LITELLM_PATH },
        options: { targets: ["pi"], write: false },
      },
      ports,
    );

    expect(report.results[0]?.outcome).toBe("write");
    expect(report.results[0]?.wrote).toBe(false);
    expect(files[PI_PATH]).toBeUndefined();
  });

  test("--write creates the file, updates the manifest, writes provenance", async () => {
    const { ports, files, manifest, provenance } = fakePorts({
      [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS),
    });

    const report = await applyTiers(
      {
        tiersJsonPath: TIERS_JSON_PATH,
        destPaths: { pi: PI_PATH, dsh: DSH_PATH, omp: OMP_PATH, litellm: LITELLM_PATH },
        options: { targets: ["pi"], write: true },
      },
      ports,
    );

    expect(report.results[0]?.outcome).toBe("write");
    expect(report.results[0]?.wrote).toBe(true);
    expect(files[PI_PATH]).toContain('"id": "main"');
    expect(manifest[PI_PATH]).toBe(ports.sha256(files[PI_PATH] as string));
    expect(provenance["/repo/config/pi"]?.sourceFile).toBe(TIERS_JSON_PATH);
  });

  test("a second apply with no changes is a noop", async () => {
    const { ports } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const run = () =>
      applyTiers(
        {
          tiersJsonPath: TIERS_JSON_PATH,
          destPaths: { pi: PI_PATH, dsh: DSH_PATH, omp: OMP_PATH, litellm: LITELLM_PATH },
          options: { targets: ["pi"], write: true },
        },
        ports,
      );

    await run();
    const second = await run();

    expect(second.results[0]?.outcome).toBe("noop");
    expect(second.results[0]?.wrote).toBe(false);
  });

  test("--write on a dest that already reads exactly as generated still seeds the manifest (first run, nothing to write)", async () => {
    const { ports, files, manifest } = fakePorts({
      [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS),
    });
    // Pre-populate the dest with EXACTLY what pi would generate, but with no
    // manifest entry yet — as if it were hand-authored to already match.
    const { toPiModels } = await import("../../../src/domain/tiers/write-pi");
    const { parseTiers } = await import("../../../src/domain/tiers/parse");
    files[PI_PATH] = toPiModels(parseTiers(MINIMAL_TIERS, TEST_CATALOG)).content;

    const report = await applyTiers(
      {
        tiersJsonPath: TIERS_JSON_PATH,
        destPaths: { pi: PI_PATH, dsh: DSH_PATH, omp: OMP_PATH, litellm: LITELLM_PATH },
        options: { targets: ["pi"], write: true },
      },
      ports,
    );

    expect(report.results[0]?.outcome).toBe("noop");
    expect(report.results[0]?.wrote).toBe(false);
    expect(manifest[PI_PATH]).toBe(ports.sha256(files[PI_PATH] as string));
  });

  test("a hand-edit conflict aborts: reports conflict, writes nothing", async () => {
    const { ports, files } = fakePorts({ [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS) });
    const opts = {
      tiersJsonPath: TIERS_JSON_PATH,
      destPaths: { pi: PI_PATH, dsh: DSH_PATH, omp: OMP_PATH, litellm: LITELLM_PATH },
    };

    await applyTiers({ ...opts, options: { targets: ["pi"], write: true } }, ports);
    files[PI_PATH] = "{ hand edited, not what jig generated }";

    const report = await applyTiers({ ...opts, options: { targets: ["pi"], write: true } }, ports);

    expect(report.results[0]?.outcome).toBe("conflict");
    expect(report.hasConflict).toBe(true);
    expect(files[PI_PATH]).toBe("{ hand edited, not what jig generated }");
  });

  test("dsh: markers missing is reported with a preview, never written", async () => {
    const { ports, files } = fakePorts({
      [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS),
      [DSH_PATH]: "llm-pi-ai:\n  providers:\n    local-proxy:\n      displayName: x\n",
    });

    const report = await applyTiers(
      {
        tiersJsonPath: TIERS_JSON_PATH,
        destPaths: { pi: PI_PATH, dsh: DSH_PATH, omp: OMP_PATH, litellm: LITELLM_PATH },
        options: { targets: ["dsh"], write: true },
      },
      ports,
    );

    expect(report.results[0]?.outcome).toBe("markers-missing");
    expect(report.results[0]?.preview).toContain("local-proxy:");
    expect(files[DSH_PATH]).toContain("displayName: x");
  });

  test("dsh: with markers present, --write splices and preserves surrounding text", async () => {
    const { ports, files } = fakePorts({
      [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS),
      [DSH_PATH]: dshFixture(),
    });

    const report = await applyTiers(
      {
        tiersJsonPath: TIERS_JSON_PATH,
        destPaths: { pi: PI_PATH, dsh: DSH_PATH, omp: OMP_PATH, litellm: LITELLM_PATH },
        options: { targets: ["dsh"], write: true },
      },
      ports,
    );

    expect(report.results[0]?.outcome).toBe("write");
    expect(files[DSH_PATH]).toContain("llm-pi-ai:");
    expect(files[DSH_PATH]).toContain(TIERS_MANAGED_BLOCK_MARKERS.begin);
    expect(files[DSH_PATH]).not.toContain("old: content");
  });

  test("litellm is written like dsh: the tiers block between the markers, and nothing without them", async () => {
    const withMarkers = `model_list:\n  ${TIERS_MANAGED_BLOCK_MARKERS.begin}\n  ${TIERS_MANAGED_BLOCK_MARKERS.end}\n`;
    const { ports, files } = fakePorts({
      [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS),
      [LITELLM_PATH]: withMarkers,
    });
    const run = () =>
      applyTiers(
        {
          tiersJsonPath: TIERS_JSON_PATH,
          destPaths: { pi: PI_PATH, dsh: DSH_PATH, omp: OMP_PATH, litellm: LITELLM_PATH },
          options: { targets: ["litellm"], write: true },
        },
        ports,
      );

    expect((await run()).results[0]?.outcome).toBe("write");
    expect(files[LITELLM_PATH]).toContain("  - model_name: deterministic");
    expect(files[LITELLM_PATH]).toContain("model: lm_studio/qwen/qwen3.8-27b");

    files[LITELLM_PATH] = "model_list:\n";
    expect((await run()).results[0]?.outcome).toBe("markers-missing");
    expect(files[LITELLM_PATH]).toBe("model_list:\n");
  });

  test("running all three targets returns three results", async () => {
    const { ports } = fakePorts({
      [TIERS_JSON_PATH]: JSON.stringify(MINIMAL_TIERS),
      [DSH_PATH]: dshFixture(),
      [LITELLM_PATH]: "model_list:\n",
    });

    const report = await applyTiers(
      {
        tiersJsonPath: TIERS_JSON_PATH,
        destPaths: { pi: PI_PATH, dsh: DSH_PATH, omp: OMP_PATH, litellm: LITELLM_PATH },
        options: { targets: ["pi", "dsh", "litellm"], write: false },
      },
      ports,
    );

    expect(report.results.map((r) => r.target)).toEqual(["pi", "dsh", "litellm"]);
  });

  test("throws a clear error when tiers.json itself is missing", async () => {
    const { ports } = fakePorts({});

    await expect(
      applyTiers(
        {
          tiersJsonPath: TIERS_JSON_PATH,
          destPaths: { pi: PI_PATH, dsh: DSH_PATH, omp: OMP_PATH, litellm: LITELLM_PATH },
          options: { targets: ["pi"], write: false },
        },
        ports,
      ),
    ).rejects.toThrow(/tiers\.json not found/);
  });
});
