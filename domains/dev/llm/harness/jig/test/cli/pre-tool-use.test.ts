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
const clock = { now: () => new Date("2026-09-21T00:00:00Z") };
const ports = { logger: silentLogger, fs, clock };

const VALID_POLICY = {
  version: 1,
  rules: [
    {
      id: "git-force-push",
      effect: "forbid",
      action: "shell.exec",
      subject: { program: "git", argv: "push\\b.*(--force|(^|\\s)-f\\b)" },
      why: "force push is never allowed",
      profiles: ["minimal", "standard", "strict"],
    },
    {
      id: "rm-recursive-force",
      effect: "ask",
      action: "shell.exec",
      subject: { program: "rm", argv: "(^|\\s)-[a-zA-Z]*(r[a-zA-Z]*f|f[a-zA-Z]*r)\\b" },
      why: "rm -rf requires confirmation",
      profiles: ["standard", "strict"],
    },
    {
      id: "sudo",
      effect: "ask",
      action: "shell.exec",
      subject: { program: "sudo" },
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
  const out = JSON.parse(await preToolUse(stdin, ports)) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason?: string };
  };
  return out.hookSpecificOutput;
}

/** For the no-match path, which must emit nothing at all rather than a JSON "allow". */
async function runRaw(stdin: string): Promise<string> {
  return preToolUse(stdin, ports);
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

describe("preToolUse with a v2 policy", () => {
  const V2_POLICY = {
    version: 1,
    floor: [
      {
        id: "floor-mkfs",
        action: "shell.exec",
        subject: { program: "mkfs(\\..+)?" },
        why: "formats a disk",
      },
    ],
    rules: [
      {
        id: "ask-sudo-dsh",
        effect: "ask",
        action: "shell.exec",
        subject: { program: "sudo" },
        why: "sudo on dsh asks",
        profiles: ["standard", "strict"],
        principals: ["dsh"],
      },
      {
        id: "forbid-rm-rf",
        effect: "forbid",
        action: "shell.exec",
        subject: { program: "rm", argv: "(^|\\s)-[a-zA-Z]*(r[a-zA-Z]*f|f[a-zA-Z]*r)\\b" },
        why: "recursive force delete",
        profiles: ["minimal", "standard", "strict"],
      },
    ],
  };

  beforeEach(() => {
    process.env.JIG_POLICY_FILE = writePolicy(V2_POLICY);
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: assigning undefined stores the string "undefined" in process.env
    delete process.env.JIG_HARNESS;
  });

  test("grep for 'rm -rf' is no longer a false positive", async () => {
    const out = await runRaw(
      JSON.stringify({ tool_name: "Bash", tool_input: { command: 'grep "rm -rf" notes.md' } }),
    );
    expect(out).toBe("");
  });

  test("sudo rm -rf is denied through the wrapper", async () => {
    const decision = await run(
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "sudo rm -rf /tmp/x" } }),
    );
    expect(decision.permissionDecision).toBe("deny");
    expect(decision.permissionDecisionReason).toBe("recursive force delete");
  });

  test("the harness is stamped from the option, else the environment, else claude", async () => {
    const stdin = JSON.stringify({ tool_name: "Bash", tool_input: { command: "sudo ls" } });
    // Default principal is claude: the dsh-only rule stays silent.
    expect(await preToolUse(stdin, ports)).toBe("");
    // `--harness dsh` (the option) activates it.
    const viaOption = JSON.parse(await preToolUse(stdin, ports, { harness: "dsh" })) as {
      hookSpecificOutput: { permissionDecision: string };
    };
    expect(viaOption.hookSpecificOutput.permissionDecision).toBe("ask");
    // JIG_HARNESS (the environment) does too.
    process.env.JIG_HARNESS = "dsh";
    const viaEnv = JSON.parse(await preToolUse(stdin, ports)) as {
      hookSpecificOutput: { permissionDecision: string };
    };
    expect(viaEnv.hookSpecificOutput.permissionDecision).toBe("ask");
  });

  test("the floor holds for every harness", async () => {
    const stdin = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "mkfs.ext4 /dev/sda1" },
    });
    for (const harness of ["claude", "pi", "dsh", "codex"]) {
      const out = JSON.parse(await preToolUse(stdin, ports, { harness })) as {
        hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
      };
      expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(out.hookSpecificOutput.permissionDecisionReason).toBe("formats a disk");
    }
  });

  test("every judgment is appended to the audit log with principal and policy hash", async () => {
    const entries: unknown[] = [];
    const audit = { append: async (entry: unknown) => void entries.push(entry) };
    const stdin = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: "sudo rm -rf /tmp/x" },
      session_id: "s-1",
      cwd: "/work",
      permission_mode: "default",
      tool_use_id: "toolu_abc123",
    });
    await preToolUse(stdin, { ...ports, audit }, { harness: "dsh" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      ts: "2026-09-21T00:00:00.000Z",
      principal: {
        harness: "dsh",
        profile: "standard",
        sessionId: "s-1",
        cwd: "/work",
        permissionMode: "default",
        callId: "toolu_abc123",
      },
      tool: "Bash",
      action: "shell.exec",
      decision: "deny",
      rule: "forbid-rm-rf",
      source: "rule",
      extraction: { kind: "resolved" },
    });
    const policy = (entries[0] as { policy: { version: number; hash: string } }).policy;
    expect(policy.version).toBe(1);
    expect(policy.hash).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("preToolUse for codex", () => {
  beforeEach(() => {
    process.env.JIG_POLICY_FILE = writePolicy(VALID_POLICY);
  });

  test("an ask degrades to a deny with a reason, never to an allow", async () => {
    const stdin = JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm -rf /tmp/x" } });
    const out = JSON.parse(await preToolUse(stdin, ports, { harness: "codex" })) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain(
      "rm -rf requires confirmation",
    );
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("cannot ask");
  });

  test("claude and dsh keep the ask", async () => {
    const stdin = JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm -rf /tmp/x" } });
    for (const harness of ["claude", "dsh"]) {
      const out = JSON.parse(await preToolUse(stdin, ports, { harness })) as {
        hookSpecificOutput: { permissionDecision: string };
      };
      expect(out.hookSpecificOutput.permissionDecision).toBe("ask");
    }
  });

  test("apply_patch is judged per file", async () => {
    process.env.JIG_POLICY_FILE = writePolicy({
      version: 1,
      floor: [
        { id: "f", action: "fs.write", subject: { path: "(^|/)\\.git/hooks/" }, why: "git hooks" },
      ],
      rules: [],
    });
    const patch = "*** Begin Patch\n*** Add File: .git/hooks/pre-commit\n+exit 0\n*** End Patch";
    const stdin = JSON.stringify({ tool_name: "apply_patch", tool_input: { command: patch } });
    const out = JSON.parse(await preToolUse(stdin, ports, { harness: "codex" })) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe("git hooks");
  });
});
