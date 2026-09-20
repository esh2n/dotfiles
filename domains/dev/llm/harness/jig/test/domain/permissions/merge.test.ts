/**
 * Port of yoki's runtime/yoki/scripts/lib/permissions/test/parse.test.js —
 * the dedupe/mergeLayers half (tests tagged [yoki-verified]).
 */

import { describe, expect, test } from "bun:test";
import {
  dedupeEntries,
  dedupeGuardFloor,
  mergePermissionLayers,
} from "../../../src/domain/permissions/merge";
import type { PermissionLayer } from "../../../src/domain/permissions/types";

describe("dedupeEntries", () => {
  test("[yoki-verified] dedupes by pattern, keeps first occurrence order", () => {
    const entries = [{ pattern: "A" }, { pattern: "B" }, { pattern: "A", reason: "later reason" }];
    expect(dedupeEntries(entries)).toEqual([
      { pattern: "A", reason: "later reason" },
      { pattern: "B" },
    ]);
  });

  test("[yoki-verified] an earlier reason is never overwritten by a later one", () => {
    const entries = [
      { pattern: "A", reason: "first" },
      { pattern: "A", reason: "second" },
    ];
    expect(dedupeEntries(entries)).toEqual([{ pattern: "A", reason: "first" }]);
  });

  test("[yoki-verified] enforce arrays union across duplicate patterns", () => {
    const entries = [
      { pattern: "A", enforce: ["hook"] },
      { pattern: "A", enforce: ["codex-only"] },
    ];
    const result = dedupeEntries(entries);
    expect(result.length).toBe(1);
    expect(new Set(result[0]?.enforce)).toEqual(new Set(["hook", "codex-only"]));
  });
});

describe("dedupeGuardFloor", () => {
  test("[yoki-verified] dedupes the whole hook+event+matcher triple, not the hook alone", () => {
    const entries = [
      { hook: "git-guard.sh", event: "PreToolUse", matcher: "Bash" },
      { hook: "git-guard.sh", event: "PreToolUse", matcher: "Bash" },
      { hook: "git-guard.sh", event: "PreToolUse", matcher: "Write|Edit" },
    ];
    expect(dedupeGuardFloor(entries)).toEqual([
      { hook: "git-guard.sh", event: "PreToolUse", matcher: "Bash" },
      { hook: "git-guard.sh", event: "PreToolUse", matcher: "Write|Edit" },
    ]);
  });
});

const layer = (over: Partial<PermissionLayer> = {}): PermissionLayer => ({
  allow: [],
  deny: [],
  guardFloor: [],
  ...over,
});

describe("mergePermissionLayers", () => {
  test("[yoki-verified] unions allow/deny across layers in priority order", () => {
    const core = layer({
      allow: [{ pattern: "A" }],
      deny: [{ pattern: "D1" }],
      defaultMode: "auto",
    });
    const personal = layer({
      allow: [{ pattern: "B" }],
      deny: [{ pattern: "D2" }],
      defaultMode: "auto",
    });
    const merged = mergePermissionLayers([core, personal]);
    expect(merged.allow.map((e) => e.pattern)).toEqual(["A", "B"]);
    expect(merged.deny.map((e) => e.pattern)).toEqual(["D1", "D2"]);
    expect(merged.defaultMode).toBe("auto");
  });

  test("[yoki-verified] a later layer wins defaultMode", () => {
    const core = layer({ defaultMode: "auto" });
    const personal = layer({ defaultMode: "default" });
    expect(mergePermissionLayers([core, personal]).defaultMode).toBe("default");
  });

  test("[yoki-verified] defaults to auto when no layer sets defaultMode", () => {
    expect(mergePermissionLayers([layer()]).defaultMode).toBe("auto");
  });

  test("[yoki-verified] a later layer may ADD to the guard floor and can never subtract", () => {
    const core = layer({
      guardFloor: [{ hook: "git-guard.sh", event: "PreToolUse", matcher: "Bash" }],
    });
    const personal = layer({
      guardFloor: [{ hook: "secrets-guard.sh", event: "PreToolUse", matcher: "Bash" }],
    });
    const merged = mergePermissionLayers([core, personal]);
    expect(merged.guardFloor.map((e) => e.hook)).toEqual(["git-guard.sh", "secrets-guard.sh"]);

    const withEmptyPersonal = mergePermissionLayers([core, layer()]);
    expect(withEmptyPersonal.guardFloor.map((e) => e.hook)).toEqual(["git-guard.sh"]);
  });

  test("packs sit between core and personal in the layer order (caller's responsibility, verified here as a 3-layer merge)", () => {
    const core = layer({ allow: [{ pattern: "core" }] });
    const pack = layer({ allow: [{ pattern: "pack" }] });
    const personal = layer({ allow: [{ pattern: "personal" }] });
    expect(mergePermissionLayers([core, pack, personal]).allow.map((e) => e.pattern)).toEqual([
      "core",
      "pack",
      "personal",
    ]);
  });
});
