import { describe, expect, test } from "bun:test";
import { loadPlugins } from "../../../src/app/apply/plugins";
import type { PackHistory } from "../../../src/app/apply/ports";
import { fakeClaudeFs } from "./fake-claude-ports";

const H = "/repo/harness";
const P = "/home/u/.local/share/jig/plugins";
const CHECKOUT = `${P}/pstack`;
const VERIFIED = "019a6a20592c10bf92869e5740368f578a9997fd";
const NEWER = "1111111111111111111111111111111111111111";
const OPENING = "pstack/skills/poteto-mode/playbooks/opening-a-pr.md";
const MODE = "pstack/skills/poteto-mode/SKILL.md";
const SOURCE = JSON.stringify({
  repo: "https://github.com/cursor/plugins",
  ref: "main",
  skills: "pstack/skills",
  translated: [],
});
const PRECEDENCE = JSON.stringify({
  verifiedAt: VERIFIED,
  rows: [
    { id: "pr-readiness", quotes: [{ file: OPENING, text: "Open every PR ready." }] },
    { id: "outward-writes", quotes: [{ file: MODE, text: "proceed without asking." }] },
  ],
});

interface HistorySeed {
  readonly head?: string;
  readonly changed?: readonly string[];
}

function fakeHistory(seed: HistorySeed): PackHistory & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async head(dir) {
      calls.push(`head ${dir}`);
      return seed.head;
    },
    async changedFiles(dir, from, to) {
      calls.push(`diff ${dir} ${from} ${to}`);
      return seed.changed;
    },
  };
}

function seed(options: {
  readonly precedence?: string;
  readonly opening?: string;
  readonly history?: PackHistory;
}) {
  const fs = fakeClaudeFs({
    files: {
      [`${H}/plugins/pstack/source.json`]: SOURCE,
      ...(options.precedence === undefined
        ? {}
        : { [`${H}/plugins/pstack/precedence.json`]: options.precedence }),
      [`${CHECKOUT}/pstack/skills/poteto-mode/SKILL.md`]:
        "---\nname: x\n---\nproceed without asking.",
      ...(options.opening === undefined ? {} : { [`${CHECKOUT}/${OPENING}`]: options.opening }),
    },
  });
  const ports =
    options.history === undefined ? fs.ports : { ...fs.ports, packHistory: options.history };
  return { fs, ports };
}

async function check(options: Parameters<typeof seed>[0]) {
  const { ports } = seed(options);
  const { packs } = await loadPlugins(ports, H, P);
  return packs[0]?.precedence;
}

