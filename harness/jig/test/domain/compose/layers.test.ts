import { describe, expect, test } from "bun:test";
import { type LayerSelectionInput, selectLayers } from "../../../src/domain/compose/layers";

const base: LayerSelectionInput = {
  core: { env: { CORE: "1" } },
  packs: [
    { name: "typescript", settings: { ts: true } },
    { name: "go", settings: { go: true } },
    { name: "rust", settings: { rust: true } },
  ],
  enabled: [],
};

const packNames = (selection: ReturnType<typeof selectLayers>): string[] =>
  selection.packs.map((pack) => pack.name);

describe("selectLayers", () => {
  test("core carries through, no packs when none are enabled", () => {
    const selection = selectLayers(base);
    expect(selection.core).toEqual({ env: { CORE: "1" } });
    expect(selection.packs).toEqual([]);
    expect(selection.personal).toBeUndefined();
  });

  test("includes enabled packs and excludes disabled ones", () => {
    expect(packNames(selectLayers({ ...base, enabled: ["go"] }))).toEqual(["go"]);
  });

  test("packs are ordered alphabetically by name, not by definition order", () => {
    expect(packNames(selectLayers({ ...base, enabled: ["rust", "typescript"] }))).toEqual([
      "rust",
      "typescript",
    ]);
  });

  test("personal is carried through when provided", () => {
    const selection = selectLayers({ ...base, enabled: ["go"], personal: { me: true } });
    expect(selection.personal).toEqual({ me: true });
  });

  test("an enabled name with no pack definition is reported as skipped, not thrown", () => {
    const selection = selectLayers({ ...base, enabled: ["nope", "go"] });
    expect(selection.skipped).toEqual(["nope"]);
    expect(packNames(selection)).toEqual(["go"]);
  });

  test("a name listed twice is merged once", () => {
    const selection = selectLayers({ ...base, enabled: ["go", "go"] });
    expect(packNames(selection)).toEqual(["go"]);
  });
});
