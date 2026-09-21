import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DshPreToolDecision,
  type DshToolExecution,
  guardExecution,
  inject,
  name,
} from "../../../adapters/dsh/src/index";
import type { AuditEntry } from "../../../src/domain/policy/audit";

const POLICY = {
  version: 2,
  floor: [
    {
      id: "floor-git-hooks-write",
      action: "fs.write",
      subject: { path: "(^|/)\\.git/hooks/" },
      why: "git hooks run on the next commit",
    },
    {
      id: "floor-git-hooks-edit",
      action: "fs.edit",
      subject: { path: "(^|/)\\.git/hooks/" },
      why: "git hooks run on the next commit",
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
  ],
};

const dirs: string[] = [];
function policyFile(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "jig-dsh-guard-"));
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

const allow = async (): Promise<DshPreToolDecision> => ({ kind: "allow" });
const exec = (
  tool: string,
  args: unknown,
  agent?: DshToolExecution["agent"],
): DshToolExecution => ({ name: tool, arguments: args, ...(agent ? { agent } : {}) });
const agent = (id: string, cwd: string, parent?: string): DshToolExecution["agent"] => ({
  session: { header: { id, cwd } },
  ...(parent ? { meta: { origin: "subagent" as const, parentSession: parent } } : {}),
});

describe("jig-guard plugin identity", () => {
  test("declares itself and needs the tool runtime", () => {
    expect(name).toBe("jig-guard");
    expect(inject).toEqual(["tools"]);
  });
});

describe("guardExecution", () => {
  test("allow lets dsh continue down the waterfall", async () => {
    const env = { JIG_POLICY_FILE: policyFile(POLICY) };
    let reached = false;
    const out = await guardExecution(
      exec("bash", { command: "git status" }),
      async () => {
        reached = true;
        return { kind: "allow" };
      },
      { audit: new FakeAudit(), env },
    );
    expect(out).toEqual({ kind: "allow" });
    expect(reached).toBe(true);
  });

  test("deny carries the rule's reason and never calls next", async () => {
    const env = { JIG_POLICY_FILE: policyFile(POLICY) };
    let reached = false;
    const out = await guardExecution(
      exec("bash", { command: "sudo rm -rf /tmp/x" }),
      async () => {
        reached = true;
        return { kind: "allow" };
      },
      { audit: new FakeAudit(), env },
    );
    expect(out).toEqual({ kind: "deny", reason: "recursive force delete" });
    expect(reached).toBe(false);
  });

  test("ask is handed to dsh's approval as ask, never turned into allow", async () => {
    const env = { JIG_POLICY_FILE: policyFile(POLICY) };
    const out = await guardExecution(exec("bash", { command: "sudo ls" }), allow, {
      audit: new FakeAudit(),
      env,
    });
    expect(out).toEqual({ kind: "ask", reason: "privilege escalation" });
  });

  test("str_replace_editor's path and MCP tool names reach the policy", async () => {
    const env = { JIG_POLICY_FILE: policyFile(POLICY) };
    const hook = await guardExecution(
      exec("str_replace_editor", { path: "/repo/.git/hooks/pre-commit", old_str: "", new_str: "" }),
      allow,
      { audit: new FakeAudit(), env },
    );
    expect(hook.kind).toBe("deny");
    const mcp = await guardExecution(exec("mcp__github__delete_repository", { name: "x" }), allow, {
      audit: new FakeAudit(),
      env,
    });
    expect(mcp).toEqual({ kind: "deny", reason: "no deletes via mcp" });
    expect(
      (
        await guardExecution(exec("mcp__github__get_issue", { id: 1 }), allow, {
          audit: new FakeAudit(),
          env,
        })
      ).kind,
    ).toBe("allow");
  });

  test("the audit line says dsh, which session, where, and whether a subagent asked", async () => {
    const env = { JIG_POLICY_FILE: policyFile(POLICY), DSH_PERMISSION_MODE: "workspace-write" };
    const audit = new FakeAudit();
    await guardExecution(
      exec("bash", { command: "git status" }, agent("s-child", "/work", "s-parent")),
      allow,
      { audit, env },
    );
    expect(audit.entries[0]).toMatchObject({
      principal: {
        harness: "dsh",
        profile: "standard",
        sessionId: "s-child",
        cwd: "/work",
        parentSessionId: "s-parent",
        permissionMode: "workspace-write",
      },
      tool: "bash",
      decision: "allow",
    });
  });

  test("an unreadable policy denies everything with a reason that says what to fix", async () => {
    const env = { JIG_POLICY_FILE: join(tmpdir(), "jig-dsh-missing.json") };
    const out = await guardExecution(exec("bash", { command: "ls" }), allow, {
      audit: new FakeAudit(),
      env,
    });
    expect(out.kind).toBe("deny");
    if (out.kind === "deny") expect(out.reason).toContain("policy unreadable");
  });

  test("a guard that overruns its budget denies instead of hanging dsh", async () => {
    const env = { JIG_POLICY_FILE: policyFile(POLICY) };
    const hanging = { append: () => new Promise<void>(() => {}) };
    const out = await guardExecution(exec("bash", { command: "ls" }), allow, {
      audit: hanging,
      env,
      timeoutMs: 20,
    });
    expect(out.kind).toBe("deny");
    if (out.kind === "deny") expect(out.reason).toContain("exceeded 20ms");
  });
});

describe("the built plugin under node", () => {
  test("bun build produces an ES module node can load, with unbash bundled in", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jig-dsh-bundle-"));
    dirs.push(dir);
    const out = join(dir, "index.js");
    const build = Bun.spawnSync(
      [
        "bun",
        "build",
        "adapters/dsh/src/index.ts",
        "--target",
        "node",
        "--format",
        "esm",
        "--outfile",
        out,
      ],
      { cwd: join(import.meta.dir, "..", "..", ".."), stdout: "pipe", stderr: "pipe" },
    );
    expect(build.exitCode).toBe(0);
    const policy = policyFile(POLICY);
    const script = `
      const m = await import(${JSON.stringify(out)});
      const audit = { append: async () => {} };
      const env = { JIG_POLICY_FILE: ${JSON.stringify(policy)} };
      const next = async () => ({ kind: "allow" });
      const a = await m.guardExecution({ name: "bash", arguments: { command: "sudo rm -rf /tmp/x" } }, next, { audit, env });
      const b = await m.guardExecution({ name: "bash", arguments: { command: 'grep "rm -rf" notes.md' } }, next, { audit, env });
      console.log(JSON.stringify([a, b]));
    `;
    const run = Bun.spawnSync(["node", "--input-type=module", "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(new TextDecoder().decode(run.stderr)).toBe("");
    expect(JSON.parse(new TextDecoder().decode(run.stdout).trim())).toEqual([
      { kind: "deny", reason: "recursive force delete" },
      { kind: "allow" },
    ]);
  });
});
