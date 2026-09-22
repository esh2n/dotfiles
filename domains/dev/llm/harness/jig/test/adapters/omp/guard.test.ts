import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardToolCall } from "../../../adapters/omp/src/guard";
import type { OmpContext } from "../../../adapters/omp/src/omp";
import type { AuditEntry } from "../../../src/domain/policy/audit";

const POLICY = {
  version: 1,
  floor: [
    {
      id: "floor-shell-rc-edit",
      action: "fs.edit",
      subject: { path: "(^|/)\\.zshrc$" },
      why: "a shell rc runs on the next shell",
    },
  ],
  rules: [
    {
      id: "forbid-rm-rf",
      effect: "forbid",
      action: "shell.exec",
      subject: { program: "rm", argv: "(^|\\s)-[a-zA-Z]*(r[a-zA-Z]*f|f[a-zA-Z]*r)\\b" },
      why: "recursive force delete",
      profiles: ["minimal", "standard", "strict"],
    },
    {
      id: "ask-sudo",
      effect: "ask",
      action: "shell.exec",
      subject: { program: "sudo" },
      why: "privilege escalation",
      profiles: ["standard", "strict"],
    },
    {
      id: "forbid-mcp-delete",
      effect: "forbid",
      action: "mcp.call",
      subject: { program: "github", argv: "^delete_" },
      why: "no deletes via mcp",
      profiles: ["minimal", "standard", "strict"],
    },
    {
      id: "ask-secret-read",
      effect: "ask",
      action: "fs.read",
      subject: { path: "(^|/)\\.env$" },
      why: "reads a secret file",
      profiles: ["standard", "strict"],
    },
  ],
};

