import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, parseSwarmConfig } from "../../../src/domain/swarm/config";
import { parseSpecs } from "../../../src/domain/swarm/spec";

describe("swarm start items", () => {
  test("defaults fill the tier, an empty scope and no isolation", () => {
    const r = parseSpecs([{ name: "port-a", task: "do a" }], "main", new Set(), 10);
    expect(r).toEqual({
      ok: true,
      specs: [{ name: "port-a", task: "do a", tier: "main", files: [], isolated: false }],
    });
  });

  test("every field is carried when given", () => {
    const r = parseSpecs(
      [
        {
          name: "b",
          task: "t",
          tier: "deterministic",
          effort: "high",
          files: ["src/**"],
          isolated: true,
        },
      ],
      "main",
      new Set(),
      10,
    );
    expect(r.ok && r.specs[0]).toEqual({
      name: "b",
      task: "t",
      tier: "deterministic",
      effort: "high",
      files: ["src/**"],
      isolated: true,
    });
  });

  test.each([
    [[], "non-empty list"],
    [[{ name: "Bad Name", task: "t" }], "lowercase"],
    [[{ name: "a", task: " " }], "task"],
    [[{ name: "a", task: "t", tier: "fast" }], "tier must be one of"],
    [[{ name: "a", task: "t", effort: "extreme" }], "effort must be one of"],
    [[{ name: "a", task: "t", files: "src" }], "files must be a list"],
    [[{ name: "a", task: "t", files: ["../x"] }], "inside the checkout"],
    [[{ name: "a", task: "t", files: ["/etc/x"] }], "inside the checkout"],
    [[{ name: "a", task: "t", isolated: "yes" }], "isolated"],
  ])("%j is refused (%s)", (items, message) => {
    const r = parseSpecs(items, "main", new Set(), 10);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(message);
  });

  test("a name is never reused, within a call or across the session", () => {
    const dup = parseSpecs(
      [
        { name: "a", task: "t" },
        { name: "a", task: "u" },
      ],
      "main",
      new Set(),
      10,
    );
    expect(!dup.ok && dup.error).toContain("already used");
    const again = parseSpecs([{ name: "a", task: "t" }], "main", new Set(["a"]), 10);
    expect(!again.ok && again.error).toContain("already used");
  });

  test("more items than the session has room for is refused, naming the limit", () => {
    const r = parseSpecs(
      [
        { name: "a", task: "t" },
        { name: "b", task: "t" },
      ],
      "main",
      new Set(),
      1,
    );
    expect(!r.ok && r.error).toContain("maxWorkers");
  });
});

describe("swarm.json", () => {
  test("an empty object is the defaults", () => {
    expect(parseSwarmConfig({})).toEqual(DEFAULT_CONFIG);
  });

  test("a tier given alone keeps the others' defaults", () => {
    const c = parseSwarmConfig({ maxConcurrent: { main: 3 } });
    expect(c.maxConcurrent).toEqual({ main: 3, complex: 4, deterministic: 1 });
  });

  test.each([
    [{ maxWorkers: 0 }, "positive integer"],
    [{ maxConcurrent: { fast: 1 } }, "unknown tier"],
    [{ budget: 5 }, "unknown key"],
    [[], "JSON object"],
  ])("%j is refused (%s)", (json, message) => {
    expect(() => parseSwarmConfig(json)).toThrow(message);
  });
});
