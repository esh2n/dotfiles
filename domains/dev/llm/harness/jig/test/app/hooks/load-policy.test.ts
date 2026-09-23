import { describe, expect, test } from "bun:test";
import { loadGuardPolicy } from "../../../src/app/hooks/load-policy";

const POLICY = JSON.stringify({
  version: 1,
  rules: [
    {
      id: "git-push-main-master",
      effect: "forbid",
      action: "shell.exec",
      subject: { program: "git", argv: "^push\\b.*\\bmain\\b" },
      why: "main is PR-only",
      profiles: ["standard"],
      unlessCwdIn: "main-push-allowed",
    },
    {
      id: "git-force-push",
      effect: "forbid",
      action: "shell.exec",
      subject: { program: "git", argv: "^push\\b.*--force" },
      why: "never recoverable",
      profiles: ["standard"],
    },
  ],
});

function reader(files: Record<string, string>) {
  const reads: string[] = [];
  const read = async (path: string) => {
    reads.push(path);
    const text = files[path];
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return text;
  };
  return { read, reads };
}

describe("loadGuardPolicy", () => {
  test("reads each named waiver list from beside the policy, expanding ~", async () => {
    const { read, reads } = reader({
      "/cfg/jig/policy/guard-rules.json": POLICY,
      "/cfg/jig/policy/main-push-allowed": "~/go/github.com/owner\n",
    });
    const loaded = await loadGuardPolicy("/cfg/jig/policy/guard-rules.json", read, {
      home: "/Users/owner",
    });
    expect(loaded.policy.waivers).toEqual({
      "main-push-allowed": ["/Users/owner/go/github.com/owner/"],
    });
    expect(reads).toEqual([
      "/cfg/jig/policy/guard-rules.json",
      "/cfg/jig/policy/main-push-allowed",
    ]);
    expect(loaded.hash).toHaveLength(12);
  });

  test("a list that cannot be read is an empty list: the rule stays in force", async () => {
    const { read } = reader({ "/cfg/jig/policy/guard-rules.json": POLICY });
    const loaded = await loadGuardPolicy("/cfg/jig/policy/guard-rules.json", read, {
      home: "/Users/owner",
    });
    expect(loaded.policy.waivers).toEqual({ "main-push-allowed": [] });
  });

  test("a policy that names no list reads nothing else", async () => {
    const { read, reads } = reader({
      "/cfg/jig/policy/guard-rules.json": JSON.stringify({ version: 1, rules: [] }),
    });
    const loaded = await loadGuardPolicy("/cfg/jig/policy/guard-rules.json", read);
    expect(loaded.policy.waivers).toEqual({});
    expect(reads).toEqual(["/cfg/jig/policy/guard-rules.json"]);
  });

  test("a broken policy still throws", async () => {
    const { read } = reader({ "/cfg/jig/policy/guard-rules.json": "{" });
    await expect(loadGuardPolicy("/cfg/jig/policy/guard-rules.json", read)).rejects.toThrow();
  });
});
