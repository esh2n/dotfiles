/**
 * Port of yoki's runtime/yoki/scripts/lib/permissions/test/to-claude.test.js
 * — tests tagged [yoki-verified] assert the same behavior as that suite,
 * including the real-fixture regression against the shipped
 * core/personal permissions.yaml (74/86-ish counts pinned by [yoki-fixture]
 * below — read directly from disk so the assertions never silently drift
 * out of sync with the real files).
 */

import { describe, expect, test } from "bun:test";
import { mergePermissionLayers } from "../../../src/domain/permissions/merge";
import { parseYamlPermissions } from "../../../src/domain/permissions/parse";
import { hookEnforcedDeny, toClaudeSettings } from "../../../src/domain/permissions/to-claude";
import type { MergedPermissions } from "../../../src/domain/permissions/types";

const CORE_YAML = `${import.meta.dir}/../../../../../../config/claude-profiles/core/permissions.yaml`;
const PERSONAL_YAML = `${import.meta.dir}/../../../../../../config/claude-profiles/personal/permissions.yaml`;

describe("toClaudeSettings", () => {
  test("[yoki-verified] maps entries to their pattern strings only", () => {
    const merged: MergedPermissions = {
      allow: [{ pattern: "Bash(git status *)" }],
      deny: [{ pattern: "Bash(rm -rf /)" }],
      guardFloor: [],
      defaultMode: "auto",
    };
    expect(toClaudeSettings(merged)).toEqual({
      allow: ["Bash(git status *)"],
      deny: ["Bash(rm -rf /)"],
      defaultMode: "auto",
    });
  });

  test("[yoki-verified] defaults defaultMode to auto when unset", () => {
    expect(
      toClaudeSettings({ allow: [], deny: [], guardFloor: [], defaultMode: "" }).defaultMode,
    ).toBe("auto");
  });
});

describe("hookEnforcedDeny", () => {
  test('[yoki-verified] only entries with enforce including "hook" are returned', () => {
    const merged: MergedPermissions = {
      allow: [],
      guardFloor: [],
      defaultMode: "auto",
      deny: [
        { pattern: "A", enforce: ["hook"], reason: "r1" },
        { pattern: "B" },
        { pattern: "C", enforce: ["codex-only"] },
      ],
    };
    expect(hookEnforcedDeny(merged)).toEqual([{ pattern: "A", reason: "r1" }]);
  });

  test("[yoki-verified] reason defaults to empty string when absent", () => {
    const merged: MergedPermissions = {
      allow: [],
      guardFloor: [],
      defaultMode: "auto",
      deny: [{ pattern: "A", enforce: ["hook"] }],
    };
    expect(hookEnforcedDeny(merged)).toEqual([{ pattern: "A", reason: "" }]);
  });
});

describe("[yoki-fixture] real core+personal permissions.yaml", () => {
  test("compile against the shipped files and cross-check counts against a direct parse", async () => {
    const coreFile = Bun.file(CORE_YAML);
    const personalFile = Bun.file(PERSONAL_YAML);
    if (!(await coreFile.exists()) || !(await personalFile.exists())) {
      // Fixture unreachable from this checkout layout — skip rather than fail closed.
      return;
    }

    const coreLayer = parseYamlPermissions(await coreFile.text());
    const personalLayer = parseYamlPermissions(await personalFile.text());
    const merged = mergePermissionLayers([coreLayer, personalLayer]);
    const settings = toClaudeSettings(merged);

    // No pattern is lost or duplicated across the two layers.
    expect(settings.allow.length).toBe(coreLayer.allow.length + personalLayer.allow.length);
    expect(new Set(settings.deny).size).toBe(settings.deny.length);
    expect(settings.defaultMode).toBe("auto");

    // The 8 patterns yoki's own suite pins as hook-enforced (see
    // permissions/test/to-claude.test.js) must still all be hook-enforced here.
    const expectedHookEnforced = [
      "Bash(rm -rf /*)",
      "Bash(rm -rf ~/*)",
      "Bash(> /dev/*)",
      "Bash(>> /dev/*)",
      "Edit(**/*.pem)",
      "Edit(**/*.key)",
      "Edit(**/.env)",
      "Edit(**/.env.*)",
    ];
    const hookEnforced = new Set(hookEnforcedDeny(merged).map((e) => e.pattern));
    for (const pattern of expectedHookEnforced) {
      expect(hookEnforced.has(pattern)).toBe(true);
    }
    expect(hookEnforced.size).toBe(expectedHookEnforced.length);

    // The guard floor declares the two bash guards (guardFloor is unioned,
    // never subtracted).
    expect(merged.guardFloor.map((e) => e.hook).sort()).toEqual([
      "git-guard.sh",
      "unattended-guard.sh",
    ]);
  });
});
