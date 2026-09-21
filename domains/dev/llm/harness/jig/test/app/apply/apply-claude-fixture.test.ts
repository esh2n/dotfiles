/**
 * Points `applyClaudeSettings` at the SAME checked-in synthetic fixture tree
 * `core/validation/fixtures/targets/{core,personal}` that
 * `core/validation/test-targets-golden.sh` uses for codex/omp — real
 * filesystem reads via `createNodeApplyFs`, no fakes, nothing written
 * (`write: false` throughout; `createNodeApplyFs`'s `writeAtomic` is never
 * called on this path). Used for the install-pipeline-plan.md §"How to
 * verify parity mechanically" cross-check against yoki-switch's
 * `merge_settings()` on the same fixture — see the task report, not a
 * script kept in this repo.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyClaudeSettings, type ClaudeApplyPaths } from "../../../src/app/apply/apply-claude";
import { createNodeApplyFs } from "../../../src/infra/apply/node-apply-fs";

const FIXTURES_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..", "..", "..", "..", "core", "validation", "fixtures", "targets");

describe("applyClaudeSettings against core/validation/fixtures/targets", () => {
  test("composes settings.json from the checked-in core+personal fixture, nothing enabled/written", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "jig-apply-claude-fixture-"));
    try {
      const ports = createNodeApplyFs({ stateDir, jigVersion: "0.0.0-test" });
      const paths: ClaudeApplyPaths = {
        packsFile: join(stateDir, "nonexistent-claude-packs"),
        packsDefaultFile: join(stateDir, "nonexistent-packs-default"),
        coreDir: join(FIXTURES_ROOT, "core"),
        packsDir: join(FIXTURES_ROOT, "packs"),
        personalDir: join(FIXTURES_ROOT, "personal"),
        destSettingsPath: join(stateDir, "nonexistent-settings.json"),
        templateVars: { HOME: "/home/fixture-user", DOTFILES_ROOT: "/fixture-dotfiles", USER: "fixture-user", DOTFILES_PARENT: "/" },
      };

      const result = await applyClaudeSettings(paths, ports, false);
      expect(result.target).toBe("claude");
      // No current settings.json at destSettingsPath, so a non-empty compose
      // always reports "write" (there is something to diff in).
      expect(result.outcome).toBe("write");

      const generated = JSON.parse(
        result.diff
          .split("\n")
          .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
          .map((line) => line.slice(1))
          .join("\n"),
      );

      // core/permissions.yaml + personal/permissions.yaml (see fixture files):
      // one allow, one hook-enforced deny plus two path denies, personal
      // contributes nothing extra.
      expect(generated.permissions.allow).toEqual(["Bash(git status *)"]);
      expect(generated.permissions.deny).toEqual([
        "Bash(curl * | sh)",
        "Read(~/.ssh/id_*)",
        "Edit(**/*.pem)",
      ]);
      expect(generated.permissions.defaultMode).toBe("auto");

      // hooks: personal's PreToolUse/SessionStart/Notification entries run
      // first, core's seven demo hooks come after — union of event keys,
      // sorted.
      expect(Object.keys(generated.hooks).sort()).toEqual(
        [
          "Notification",
          "PostToolUse",
          "PreCompact",
          "PreToolUse",
          "SessionEnd",
          "SessionStart",
          "Stop",
          "UserPromptSubmit",
        ].sort(),
      );
      expect(generated.hooks.PreToolUse[0].hooks[0].command).toContain("git-guard.sh");
      expect(generated.hooks.PreToolUse[generated.hooks.PreToolUse.length - 1].hooks[0].command).toContain(
        "pre-demo.js",
      );
      expect(generated.hooks.SessionStart[0].hooks[0].command).toContain("herdr-agent-state.sh");

      // No mcp.json in this fixture tree — empty layer on both sides.
      expect(generated.mcpServers).toEqual({});
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
