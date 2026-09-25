/**
 * Generic settings merge — the `core * packsMerged * personal` step.
 *
 * Every expectation in this file was measured against the real jq operator
 * (`jq -n --argjson a A --argjson b B '$a * $b'`), not inferred from prose:
 * jq's object merge is "objects recurse; every other value — arrays, nulls,
 * scalars, numbers — takes the RIGHT-hand value".
 */

import { describe, expect, test } from "bun:test";
import { type JsonObject, type Layer, mergeLayers } from "../../../src/domain/compose/merge";

const layer = (name: string, settings: JsonObject): Layer => ({ name, settings });

describe("mergeLayers — jq `*` semantics", () => {
  test("no layers merge to an empty object", () => {
    expect(mergeLayers([])).toEqual({});
  });

  test("a single layer passes through", () => {
    expect(mergeLayers([layer("core", { cleanupPeriodDays: 30 })])).toEqual({
      cleanupPeriodDays: 30,
    });
  });

  test("objects deep-merge by key", () => {
    const merged = mergeLayers([
      layer("core", { env: { A: "1", B: "1" } }),
      layer("personal", { env: { B: "2", C: "3" } }),
    ]);
    expect(merged).toEqual({ env: { A: "1", B: "2", C: "3" } });
  });

  // jq: {"a":[1,2]} * {"a":[3]} => {"a":[3]}
  test("arrays REPLACE, they do not concatenate", () => {
    const merged = mergeLayers([
      layer("core", { hooks: { PreToolUse: ["core"] } }),
      layer("personal", { hooks: { PreToolUse: ["personal"] } }),
    ]);
    expect(merged).toEqual({ hooks: { PreToolUse: ["personal"] } });
  });

  // jq: {"a":[1]} * {"a":[]} => {"a":[]}
  test("an empty array clears the base array (no 'empty means absent' rule)", () => {
    const merged = mergeLayers([layer("core", { arr: [1, 2] }), layer("personal", { arr: [] })]);
    expect(merged).toEqual({ arr: [] });
  });

  // jq: {"a":{"b":1}} * {"a":[1]} => {"a":[1]}
  test("a type change takes the right-hand value (object -> array)", () => {
    const merged = mergeLayers([layer("core", { a: { b: 1 } }), layer("personal", { a: [1] })]);
    expect(merged).toEqual({ a: [1] });
  });

  // jq: {"a":[1]} * {"a":null} => {"a":null}
  test("null is a value: it replaces, and there is no key-deletion semantics", () => {
    expect(mergeLayers([layer("core", { a: [1] }), layer("personal", { a: null })])).toEqual({
      a: null,
    });
    expect(mergeLayers([layer("core", { a: null }), layer("personal", { a: [1] })])).toEqual({
      a: [1],
    });
  });

  // jq: {"a":2} * {"a":3} => {"a":3}  (not 6 — object merge does not multiply)
  test("numbers are right-wins, not multiplied", () => {
    const merged = mergeLayers([
      layer("core", { cleanupPeriodDays: 2 }),
      layer("personal", { cleanupPeriodDays: 3 }),
    ]);
    expect(merged).toEqual({ cleanupPeriodDays: 3 });
  });

  test("order decides: swapping the layers swaps the scalar winner", () => {
    const a = layer("a", { model: "from-a" });
    const b = layer("b", { model: "from-b" });
    expect(mergeLayers([a, b])).toEqual({ model: "from-b" });
    expect(mergeLayers([b, a])).toEqual({ model: "from-a" });
  });

  test("inputs are not mutated", () => {
    const core = { env: { A: "1" } };
    const personal = { env: { B: "2" } };
    mergeLayers([layer("core", core), layer("personal", personal)]);
    expect(core).toEqual({ env: { A: "1" } });
    expect(personal).toEqual({ env: { B: "2" } });
  });

  // jig v1 did `out[key] = value`, so a layer carrying "__proto__" both lost the
  // key and polluted Object.prototype. Fail loud instead (rebuild lesson 2).
  test("a __proto__ key is rejected, not silently dropped", () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":true}}') as JsonObject;
    expect(() => mergeLayers([layer("personal", hostile)])).toThrow(/unsafe key/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("a nested prototype/constructor key is rejected too", () => {
    const nested = JSON.parse('{"env":{"constructor":{"x":1}}}') as JsonObject;
    expect(() => mergeLayers([layer("personal", nested)])).toThrow(/unsafe key/);
  });
});