describe("loadPlugins: the precedence check", () => {
  test("a pack with no precedence.json carries no check", async () => {
    expect(await check({ opening: "Open every PR ready." })).toBeUndefined();
  });

  test("every quote still in the pack: nothing missing", async () => {
    const result = await check({ precedence: PRECEDENCE, opening: "Open every PR ready." });
    expect(result).toMatchObject({ missing: [] });
    expect(result?.drift).toBeUndefined();
  });

  test("a rewritten quote and a removed file are reported, not thrown", async () => {
    const rewritten = await check({ precedence: PRECEDENCE, opening: "Open every PR as a draft." });
    expect(rewritten?.missing).toEqual([
      { id: "pr-readiness", file: OPENING, text: "Open every PR ready.", fileMissing: false },
    ]);
    const removed = await check({ precedence: PRECEDENCE });
    expect(removed?.missing[0]).toMatchObject({ id: "pr-readiness", fileMissing: true });
  });

  test("a broken precedence.json is named; the pack is still linked", async () => {
    const { ports } = seed({ precedence: "{", opening: "x" });
    const { packs } = await loadPlugins(ports, H, P);
    expect(packs[0]?.present).toBe(true);
    expect(packs[0]?.precedence?.invalid).toContain("not JSON");
    expect(packs[0]?.precedence?.missing).toEqual([]);
  });

  test("an IO error on a quoted file or the table is a warning, never a crash", async () => {
    const { fs } = seed({ precedence: PRECEDENCE, opening: "Open every PR ready." });
    const eisdir = Object.assign(new Error("EISDIR: illegal operation on a directory"), {
      code: "EISDIR",
    });
    const throwingRead = {
      ...fs.ports,
      async readFile(path: string) {
        if (path.endsWith(OPENING)) throw eisdir;
        return fs.ports.readFile(path);
      },
    };
    const { packs } = await loadPlugins(throwingRead, H, P);
    expect(packs[0]?.present).toBe(true);
    expect(packs[0]?.precedence?.invalid).toContain("EISDIR");

    const throwingInspect = {
      ...fs.ports,
      async inspect(path: string) {
        if (path.includes("/pstack/skills/poteto-mode/")) throw new Error("ELOOP: too many links");
        return fs.ports.inspect(path);
      },
    };
    const again = await loadPlugins(throwingInspect, H, P);
    expect(again.packs[0]?.precedence?.invalid).toContain("ELOOP");

    const throwingHistory = {
      ...fs.ports,
      packHistory: {
        async head(): Promise<string | undefined> {
          throw new Error("EACCES");
        },
        async changedFiles(): Promise<readonly string[] | undefined> {
          return [];
        },
      },
    };
    const third = await loadPlugins(throwingHistory, H, P);
    expect(third.packs[0]?.precedence?.invalid).toContain("EACCES");
  });

  test("a pack not fetched is not checked", async () => {
    const fs = fakeClaudeFs({
      files: {
        [`${H}/plugins/pstack/source.json`]: SOURCE,
        [`${H}/plugins/pstack/precedence.json`]: PRECEDENCE,
      },
    });
    const { packs } = await loadPlugins(fs.ports, H, P);
    expect(packs[0]?.precedence).toBeUndefined();
  });

  test("the checkout at verifiedAt: no drift, no diff asked for", async () => {
    const history = fakeHistory({ head: VERIFIED });
    const result = await check({
      precedence: PRECEDENCE,
      opening: "Open every PR ready.",
      history,
    });
    expect(result?.drift).toBeUndefined();
    expect(history.calls).toEqual([`head ${CHECKOUT}`]);
  });

  test("the checkout moved past verifiedAt: the rows whose files changed", async () => {
    const history = fakeHistory({ head: NEWER, changed: [OPENING, "pstack/README.md"] });
    const result = await check({
      precedence: PRECEDENCE,
      opening: "Open every PR ready.",
      history,
    });
    expect(result?.drift).toEqual({
      kind: "moved",
      head: NEWER,
      verifiedAt: VERIFIED,
      rows: [{ id: "pr-readiness", files: [OPENING] }],
    });
    expect(history.calls).toContain(`diff ${CHECKOUT} ${VERIFIED} ${NEWER}`);
  });

  test("verifiedAt not in a shallow checkout: moved, but which rows is unknown", async () => {
    const history = fakeHistory({ head: NEWER });
    const result = await check({
      precedence: PRECEDENCE,
      opening: "Open every PR ready.",
      history,
    });
    expect(result?.drift).toEqual({ kind: "unknown", head: NEWER, verifiedAt: VERIFIED });
  });

  test("not a git checkout, or no history port: the commit part is skipped", async () => {
    const notGit = await check({
      precedence: PRECEDENCE,
      opening: "Open every PR ready.",
      history: fakeHistory({}),
    });
    expect(notGit?.drift).toBeUndefined();
    const noPort = await check({ precedence: PRECEDENCE, opening: "Open every PR ready." });
    expect(noPort?.drift).toBeUndefined();
  });

  test("a table without verifiedAt compares no commits", async () => {
    const history = fakeHistory({ head: NEWER, changed: [OPENING] });
    const table = JSON.stringify({ rows: JSON.parse(PRECEDENCE).rows });
    const result = await check({ precedence: table, opening: "Open every PR ready.", history });
    expect(result?.drift).toBeUndefined();
    expect(history.calls).toEqual([]);
  });
});
