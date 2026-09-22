import { beforeEach, describe, expect, test } from "bun:test";
import {
  MAX_CONTINUATIONS,
  gateCommandFor,
  gateOnStop,
  resetGate,
  tail,
} from "../../../adapters/omp/src/gate";
import type { OmpContext } from "../../../adapters/omp/src/omp";
import type { CommandResult, Runner } from "../../../adapters/omp/src/run";

const ctx: OmpContext = {
  cwd: "/repo",
  hasUI: true,
  sessionManager: { getSessionId: () => "s-1" },
};

const exists = (names: readonly string[]) => (path: string) =>
  names.some((name) => path === `/repo/${name}`);

function runner(result: Partial<CommandResult>): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = async (bin, args) => {
    calls.push([bin, ...args]);
    return { code: 0, stdout: "", stderr: "", missing: false, ...result };
  };
  return { run, calls };
}

beforeEach(() => {
  resetGate();
});

describe("which check a project answers to", () => {
  test("is decided by what is in its root", () => {
    expect(gateCommandFor("/repo", exists(["tsconfig.json"]))?.label).toBe("bunx tsc --noEmit");
    expect(gateCommandFor("/repo", exists(["go.mod"]))?.label).toBe("go vet ./...");
    expect(gateCommandFor("/repo", exists(["pyproject.toml"]))?.label).toBe("ruff check");
    expect(gateCommandFor("/repo", exists(["Cargo.toml"]))?.label).toBe("cargo check");
    expect(gateCommandFor("/repo", exists(["README.md"]))).toBeUndefined();
  });
});

describe("gateOnStop", () => {
  test("a project with no check lets the session settle without running anything", async () => {
    const { run, calls } = runner({});
    const out = await gateOnStop({ session_id: "s-1" }, ctx, {
      run,
      exists: exists(["README.md"]),
    });
    expect(out).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("a passing check says nothing", async () => {
    const { run, calls } = runner({ code: 0 });
    const out = await gateOnStop({ session_id: "s-1" }, ctx, {
      run,
      exists: exists(["tsconfig.json"]),
    });
    expect(out).toBeUndefined();
    expect(calls).toEqual([["bunx", "tsc", "--noEmit"]]);
  });

  test("a failing check asks for one continuation, carrying the tail of the output", async () => {
    const { run } = runner({ code: 2, stdout: "src/a.ts(3,1): error TS2322: nope" });
    const out = await gateOnStop({ session_id: "s-1" }, ctx, {
      run,
      exists: exists(["tsconfig.json"]),
    });
    expect(out?.continue).toBe(true);
    expect(out?.decision).toBeUndefined(); // advisory, never a hard block
    expect(out?.additionalContext).toContain("bunx tsc --noEmit");
    expect(out?.additionalContext).toContain("error TS2322");
    expect(out?.additionalContext).toContain(`continuation 1 of ${MAX_CONTINUATIONS}`);
  });

  test("the cap is two per session, then the turn ends whatever the gate says", async () => {
    const { run, calls } = runner({ code: 1, stderr: "boom" });
    const deps = { run, exists: exists(["go.mod"]) };
    expect((await gateOnStop({ session_id: "s-1" }, ctx, deps))?.continue).toBe(true);
    expect((await gateOnStop({ session_id: "s-1" }, ctx, deps))?.continue).toBe(true);
    expect(await gateOnStop({ session_id: "s-1" }, ctx, deps)).toBeUndefined();
    // The third stop does not even run the check.
    expect(calls).toHaveLength(2);
    // Another session has its own budget.
    expect((await gateOnStop({ session_id: "s-2" }, ctx, deps))?.continue).toBe(true);
  });

  test("a toolchain that is not installed is not a failing check", async () => {
    const { run } = runner({ code: 127, missing: true, stderr: "not found" });
    expect(
      await gateOnStop({ session_id: "s-1" }, ctx, { run, exists: exists(["Cargo.toml"]) }),
    ).toBeUndefined();
  });

  test("a subagent stop is skipped entirely", async () => {
    const { run, calls } = runner({ code: 1 });
    const out = await gateOnStop({ session_id: "s-1" }, ctx, {
      run,
      exists: exists(["tsconfig.json"]),
      isSubagent: () => true,
    });
    expect(out).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("the session id falls back to the context when the event omits it", async () => {
    const { run } = runner({ code: 1, stderr: "x" });
    const deps = { run, exists: exists(["go.mod"]) };
    expect((await gateOnStop({}, ctx, deps))?.continue).toBe(true);
    expect((await gateOnStop({}, ctx, deps))?.continue).toBe(true);
    expect(await gateOnStop({ session_id: "s-1" }, ctx, deps)).toBeUndefined();
  });
});

describe("tail", () => {
  test("keeps the end, which is where the errors are", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const kept = tail(text, 3);
    expect(kept).toBe("line 97\nline 98\nline 99");
  });

  test("is bounded in characters as well as lines", () => {
    expect(tail("x".repeat(9_000), 40, 100)).toHaveLength(100);
  });
});
