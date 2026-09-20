import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateGuardRules,
  loadPolicy,
  resolveProfile,
  validateGuardDoc,
} from "../guard";

const VALID_DOC = {
  version: 1,
  rules: [
    {
      id: "git-force-push",
      tier: "deny",
      tools: ["shell"],
      match: "\\bgit\\s+push\\b.*--force",
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
      id: "policy-write",
      tier: "deny",
      tools: ["write"],
      match: "guard-rules\\.json",
      why: "the policy is not agent-writable",
      profiles: ["minimal", "standard", "strict"],
    },
  ],
};

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "guard-ts-test-"));
}

function writeDoc(dir: string, content: unknown): string {
  const path = join(dir, "guard-rules.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: assigning undefined stores the string "undefined" in process.env
  delete process.env.JIG_HOOK_PROFILE;
  // biome-ignore lint/performance/noDelete: assigning undefined stores the string "undefined" in process.env
  delete process.env.YOKI_HOOK_PROFILE;
});

describe("resolveProfile", () => {
  test("JIG_HOOK_PROFILE wins over the legacy YOKI_HOOK_PROFILE", () => {
    process.env.JIG_HOOK_PROFILE = "strict";
    process.env.YOKI_HOOK_PROFILE = "minimal";
    expect(resolveProfile(process.env)).toBe("strict");
  });

  test("legacy YOKI_HOOK_PROFILE still applies while the fleet migrates", () => {
    process.env.YOKI_HOOK_PROFILE = "minimal";
    expect(resolveProfile(process.env)).toBe("minimal");
  });

  test("an unknown value normalizes to standard, never to a wider profile", () => {
    process.env.JIG_HOOK_PROFILE = "banana";
    expect(resolveProfile(process.env)).toBe("standard");
  });

  test("no env at all defaults to standard", () => {
    expect(resolveProfile({})).toBe("standard");
  });
});

describe("validateGuardDoc", () => {
  test("accepts a well-formed document", () => {
    const doc = validateGuardDoc(VALID_DOC);
    expect(doc.rules).toHaveLength(3);
    expect(doc.rules[0]?.match).toBeInstanceOf(RegExp);
  });

  test("rejects a non-object document", () => {
    expect(() => validateGuardDoc(null)).toThrow();
    expect(() => validateGuardDoc("nope")).toThrow();
    expect(() => validateGuardDoc([])).toThrow();
  });

  test("rejects a document whose rules is not an array", () => {
    expect(() => validateGuardDoc({ rules: "nope" })).toThrow();
  });

  test("rejects a rule with a mistyped tier", () => {
    const doc = { rules: [{ ...VALID_DOC.rules[0], tier: "Deny" }] };
    expect(() => validateGuardDoc(doc)).toThrow(/tier/);
  });

  test("rejects a rule missing tools", () => {
    const { tools, ...rest } = VALID_DOC.rules[0] as Record<string, unknown>;
    expect(() => validateGuardDoc({ rules: [rest] })).toThrow(/tools/);
  });

  test("rejects a rule with an empty tools array", () => {
    const doc = { rules: [{ ...VALID_DOC.rules[0], tools: [] }] };
    expect(() => validateGuardDoc(doc)).toThrow(/tools/);
  });

  test("rejects a rule missing profiles", () => {
    const { profiles, ...rest } = VALID_DOC.rules[0] as Record<string, unknown>;
    expect(() => validateGuardDoc({ rules: [rest] })).toThrow(/profiles/);
  });

  test("rejects a rule with an invalid match regex", () => {
    const doc = { rules: [{ ...VALID_DOC.rules[0], match: "(unclosed" }] };
    expect(() => validateGuardDoc(doc)).toThrow(/match/);
  });

  test("rejects a rule with an empty id", () => {
    const doc = { rules: [{ ...VALID_DOC.rules[0], id: "" }] };
    expect(() => validateGuardDoc(doc)).toThrow(/id/);
  });

  test("rejects a rule with an empty why", () => {
    const doc = { rules: [{ ...VALID_DOC.rules[0], why: "" }] };
    expect(() => validateGuardDoc(doc)).toThrow(/why/);
  });

  test("one invalid rule fails the WHOLE document, not just that rule", () => {
    const doc = { rules: [VALID_DOC.rules[0], { ...VALID_DOC.rules[1], tier: "Confirm" }] };
    expect(() => validateGuardDoc(doc)).toThrow();
  });
});

describe("evaluateGuardRules", () => {
  const rules = validateGuardDoc(VALID_DOC).rules;

  test("deny beats confirm when both match", () => {
    const denyAndConfirmRules = validateGuardDoc({
      rules: [
        { ...VALID_DOC.rules[1], match: "\\bdangerous\\b" }, // confirm
        { ...VALID_DOC.rules[0], match: "\\bdangerous\\b" }, // deny
      ],
    }).rules;
    const match = evaluateGuardRules(denyAndConfirmRules, { tool: "shell", command: "dangerous" }, "strict");
    expect(match?.tier).toBe("deny");
  });

  test("confirm matches when no deny rule applies", () => {
    const match = evaluateGuardRules(rules, { tool: "shell", command: "rm -rf /tmp/x" }, "standard");
    expect(match).toEqual({ tier: "confirm", why: "rm -rf requires confirmation" });
  });

  test("a rule outside its profile does not match", () => {
    const match = evaluateGuardRules(rules, { tool: "shell", command: "rm -rf /tmp/x" }, "minimal");
    expect(match).toBeUndefined();
  });

  test("a rule scoped to a different tool does not match a shell command", () => {
    const match = evaluateGuardRules(rules, { tool: "shell", command: "guard-rules.json" }, "strict");
    expect(match).toBeUndefined();
  });

  test("no rule matches: undefined", () => {
    const match = evaluateGuardRules(rules, { tool: "shell", command: "echo hello" }, "strict");
    expect(match).toBeUndefined();
  });
});

describe("loadPolicy", () => {
  test("a transient read failure is NOT cached: the next call retries and can succeed", () => {
    const dir = tempDir();
    tempDirs.push(dir);
    const path = join(dir, "guard-rules.json");
    // Nothing written yet — first load fails.
    const first = loadPolicy(path);
    expect("error" in first).toBe(true);

    // Now the file becomes readable — a cached failure would hide this forever.
    writeFileSync(path, JSON.stringify(VALID_DOC));
    const second = loadPolicy(path);
    expect("error" in second).toBe(false);
  });

  test("a successful load IS cached: a later on-disk change is not picked up until the path changes", () => {
    const dir = tempDir();
    tempDirs.push(dir);
    const path = writeDoc(dir, VALID_DOC);

    const first = loadPolicy(path);
    expect("error" in first).toBe(false);

    writeFileSync(path, "{ not json");
    const second = loadPolicy(path);
    expect(second).toBe(first);
  });

  test("an unparseable policy file fails, naming the path in the caller's own error handling", () => {
    const dir = tempDir();
    tempDirs.push(dir);
    const path = writeDoc(dir, "{ not json");
    const loaded = loadPolicy(path);
    expect("error" in loaded).toBe(true);
  });

  test("a schema-invalid policy file fails closed too", () => {
    const dir = tempDir();
    tempDirs.push(dir);
    const path = writeDoc(dir, { rules: [{ id: "bad" }] });
    const loaded = loadPolicy(path);
    expect("error" in loaded).toBe(true);
  });
});
