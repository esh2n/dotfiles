import { describe, expect, test } from "bun:test";
import { type YamlObject, composeOmpConfig, ompOwnedView } from "../../../src/domain/omp/config";

describe("omp's config.yml", () => {
  test("a new file gets jig's keys and omp's bootstrap values", () => {
    const { config, carried } = composeOmpConfig(undefined);
    expect(config.modelRoles).toMatchObject({ default: "proxy/main", slow: "proxy/complex" });
    expect(config.tools).toEqual({ approvalMode: "yolo", approval: { eval: "prompt" } });
    expect(config.statusLine).toMatchObject({
      preset: "custom",
      rightSegments: ["status", "time_spent", "cost"],
    });
    expect(config).toMatchObject({ symbolPreset: "unicode", setupVersion: 2 });
    expect(carried).toEqual([]);
  });

  test("keys omp wrote are carried, bootstrap values are not forced back", () => {
    const current: YamlObject = {
      theme: { dark: "dracula" },
      setupVersion: 5,
      tools: { approvalMode: "ask", approval: { eval: "allow", edit: "prompt" }, other: 1 },
      bash: { patterns: ["git *"] },
    };
    const { config, carried } = composeOmpConfig(current);
    expect(config.theme).toEqual({ dark: "dracula" });
    expect(config.setupVersion).toBe(5);
    expect(config.symbolPreset).toBeUndefined();
    expect(config.tools).toEqual({
      approvalMode: "yolo",
      approval: { eval: "prompt", edit: "prompt" },
      other: 1,
    });
    expect(config.bash).toEqual({ patterns: ["git *"] });
    expect(carried).toEqual(["theme", "setupVersion", "tools", "bash"]);
  });

  test("composing the composed file again changes nothing", () => {
    const once = composeOmpConfig({ theme: { light: "x" } }).config;
    expect(composeOmpConfig(once).config).toEqual(once);
  });

  test("the owned view ignores what omp changes and sees what jig owns", () => {
    const base = composeOmpConfig(undefined).config;
    const themed = { ...base, theme: { dark: "other" } };
    expect(ompOwnedView(themed)).toBe(ompOwnedView(base));
    const edited = { ...base, modelRoles: { default: "anthropic/claude" } };
    expect(ompOwnedView(edited)).not.toBe(ompOwnedView(base));
    expect(ompOwnedView(undefined)).toBe("[]");
  });
});
