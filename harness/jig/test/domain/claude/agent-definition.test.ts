import { describe, expect, test } from "bun:test";
import { modelChoiceFor, parseAgentDefinition } from "../../../src/domain/claude/agent-definition";

const MAP = {
  sonnet: { model: "gpt-6-luna", reasoningEffort: "high" },
  opus: { model: "gpt-6-sol" },
};

describe("parseAgentDefinition: the models: override block", () => {
  test("block form: one entry per target, fields as written, quotes stripped", () => {
    const text = [
      "---",
      "name: architect",
      "model: opus",
      "models:",
      "  codex:",
      "    model: gpt-6-sol",
      '    reasoningEffort: "high"',
      "  omp:",
      "    model: '@architect'",
      "tools: [Read]",
      "---",
      "Plan.",
      "",
    ].join("\n");
    expect(parseAgentDefinition(text, "architect")).toEqual({
      name: "architect",
      description: "",
      tools: ["Read"],
      model: "opus",
      models: {
        codex: { model: "gpt-6-sol", reasoningEffort: "high" },
        omp: { model: "@architect" },
      },
      body: "Plan.",
    });
  });

  test("flow form: the one-line YAML mapping the README shows", () => {
    const text =
      '---\nname: a\nmodels: { codex: { model: "gpt-6-sol", reasoningEffort: "medium" } }\n---\nx\n';
    expect(parseAgentDefinition(text, "a").models).toEqual({
      codex: { model: "gpt-6-sol", reasoningEffort: "medium" },
    });
    expect(
      parseAgentDefinition("---\nmodels: {codex: {model: gpt-6-luna}}\n---\nx\n", "a").models,
    ).toEqual({ codex: { model: "gpt-6-luna" } });
  });

  test("no models: block means no override, and the record carries no key for it", () => {
    expect(parseAgentDefinition("---\nmodel: sonnet\n---\nx\n", "a")).not.toHaveProperty("models");
  });

  test("a malformed block is an error naming the file and the key, never a dropped override", () => {
    expect(() =>
      parseAgentDefinition("---\nmodels:\n  codex:\n    reasoningEffort: high\n---\nx\n", "a"),
    ).toThrow('a.md: models.codex: "model" must be a non-empty string');
    expect(() =>
      parseAgentDefinition(
        "---\nmodels:\n  codex:\n    model: gpt-6-sol\n    effort: high\n---\nx\n",
        "a",
      ),
    ).toThrow('a.md: models.codex: unknown key "effort"');
    expect(() => parseAgentDefinition("---\nmodels:\n  codex: gpt-6-sol\n---\nx\n", "a")).toThrow(
      "a.md: models.codex: expected a mapping, not a scalar",
    );
    expect(() => parseAgentDefinition("---\nmodels: { codex: gpt-6-sol }\n---\nx\n", "a")).toThrow(
      "a.md: models.codex: expected a mapping, not a scalar",
    );
    expect(() => parseAgentDefinition("---\nmodels: { codex: { model: x }\n---\nx\n", "a")).toThrow(
      "a.md: models: expected , or }",
    );
  });
});

describe("modelChoiceFor", () => {
  test("a mapped tier carries the model and the effort the table gives it", () => {
    expect(modelChoiceFor("sonnet", MAP)).toEqual({
      kind: "mapped",
      tier: "sonnet",
      model: "gpt-6-luna",
      reasoningEffort: "high",
    });
    expect(modelChoiceFor("opus", MAP)).toEqual({
      kind: "mapped",
      tier: "opus",
      model: "gpt-6-sol",
    });
    expect(modelChoiceFor("haiku", MAP)).toEqual({ kind: "unmapped", tier: "haiku" });
  });

  test("an override wins over the tier and says so; the tier is kept beside it when named", () => {
    expect(
      modelChoiceFor("sonnet", MAP, { model: "gpt-6-sol", reasoningEffort: "medium" }),
    ).toEqual({
      kind: "mapped",
      tier: "sonnet",
      model: "gpt-6-sol",
      reasoningEffort: "medium",
      override: true,
    });
    expect(modelChoiceFor(undefined, MAP, { model: "gpt-6-sol" })).toEqual({
      kind: "mapped",
      model: "gpt-6-sol",
      override: true,
    });
    expect(modelChoiceFor("inherit", MAP, { model: "gpt-6-sol" })).not.toHaveProperty("tier");
  });

  test("absent and `inherit` both mean: leave `model` out, and that is not a gap", () => {
    expect(modelChoiceFor(undefined, MAP)).toEqual({ kind: "inherit" });
    expect(modelChoiceFor("inherit", MAP)).toEqual({ kind: "inherit" });
  });
});
