import { describe, expect, test } from "bun:test";
import {
  type ComposeInput,
  composeSettings,
  selectLayers,
} from "../../../src/domain/compose/layers";

const base: ComposeInput = {
  core: { env: { CORE: "1" } },
  packs: [
    { name: "typescript", settings: { ts: true } },
    { name: "go", settings: { go: true } },
    { name: "rust", settings: { rust: true } },
  ],
  enabled: [],
};

describe("selectLayers", () => {
  test("core only when no packs are enabled", () => {
    expect(selectLayers(base).map((l) => l.name)).toEqual(["core"]);
  });

  test("includes enabled packs and excludes disabled ones", () => {
    const layers = selectLayers({ ...base, enabled: ["go"] });
    expect(layers.map((l) => l.name)).toEqual(["core", "go"]);
  });

  test("packs keep their definition order regardless of enabled order", () => {
    const layers = selectLayers({ ...base, enabled: ["rust", "typescript"] });
    expect(layers.map((l) => l.name)).toEqual(["core", "typescript", "rust"]);
  });

  test("personal is appended last when provided", () => {
    const layers = selectLayers({ ...base, enabled: ["go"], personal: { me: true } });
    expect(layers.map((l) => l.name)).toEqual(["core", "go", "personal"]);
  });

  test("an enabled pack that does not exist is a loud error", () => {
    expect(() => selectLayers({ ...base, enabled: ["nope"] })).toThrow(/unknown pack: nope/);
  });
});

describe("composeSettings", () => {
  test("merges core, enabled packs, and personal end to end", () => {
    const merged = composeSettings({
      core: { hooks: { PreToolUse: [{ m: "core" }] }, env: { A: "1" } },
      packs: [{ name: "ts", settings: { hooks: { PostToolUse: [{ m: "ts" }] } } }],
      enabled: ["ts"],
      personal: { env: { A: "2" } },
    });
    expect(merged).toEqual({
      hooks: { PreToolUse: [{ m: "core" }], PostToolUse: [{ m: "ts" }] },
      env: { A: "2" },
    });
  });
});