const dirs: string[] = [];
function policyFile(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "jig-omp-guard-"));
  dirs.push(dir);
  const path = join(dir, "guard-rules.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

class FakeAudit {
  readonly entries: AuditEntry[] = [];
  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

function ctx(overrides: Partial<OmpContext> = {}): OmpContext {
  return {
    cwd: "/work",
    hasUI: false,
    sessionManager: { getSessionId: () => "omp-session-1" },
    model: { id: "anthropic/claude-opus-5" },
    ...overrides,
  };
}

const env = (policy: string): NodeJS.ProcessEnv => ({ JIG_POLICY_FILE: policy });

describe("guardToolCall", () => {
  test("an allowed call gets silence, never an explicit allow", async () => {
    const out = await guardToolCall({ toolName: "bash", input: { command: "git status" } }, ctx(), {
      audit: new FakeAudit(),
      env: env(policyFile(POLICY)),
    });
    expect(out).toBeUndefined();
  });

  test("a forbidden command is blocked with the rule's reason", async () => {
    const out = await guardToolCall(
      { toolName: "bash", input: { command: "rm -rf /tmp/x" } },
      ctx(),
      { audit: new FakeAudit(), env: env(policyFile(POLICY)) },
    );
    expect(out?.block).toBe(true);
    expect(out?.reason).toContain("recursive force delete");
  });

  test("eval closes the bash.patterns hole: the same command is judged in a cell", async () => {
    const policy = env(policyFile(POLICY));
    const audit = new FakeAudit();
    const out = await guardToolCall(
      { toolName: "eval", input: { language: "py", code: 'os.system("rm -rf /tmp/x")' } },
      ctx(),
      { audit, env: policy },
    );
    expect(out?.block).toBe(true);
    expect(out?.reason).toContain("recursive force delete");
    // The audit lines say which tool asked, so the cell is not filed as bash.
    expect(audit.entries.every((entry) => entry.tool === "eval")).toBe(true);
    expect(audit.entries.some((entry) => entry.decision === "deny")).toBe(true);
  });

  test("an omp MCP name reaches an mcp.call rule despite the single underscore", async () => {
    const policy = env(policyFile(POLICY));
    const out = await guardToolCall(
      { toolName: "mcp__github_delete_repository", input: { name: "x" } },
      ctx(),
      { audit: new FakeAudit(), env: policy },
    );
    expect(out?.reason).toContain("no deletes via mcp");
    const benign = await guardToolCall(
      { toolName: "mcp__github_get_issue", input: { id: 1 } },
      ctx(),
      { audit: new FakeAudit(), env: policy },
    );
    expect(benign).toBeUndefined();
  });

  test("a hashline edit is judged per file, so the fs floor still holds", async () => {
    const policy = env(policyFile(POLICY));
    const audit = new FakeAudit();
    const out = await guardToolCall(
      {
        toolName: "edit",
        input: { input: "[src/a.ts#1A2B]\nPUT >$:\n+x\n[/Users/x/.zshrc#00FF]\nPUT >$:\n+evil" },
      },
      ctx(),
      { audit, env: policy },
    );
    expect(out?.block).toBe(true);
    expect(out?.reason).toContain("shell rc");
    // Both files are judged, and both are on the record.
    expect(audit.entries).toHaveLength(2);
  });

  test("an edit whose payload cannot be read blocks rather than passing", async () => {
    const out = await guardToolCall({ toolName: "edit", input: { input: "???" } }, ctx(), {
      audit: new FakeAudit(),
      env: env(policyFile(POLICY)),
    });
    expect(out?.block).toBe(true);
    expect(out?.reason).toContain("could not be read");
  });

  test("ask with no screen is a block, never a silent allow", async () => {
    const out = await guardToolCall({ toolName: "bash", input: { command: "sudo ls" } }, ctx(), {
      audit: new FakeAudit(),
      env: env(policyFile(POLICY)),
    });
    expect(out?.block).toBe(true);
    expect(out?.reason).toContain("no screen to ask on");
  });

  test("ask with a screen goes to omp's confirm dialog, and the answer decides", async () => {
    const policy = env(policyFile(POLICY));
    const asked: string[] = [];
    const yes = await guardToolCall(
      { toolName: "bash", input: { command: "sudo ls" } },
      ctx({
        hasUI: true,
        ui: {
          confirm: async (title: string) => {
            asked.push(title);
            return true;
          },
        },
      }),
      { audit: new FakeAudit(), env: policy },
    );
    expect(yes).toBeUndefined();
    expect(asked[0]).toContain("privilege escalation");

    const no = await guardToolCall(
      { toolName: "read", input: { path: "/repo/.env" } },
      ctx({ hasUI: true, ui: { confirm: async () => false } }),
      { audit: new FakeAudit(), env: policy },
    );
    expect(no?.block).toBe(true);
    expect(no?.reason).toContain("reads a secret file");
  });

  test("a confirm that throws is a no", async () => {
    const out = await guardToolCall(
      { toolName: "bash", input: { command: "sudo ls" } },
      ctx({
        hasUI: true,
        ui: {
          confirm: () => {
            throw new Error("no terminal");
          },
        },
      }),
      { audit: new FakeAudit(), env: env(policyFile(POLICY)) },
    );
    expect(out?.block).toBe(true);
  });

  test("an unreadable policy blocks everything with a reason that says what to fix", async () => {
    const out = await guardToolCall({ toolName: "bash", input: { command: "ls" } }, ctx(), {
      audit: new FakeAudit(),
      env: { JIG_POLICY_FILE: join(tmpdir(), "jig-omp-missing.json") },
    });
    expect(out?.block).toBe(true);
    expect(out?.reason).toContain("policy unreadable");
  });

  test("a guard that overruns its budget blocks instead of hanging omp", async () => {
    const out = await guardToolCall({ toolName: "bash", input: { command: "ls" } }, ctx(), {
      audit: { append: () => new Promise<void>(() => {}) },
      env: env(policyFile(POLICY)),
      budgetMs: 20,
    });
    expect(out?.block).toBe(true);
    expect(out?.reason).toContain("exceeded 20ms");
  });

  test("the audit line says omp, which session, where, on what model, and which call", async () => {
    const audit = new FakeAudit();
    await guardToolCall(
      { toolName: "bash", input: { command: "git status" }, toolCallId: "call_7" },
      ctx(),
      { audit, env: env(policyFile(POLICY)) },
    );
    expect(audit.entries[0]).toMatchObject({
      principal: {
        harness: "omp",
        profile: "standard",
        sessionId: "omp-session-1",
        cwd: "/work",
        model: "anthropic/claude-opus-5",
        callId: "call_7",
      },
      tool: "bash",
      decision: "allow",
    });
  });

  test("a bare string model is unwrapped the same way", async () => {
    const audit = new FakeAudit();
    await guardToolCall(
      { toolName: "bash", input: { command: "git status" } },
      ctx({ model: "gpt-6-astra" }),
      { audit, env: env(policyFile(POLICY)) },
    );
    expect(audit.entries[0]?.principal).toMatchObject({ model: "gpt-6-astra" });
  });

  test("a tool the policy does not speak about is left alone", async () => {
    const audit = new FakeAudit();
    const out = await guardToolCall({ toolName: "grep", input: { pattern: "x" } }, ctx(), {
      audit,
      env: env(policyFile(POLICY)),
    });
    expect(out).toBeUndefined();
    expect(audit.entries).toHaveLength(0);
  });
});
