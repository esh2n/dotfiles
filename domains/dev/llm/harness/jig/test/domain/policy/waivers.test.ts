import { describe, expect, test } from "bun:test";
import { type ToolCall, judge } from "../../../src/domain/hooks/decision";
import { parsePolicy, waiverListNames, withWaivers } from "../../../src/domain/policy/parse";
import type { Principal } from "../../../src/domain/policy/request";
import { requestFor } from "../../../src/domain/policy/request";
import type { Policy } from "../../../src/domain/policy/types";
import { cwdListed, parseWaiverList, reachesElsewhere } from "../../../src/domain/policy/waivers";

const HOME = "/Users/owner";

const PUSH_MAIN = {
  id: "git-push-main-master",
  effect: "forbid",
  action: "shell.exec",
  subject: {
    program: "git",
    argv: "^(?:(?:-C|-c)\\s+\\S+\\s+|-[a-zA-Z]\\s+|--[a-zA-Z][a-zA-Z-]*(?:=\\S+)?\\s+)*push\\b(?=.*\\b(?:main|master)\\b)",
  },
  why: "pushing to main/master bypasses the PR workflow",
  profiles: ["minimal", "standard", "strict"],
  unlessCwdIn: "main-push-allowed",
};

function policy(waivers: Record<string, readonly string[]>): Policy {
  const parsed = parsePolicy({ version: 1, rules: [PUSH_MAIN] });
  if (parsed.version !== 1) throw new Error("expected the guard policy");
  return withWaivers(parsed, waivers);
}

const bash = (command: string): ToolCall => ({ tool: "Bash", input: { command } });
const at = (cwd: string): Principal => ({ harness: "claude", profile: "standard", cwd });

describe("parseWaiverList", () => {
  test("one prefix per line, ~ expanded, comments and blanks skipped, trailing slash added", () => {
    const list = parseWaiverList("# personal repos\n~/go/github.com/owner\n\n/srv/play/\n", HOME);
    expect(list).toEqual(["/Users/owner/go/github.com/owner/", "/srv/play/"]);
  });

  test("a bare ~ is the home directory", () => {
    expect(parseWaiverList("~", HOME)).toEqual(["/Users/owner/"]);
  });

  test("a relative line names no place and is dropped", () => {
    expect(parseWaiverList("go/github.com/owner\n", HOME)).toEqual([]);
  });
});

describe("cwdListed", () => {
  const prefixes = ["/Users/owner/go/github.com/owner/"];

  test("a repository under the prefix, and the prefix itself", () => {
    expect(cwdListed(prefixes, "/Users/owner/go/github.com/owner/dotfiles")).toBe(true);
    expect(cwdListed(prefixes, "/Users/owner/go/github.com/owner")).toBe(true);
  });

  test("a sibling whose name merely starts the same way is not under it", () => {
    expect(cwdListed(prefixes, "/Users/owner/go/github.com/owner-work/repo")).toBe(false);
    expect(cwdListed(prefixes, "/Users/owner/go/github.com/acme/repo")).toBe(false);
  });
});

describe("reachesElsewhere", () => {
  const prefixes = ["/Users/owner/go/github.com/owner/"];
  const shell = (command: string) => {
    const request = requestFor(bash(command));
    if (request === undefined) throw new Error("expected a request");
    return request;
  };

  test("a plain push stays where the session is", () => {
    expect(reachesElsewhere(shell("git push origin main"), prefixes)).toBe(false);
  });

  test("git -C, --git-dir and --work-tree point at another repository", () => {
    expect(reachesElsewhere(shell("git -C /work/repo push origin main"), prefixes)).toBe(true);
    expect(
      reachesElsewhere(shell("git --git-dir=/work/repo/.git push origin main"), prefixes),
    ).toBe(true);
    expect(reachesElsewhere(shell("git --work-tree /work/repo push origin main"), prefixes)).toBe(
      true,
    );
  });

  test("a cd or pushd on the same line leaves the cwd", () => {
    expect(reachesElsewhere(shell("cd /work/repo && git push origin main"), prefixes)).toBe(true);
    expect(reachesElsewhere(shell("pushd /work/repo; git push origin main"), prefixes)).toBe(true);
  });

  test("a command the reader cannot resolve is never waived", () => {
    expect(reachesElsewhere(shell("(cd /work/repo && git push origin main)"), prefixes)).toBe(true);
  });

  test("a file operation is elsewhere when its absolute path is outside the prefixes", () => {
    const write = (file_path: string) => {
      const request = requestFor({ tool: "Write", input: { file_path } });
      if (request === undefined) throw new Error("expected a request");
      return request;
    };
    expect(reachesElsewhere(write("/Users/owner/go/github.com/owner/dotfiles/x"), prefixes)).toBe(
      false,
    );
    expect(reachesElsewhere(write("/work/repo/x"), prefixes)).toBe(true);
    expect(reachesElsewhere(write("relative/x"), prefixes)).toBe(false);
  });
});

describe("a waived rule, end to end through judge", () => {
  const personal = "/Users/owner/go/github.com/owner/dotfiles";
  const work = "/Users/owner/go/github.com/acme/service";
  const p = policy({ "main-push-allowed": ["/Users/owner/go/github.com/owner/"] });

  test("push to main from a listed repository is allowed, and the judgment names the waived rule", () => {
    const j = judge(bash("git push origin main"), at(personal), p);
    expect(j.decision).toEqual({ kind: "allow" });
    expect(j.source).toBe("none");
    expect(j.waived).toEqual(["git-push-main-master"]);
  });

  test("the same push from an unlisted repository is still forbidden", () => {
    const j = judge(bash("git push origin main"), at(work), p);
    expect(j.decision.kind).toBe("deny");
    expect(j.ruleId).toBe("git-push-main-master");
    expect(j.waived).toBeUndefined();
  });

  test("a session with no cwd is not waived", () => {
    const j = judge(bash("git push origin main"), { harness: "claude", profile: "standard" }, p);
    expect(j.decision.kind).toBe("deny");
  });

  test("reaching into another repository from a listed cwd is not waived", () => {
    expect(judge(bash("git -C /work/repo push origin main"), at(personal), p).decision.kind).toBe(
      "deny",
    );
    expect(
      judge(bash("cd /work/repo && git push origin main"), at(personal), p).decision.kind,
    ).toBe("deny");
  });

  test("an empty or missing list waives nothing", () => {
    expect(judge(bash("git push origin main"), at(personal), policy({})).decision.kind).toBe(
      "deny",
    );
    expect(
      judge(bash("git push origin main"), at(personal), policy({ "main-push-allowed": [] }))
        .decision.kind,
    ).toBe("deny");
  });

  test("a push that never matched the rule carries no waived list", () => {
    const j = judge(bash("git push origin feature"), at(personal), p);
    expect(j.decision).toEqual({ kind: "allow" });
    expect(j.waived).toBeUndefined();
  });

  test("the parser reports the list names a policy needs", () => {
    const parsed = parsePolicy({ version: 1, rules: [PUSH_MAIN] });
    expect(waiverListNames(parsed)).toEqual(["main-push-allowed"]);
    expect(parsed.waivers).toEqual({});
  });
});
