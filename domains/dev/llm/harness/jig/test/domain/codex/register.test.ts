import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  JIG_BLOCK_BEGIN,
  JIG_BLOCK_END,
  canonicalIdentity,
  keyDeclaredElsewhere,
  planRegistration,
  planTrust,
  trustKey,
  trustTable,
} from "../../../src/domain/codex/register";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const INPUT = {
  command: "'/u/bun' '/u/jig.ts' hooks pre-tool-use --harness codex",
  matcher: "Bash|apply_patch|Write|Edit",
  timeoutSeconds: 10,
};

describe("canonical identity and hash", () => {
  test("reproduces a hash codex is known to trust (a live herdr entry)", () => {
    const identity = canonicalIdentity("session_start", undefined, {
      type: "command",
      command: "bash '/Users/esh2n/.codex/herdr-agent-state.sh' session",
      timeout: 10,
    });
    expect(identity).toBe(
      '{"event_name":"session_start","hooks":[{"async":false,"command":"bash \'/Users/esh2n/.codex/herdr-agent-state.sh\' session","timeout":10,"type":"command"}]}',
    );
    expect(sha256(identity)).toBe(
      "34637d171b45f4595a9a8f510e6091670f0e98e4f14c6581b6a4fd947cc49cd5",
    );
  });

  test("a matcher is part of the identity, sorted into place", () => {
    const identity = canonicalIdentity("pre_tool_use", "Bash", {
      type: "command",
      command: "x",
      timeout: 5,
    });
    expect(identity).toBe(
      '{"event_name":"pre_tool_use","hooks":[{"async":false,"command":"x","timeout":5,"type":"command"}],"matcher":"Bash"}',
    );
  });

  test("key and table shapes", () => {
    expect(trustKey("/h/hooks.json", "pre_tool_use", 0, 0)).toBe("/h/hooks.json:pre_tool_use:0:0");
    expect(trustTable("k", "abc")).toBe(
      '[hooks.state."k"]\ntrusted_hash = "sha256:abc"\nenabled = true\n',
    );
  });
});

describe("planRegistration", () => {
  test("creates the file when absent, with jig at PreToolUse[0]", () => {
    const plan = planRegistration(undefined, INPUT);
    const doc = JSON.parse(plan.hooksJson) as { hooks: { PreToolUse: unknown[] } };
    expect(doc.hooks.PreToolUse).toHaveLength(1);
    expect(plan.groupIndex).toBe(0);
    expect(plan.hooksJsonChanged).toBe(true);
  });

  test("goes in front of existing groups and keeps every other event and key", () => {
    const existing = JSON.stringify({
      version: 7,
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "orca" }] }],
        SessionStart: [{ hooks: [{ type: "command", command: "herdr" }] }],
      },
    });
    const plan = planRegistration(existing, INPUT);
    const doc = JSON.parse(plan.hooksJson) as {
      version: number;
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
    };
    expect(doc.version).toBe(7);
    expect(doc.hooks.PreToolUse?.map((g) => g.hooks[0]?.command)).toEqual([INPUT.command, "orca"]);
    expect(doc.hooks.SessionStart?.[0]?.hooks[0]?.command).toBe("herdr");
  });

  test("re-registering replaces an older jig group wherever it sat, idempotently", () => {
    const first = planRegistration(undefined, INPUT).hooksJson;
    const moved = JSON.parse(first) as { hooks: { PreToolUse: unknown[] } };
    moved.hooks.PreToolUse = [
      { hooks: [{ type: "command", command: "other" }] },
      ...moved.hooks.PreToolUse,
    ];
    const stale = JSON.stringify(moved);
    const plan = planRegistration(stale, {
      ...INPUT,
      command: "'/u/bun' '/u/jig.ts' hooks pre-tool-use --harness codex",
    });
    const doc = JSON.parse(plan.hooksJson) as {
      hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> };
    };
    expect(doc.hooks.PreToolUse.map((g) => g.hooks[0]?.command)).toEqual([INPUT.command, "other"]);
    const again = planRegistration(plan.hooksJson, INPUT);
    expect(again.hooksJsonChanged).toBe(false);
  });

  test("refuses a file that is not the wrapped shape", () => {
    expect(() => planRegistration('{"hooks": []}', INPUT)).toThrow(/must be an object/);
    expect(() => planRegistration('{"hooks": {"PreToolUse": {}}}', INPUT)).toThrow(
      /must be an array/,
    );
  });
});

describe("planTrust", () => {
  const table = trustTable("/h/hooks.json:pre_tool_use:0:0", "abc");

  test("appends a jig block after everything else", () => {
    const before = "# yoki:begin\n[features]\nhooks = true\n# yoki:end\n";
    const plan = planTrust(before, [table]);
    expect(plan.changed).toBe(true);
    expect(plan.configToml).toBe(
      `# yoki:begin\n[features]\nhooks = true\n# yoki:end\n\n${JIG_BLOCK_BEGIN}\n${table}${JIG_BLOCK_END}\n`,
    );
  });

  test("replaces a previous jig block wholesale, leaving the rest byte for byte", () => {
    const stale = `a = 1\n\n${JIG_BLOCK_BEGIN}\n${trustTable("/h/hooks.json:pre_tool_use:12:0", "old")}${JIG_BLOCK_END}\n`;
    const plan = planTrust(stale, [table]);
    expect(plan.configToml).toBe(`a = 1\n\n${JIG_BLOCK_BEGIN}\n${table}${JIG_BLOCK_END}\n`);
    expect(plan.configToml).not.toContain("12:0");
    expect(planTrust(plan.configToml, [table]).changed).toBe(false);
  });

  test("an unterminated block is an error, not a guess", () => {
    expect(() => planTrust(`${JIG_BLOCK_BEGIN}\nx = 1\n`, [table])).toThrow(/without/);
  });

  test("a key declared outside jig's block is detected", () => {
    const text = `[hooks.state."/h/hooks.json:pre_tool_use:0:0"]\ntrusted_hash = "sha256:x"\n`;
    expect(keyDeclaredElsewhere(text, "/h/hooks.json:pre_tool_use:0:0")).toBe(true);
    expect(
      keyDeclaredElsewhere(planTrust("", [table]).configToml, "/h/hooks.json:pre_tool_use:0:0"),
    ).toBe(false);
  });
});
