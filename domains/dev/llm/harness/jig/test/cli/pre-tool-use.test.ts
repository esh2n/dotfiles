import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preToolUse } from "../../src/cli/hooks/pre-tool-use";
import type { Logger } from "../../src/domain/ports";
import { BunFileSystem } from "../../src/infra/fs/bun-fs";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const fs = new BunFileSystem();

const VALID_POLICY = {
  version: 1,
  rules: [
    {
      id: "git-force-push",
      tier: "deny",
      tools: ["shell"],
      match: "\\bgit\\s+push\\b[^|;&]*(--force|\\s-f\\b)",
      why: "force push is never allowed",
      profiles: ["minimal", "standard", "strict"],
    },
    {
      id: "rm-recursive-force",
      tier: "confirm",
      tools: ["shell"],
      match: "\\brm\\s+-rf\\b",
      why: "rm -rf requires confirmation",
      profiles: ["standard", "strict"],
    },
    {
      id: "sudo",
      tier: "confirm",
      tools: ["shell"],
      match: "\\bsudo\\b",
      why: "sudo requires confirmation",
      profiles: ["strict"],
    },
  ],
};

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "jig-pre-tool-use-"));
}

function writePolicy(content: unknown): string {
  const path = join(tempDir(), "guard-rules.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

async function run(stdin: string): Promise<{
  permissionDecision: string;
  permissionDecisionReason?: string;
}> {
  const out = JSON.parse(await preToolUse(stdin, { logger: silentLogger, fs })) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason?: string };
  };
  return out.hookSpecificOutput;
}

/** For the no-match path, which must emit nothing at all rather than a JSON "allow". */
async function runRaw(stdin: string): Promise<string> {
  return preToolUse(stdin, { logger: silentLogger, fs });
}

beforeEach(() => {
  process.env.JIG_POLICY_FILE = writePolicy(VALID_POLICY);
});

afterEach(() => {
  // biome-ignore lint/performance/noDelete: assigning undefined stores the string "undefined" in process.env
  delete process.env.JIG_HOOK_PROFILE;
  // biome-ignore lint/performance/noDelete: assigning undefined stores the string "undefined" in process.env
  delete process.env.YOKI_HOOK_PROFILE;
  // biome-ignore lint/performance/noDelete: assigning undefined stores the string "undefined" in process.env
  delete process.env.JIG_POLICY_FILE;
});

describe("preToolUse", () => {
  test("a non-matching call emits no output", async () => {
    // An explicit "allow" would BYPASS Claude Code's own permission system for
    // the entire call (settings.json ask/deny, interactive prompts included).
    // Silence means "no opinion" and lets that system run normally — see
    // domains/dev/config/claude-profiles/personal/hooks/git-guard.sh around
    // line 234 for the documented precedent.
    const out = await runRaw(
      JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/x" } }),
    );

    expect(out).toBe("");
  });

  test("a force push is denied with the rule's reason", async () => {
    const decision = await run(
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push --force" } }),
    );

    expect(decision.permissionDecision).toBe("deny");
    expect(decision.permissionDecisionReason).toMatch(/force push/);
  });

  test("unparseable stdin fails closed: ask, never allow", async () => {
    const decision = await run("not json at all {");

    expect(decision.permissionDecision).toBe("ask");
    expect(decision.permissionDecisionReason).toMatch(/unparseable/i);
  });

  test("valid JSON without a tool_name fails closed: ask", async () => {
    const decision = await run(JSON.stringify({ tool_input: { command: "anything" } }));

    expect(decision.permissionDecision).toBe("ask");
    expect(decision.permissionDecisionReason).toMatch(/tool_name/);
  });

  test("JIG_HOOK_PROFILE wins over the legacy YOKI_HOOK_PROFILE", async () => {
    process.env.JIG_HOOK_PROFILE = "strict";
    process.env.YOKI_HOOK_PROFILE = "minimal";

    const decision = await run(
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "sudo ls" } }),
    );

    expect(decision.permissionDecision).toBe("ask");
  });

  test("legacy YOKI_HOOK_PROFILE still applies while the fleet migrates", async () => {
    process.env.YOKI_HOOK_PROFILE = "minimal";

    const out = await runRaw(
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm -rf build" } }),
    );

    expect(out).toBe("");
  });

  test("an unknown profile value normalizes to standard, not to a wider profile", async () => {
    process.env.JIG_HOOK_PROFILE = "banana";

    const decision = await run(
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm -rf build" } }),
    );

    expect(decision.permissionDecision).toBe("ask");
  });

  test("a missing policy file fails closed: ask, naming the path", async () => {
    process.env.JIG_POLICY_FILE = join(tempDir(), "does-not-exist.json");

    const decision = await run(
      JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/x" } }),
    );

    expect(decision.permissionDecision).toBe("ask");
    expect(decision.permissionDecisionReason).toMatch(/guard policy unreadable/);
    expect(decision.permissionDecisionReason).toContain(process.env.JIG_POLICY_FILE ?? "");
  });

  test("an unparseable (non-JSON) policy file fails closed: ask", async () => {
    process.env.JIG_POLICY_FILE = writePolicy("{ not json");

    const decision = await run(
      JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/x" } }),
    );

    expect(decision.permissionDecision).toBe("ask");
    expect(decision.permissionDecisionReason).toMatch(/guard policy unreadable/);
  });

  test("a schema-invalid policy file fails closed: ask", async () => {
    process.env.JIG_POLICY_FILE = writePolicy({ version: 1, rules: [{ id: "bad" }] });

    const decision = await run(
      JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/x" } }),
    );

    expect(decision.permissionDecision).toBe("ask");
    expect(decision.permissionDecisionReason).toMatch(/guard policy unreadable/);
  });

  test("even a call that would otherwise be allowed fails closed when the policy is broken", async () => {
    process.env.JIG_POLICY_FILE = join(tempDir(), "does-not-exist.json");

    const decision = await run(
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "echo hi" } }),
    );

    expect(decision.permissionDecision).toBe("ask");
  });
});
