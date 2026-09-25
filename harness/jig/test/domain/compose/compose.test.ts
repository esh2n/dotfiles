/**
 * The full settings-compose pipeline, one test per clause of the merge
 * specification. Rows marked [jq-verified] were measured against the real jq `*`
 * operator; rows marked [v1-wrong] are the behaviour jig v1 got backwards and that
 * this rebuild must pin down.
 */

import { describe, expect, test } from "bun:test";
import { composeSettings } from "../../../src/domain/compose/compose";

const perm = { allow: ["Bash(git status:*)"], deny: ["Bash(rm -rf:*)"], defaultMode: "auto" };
const noMcp = {};

const base = (over: Partial<Parameters<typeof composeSettings>[0]> = {}) => ({
  core: {},
  packs: [],
  permissions: perm,
  mcpServers: noMcp,
  ...over,
});

describe("composeSettings — the layer merge", () => {
  test("[jq-verified] ordinary keys deep-merge, arrays replace", () => {
    const out = composeSettings(
      base({
        core: { statusLine: { type: "command", padding: 1 }, other: ["core"] },
        personal: { statusLine: { padding: 2 }, other: ["personal"] },
      }),
    );
    expect(out.statusLine).toEqual({ type: "command", padding: 2 });
    expect(out.other).toEqual(["personal"]);
  });

  test("packs sit between core and personal, and are merged among themselves with the same generic rule", () => {
    const out = composeSettings(
      base({
        core: { model: "core" },
        packs: [
          { name: "pack1", settings: { model: "pack1", cleanupPeriodDays: 1 } },
          { name: "pack2", settings: { cleanupPeriodDays: 2 } },
        ],
        personal: { theme: "personal" },
      }),
    );
    expect(out.model).toBe("pack1");
    expect(out.cleanupPeriodDays).toBe(2);
    expect(out.theme).toBe("personal");
  });
});

describe("composeSettings — the six re-derived keys", () => {
  test("[v1-wrong] env is a SHALLOW merge: a nested value is replaced whole, not deep-merged", () => {
    const out = composeSettings(
      base({
        core: { env: { NESTED: { a: 1, b: 2 }, KEEP: "core" } },
        personal: { env: { NESTED: { a: 9 } } },
      }),
    );
    expect(out.env).toEqual({ NESTED: { a: 9 }, KEEP: "core" });
  });

  test("[v1-wrong] enabledPlugins is a shallow merge, later group wins per key", () => {
    const out = composeSettings(
      base({
        core: { enabledPlugins: { "a@m": true, "b@m": true } },
        personal: { enabledPlugins: { "b@m": false } },
      }),
    );
    expect(out.enabledPlugins).toEqual({ "a@m": true, "b@m": false });
  });

  test("[v1-wrong] extraKnownMarketplaces is shallow: an entry is replaced whole, losing sibling fields", () => {
    const out = composeSettings(
      base({
        packs: [
          {
            name: "pack-a",
            settings: {
              extraKnownMarketplaces: {
                official: { source: { source: "github", repo: "a/b" }, autoUpdate: true },
              },
            },
          },
        ],
        personal: { extraKnownMarketplaces: { official: { source: { source: "git", url: "x" } } } },
      }),
    );
    expect(out.extraKnownMarketplaces).toEqual({
      official: { source: { source: "git", url: "x" } },
    });
  });

  test("[jq-verified] permissions come from the compiled sidecar, not from the layers", () => {
    const out = composeSettings(
      base({ personal: { permissions: { allow: ["legacy"], defaultMode: "plan" } } }),
    );
    expect(out.permissions).toEqual({
      allow: perm.allow,
      deny: perm.deny,
      defaultMode: "auto",
    });
  });

  test("[jq-verified] permission keys other than allow/deny/defaultMode survive", () => {
    const out = composeSettings(
      base({ personal: { permissions: { additionalDirectories: ["/tmp"] } } }),
    );
    expect(out.permissions).toEqual({
      additionalDirectories: ["/tmp"],
      allow: perm.allow,
      deny: perm.deny,
      defaultMode: "auto",
    });
  });

  test("mcpServers is replaced by the compiled sidecar", () => {
    const out = composeSettings(
      base({
        personal: { mcpServers: { legacy: { command: "old" } } },
        mcpServers: { ctx7: { command: "npx", args: ["-y", "ctx7"] } },
      }),
    );
    expect(out.mcpServers).toEqual({ ctx7: { command: "npx", args: ["-y", "ctx7"] } });
  });

  test("hooks always exist, even when no layer declares any", () => {
    expect(composeSettings(base()).hooks).toEqual({});
  });

  test("[v1-wrong] hooks concatenate personal -> packs -> core per event", () => {
    const out = composeSettings(
      base({
        core: { hooks: { PreToolUse: ["core"] } },
        packs: [{ name: "p1", settings: { hooks: { PreToolUse: ["pack"] } } }],
        personal: { hooks: { PreToolUse: ["personal"] } },
      }),
    );
    expect(out.hooks).toEqual({ PreToolUse: ["personal", "pack", "core"] });
  });

  test("when two enabled packs declare the same event, the later pack wins (packs are merged with `*` first)", () => {
    const out = composeSettings(
      base({
        packs: [
          { name: "p1", settings: { hooks: { PostToolUse: ["pack1"] } } },
          { name: "p2", settings: { hooks: { PostToolUse: ["pack2"], Stop: ["pack2"] } } },
        ],
      }),
    );
    expect(out.hooks).toEqual({ PostToolUse: ["pack2"], Stop: ["pack2"] });
  });

  test("the packs' own env deep-merges among packs, then shallow-merges against core and personal", () => {
    const out = composeSettings(
      base({
        core: { env: { A: "core", CORE_ONLY: "1" } },
        packs: [
          { name: "p1", settings: { env: { A: "pack1", B: "1" } } },
          { name: "p2", settings: { env: { B: "2" } } },
        ],
        personal: { env: { Z: "personal" } },
      }),
    );
    expect(out.env).toEqual({ A: "pack1", CORE_ONLY: "1", B: "2", Z: "personal" });
  });

  test("the generic merge still applies to the keys the jq program re-derives from", () => {
    const out = composeSettings(
      base({
        core: { env: { A: "1" } },
        personal: { model: "from-personal" },
      }),
    );
    expect(out.env).toEqual({ A: "1" });
    expect(out.model).toBe("from-personal");
  });
});
