import { describe, expect, test } from "bun:test";
import {
  AGENT_MODELS_SCHEMA_VERSION,
  EMPTY_AGENT_MODELS,
  parseAgentModels,
  parseModelMapping,
} from "../../../src/domain/claude/agent-models";

const LABEL = "/repo/llm/harness/agents/models.json";

const RULED = JSON.stringify({
  schemaVersion: AGENT_MODELS_SCHEMA_VERSION,
  _comment: ["why", "and where from"],
  codex: {
    sonnet: { model: "gpt-6-luna", reasoningEffort: "high" },
    haiku: { model: "gpt-6-luna", reasoningEffort: "medium" },
    Opus: { model: "gpt-6-sol", reasoningEffort: "medium", _comment: "the one that plans" },
  },
  omp: {},
});

describe("parseAgentModels", () => {
  test("one table per target, tiers lower-cased, comments skipped, omp empty until ruled", () => {
    expect(parseAgentModels(RULED, LABEL)).toEqual({
      codex: {
        sonnet: { model: "gpt-6-luna", reasoningEffort: "high" },
        haiku: { model: "gpt-6-luna", reasoningEffort: "medium" },
        opus: { model: "gpt-6-sol", reasoningEffort: "medium" },
      },
      omp: {},
    });
  });

  test("a target absent from the file is an empty table, not an error", () => {
    const text = JSON.stringify({ schemaVersion: AGENT_MODELS_SCHEMA_VERSION, codex: {} });
    expect(parseAgentModels(text, LABEL)).toEqual(EMPTY_AGENT_MODELS);
  });

  test("the effort is optional; a model alone is a mapping", () => {
    const text = JSON.stringify({
      schemaVersion: AGENT_MODELS_SCHEMA_VERSION,
      omp: { sonnet: { model: "@review" } },
    });
    expect(parseAgentModels(text, LABEL).omp).toEqual({ sonnet: { model: "@review" } });
  });

  test("a wrong schemaVersion, an unknown target, or a malformed entry is an error naming the file and the key", () => {
    expect(() => parseAgentModels(JSON.stringify({ schemaVersion: "v0" }), LABEL)).toThrow(
      `${LABEL}: unsupported schemaVersion "v0"`,
    );
    expect(() =>
      parseAgentModels(
        JSON.stringify({ schemaVersion: AGENT_MODELS_SCHEMA_VERSION, codx: {} }),
        LABEL,
      ),
    ).toThrow('unknown target "codx" (expected codex, omp)');
    expect(() =>
      parseAgentModels(
        JSON.stringify({
          schemaVersion: AGENT_MODELS_SCHEMA_VERSION,
          codex: { sonnet: "gpt-6-luna" },
        }),
        LABEL,
      ),
    ).toThrow(`${LABEL}: codex.sonnet: expected an object with a "model" key`);
    expect(() =>
      parseAgentModels(
        JSON.stringify({
          schemaVersion: AGENT_MODELS_SCHEMA_VERSION,
          codex: { sonnet: { model: "" } },
        }),
        LABEL,
      ),
    ).toThrow('codex.sonnet: "model" must be a non-empty string');
    expect(() =>
      parseAgentModels(
        JSON.stringify({ schemaVersion: AGENT_MODELS_SCHEMA_VERSION, codex: ["gpt-6-luna"] }),
        LABEL,
      ),
    ).toThrow('"codex" must be an object keyed by tier');
    expect(() => parseAgentModels("[]", LABEL)).toThrow("expected a JSON object");
  });
});

describe("parseModelMapping", () => {
  test("an extra key is an error, so a misspelt reasoningEffort cannot pass as nothing", () => {
    expect(() =>
      parseModelMapping({ model: "gpt-6-luna", reasoning_effort: "high" }, "codex.sonnet"),
    ).toThrow('codex.sonnet: unknown key "reasoning_effort" (expected model, reasoningEffort)');
    expect(() => parseModelMapping({ model: "gpt-6-luna", reasoningEffort: 3 }, "x")).toThrow(
      '"reasoningEffort" must be a non-empty string when present',
    );
  });

  test("values are trimmed", () => {
    expect(parseModelMapping({ model: " gpt-6-sol ", reasoningEffort: "medium " }, "x")).toEqual({
      model: "gpt-6-sol",
      reasoningEffort: "medium",
    });
  });
});
