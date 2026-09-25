/**
 * The `hooks` rule — the one key that is re-derived instead of merged.
 *
 * Two properties that are requirements, not accidents, and that jig v1 got wrong:
 *   - the order is personal → enabled packs → core, i.e. the REVERSE of the
 *     precedence used for every other key, so personal guards run first;
 *   - it is per-EVENT-key concatenation, not concatenation of every array.
 * The event keys are sorted as well, which is observable in the emitted
 * settings.json, so the key order is pinned here too.
 */

import { describe, expect, test } from "bun:test";
import { mergeHooks } from "../../../src/domain/compose/hooks";

describe("mergeHooks", () => {
  test("no hooks anywhere yields an empty object (the key still exists)", () => {
    expect(mergeHooks({})).toEqual({});
  });

  test("events are concatenated personal -> packs -> core", () => {
    const merged = mergeHooks({
      core: { PreToolUse: ["core"] },
      packs: { PreToolUse: ["pack"] },
      personal: { PreToolUse: ["personal"] },
    });
    expect(merged).toEqual({ PreToolUse: ["personal", "pack", "core"] });
  });

  test("an event present in only one group keeps that group's entries", () => {
    expect(mergeHooks({ core: { PostToolUse: ["c"] } })).toEqual({ PostToolUse: ["c"] });
  });

  test("event keys are the union across groups, sorted", () => {
    const merged = mergeHooks({
      core: { Stop: ["c"] },
      personal: { PreToolUse: ["p"], PostToolUse: ["p"] },
    });
    expect(Object.keys(merged)).toEqual(["PostToolUse", "PreToolUse", "Stop"]);
  });

  test("a missing event in a group contributes nothing (no placeholder)", () => {
    const merged = mergeHooks({
      core: { PreToolUse: ["c1", "c2"] },
      personal: { PreToolUse: ["p1"] },
    });
    expect(merged.PreToolUse).toEqual(["p1", "c1", "c2"]);
  });

  test("order inside one event is personal first even when only core+personal exist", () => {
    const merged = mergeHooks({
      core: { UserPromptSubmit: ["core"] },
      personal: { UserPromptSubmit: ["personal"] },
    });
    expect(merged.UserPromptSubmit).toEqual(["personal", "core"]);
  });

  test("a null event is treated as no entries (jq's `// []`)", () => {
    expect(mergeHooks({ core: { Stop: null } })).toEqual({ Stop: [] });
  });

  test("an event that is not an array fails loudly instead of vanishing", () => {
    expect(() => mergeHooks({ core: { PreToolUse: { matcher: "Bash" } } })).toThrow(
      /hooks.PreToolUse must be an array/,
    );
  });
});
