import { describe, expect, test } from "bun:test";
import { type Layer, mergeSettings } from "../../../src/domain/compose/settings";

const layer = (name: string, settings: Layer["settings"]): Layer => ({ name, settings });

describe("mergeSettings", () => {
  test("no layers merge to an empty object", () => {
    expect(mergeSettings([])).toEqual({});
  });

  test("a single layer passes through unchanged", () => {
    expect(mergeSettings([layer("core", { env: { A: "1" } })])).toEqual({ env: { A: "1" } });
  });

  test("objects deep-merge by key across layers", () => {
    const merged = mergeSettings([
      layer("core", { env: { A: "1" } }),
      layer("pack", { env: { B: "2" } }),
    ]);
    expect(merged).toEqual({ env: { A: "1", B: "2" } });
  });

  test("scalars are last-wins in layer order", () => {
    const merged = mergeSettings([
      layer("core", { env: { A: "1" } }),
      layer("personal", { env: { A: "2" } }),
    ]);
    expect(merged).toEqual({ env: { A: "2" } });
  });

  test("arrays concatenate (hooks accumulate across layers)", () => {
    const merged = mergeSettings([
      layer("core", { hooks: { PreToolUse: [{ matcher: "Bash" }] } }),
      layer("ts", { hooks: { PostToolUse: [{ matcher: "Edit" }] } }),
      layer("go", { hooks: { PreToolUse: [{ matcher: "Write" }] } }),
    ]);
    expect(merged).toEqual({
      hooks: {
        PreToolUse: [{ matcher: "Bash" }, { matcher: "Write" }],
        PostToolUse: [{ matcher: "Edit" }],
      },
    });
  });

  test("a type mismatch between layers is last-wins", () => {
    expect(mergeSettings([layer("a", { x: [1, 2] }), layer("b", { x: "now-a-string" })])).toEqual({
      x: "now-a-string",
    });
  });

  test("does not mutate the input layers", () => {
    const core = layer("core", { env: { A: "1" } });
    mergeSettings([core, layer("p", { env: { A: "2" } })]);
    expect(core.settings).toEqual({ env: { A: "1" } });
  });
});
