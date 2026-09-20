import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditEntry } from "../../../src/domain/policy/audit";
import { JsonlAuditLog } from "../../../src/infra/audit/jsonl-audit";

const entry = (decision: AuditEntry["decision"]): AuditEntry => ({
  ts: "2026-09-21T00:00:00.000Z",
  principal: { harness: "pi", profile: "standard" },
  tool: "Bash",
  decision,
  source: decision === "allow" ? "none" : "rule",
  policy: { version: 2, hash: "abcdef012345" },
});

describe("JsonlAuditLog", () => {
  test("appends one JSON line per entry, creating the directory on first use", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "jig-audit-")), "nested", "guard-audit.jsonl");
    const log = new JsonlAuditLog(path);
    await log.append(entry("deny"));
    await log.append(entry("allow"));
    const lines = readFileSync(path, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      decision: "deny",
      policy: { hash: "abcdef012345" },
    });
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({ decision: "allow" });
  });
});
