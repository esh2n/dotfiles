import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Decode, HarnessCommand, SwarmLog } from "../../../src/app/swarm/ports";
import { Swarm } from "../../../src/app/swarm/swarm";
import { DEFAULT_CONFIG } from "../../../src/domain/swarm/config";
import type { Worker } from "../../../src/domain/swarm/types";
import { runCommand } from "../../../src/infra/proc/exec-file";
import { nodeWorktreeFs } from "../../../src/infra/swarm/fs";
import { fileSwarmLog } from "../../../src/infra/swarm/log";
import { spawnWorker } from "../../../src/infra/swarm/spawn";

/**
 * A stand-in worker: a shell script that reads its task and behaves
 * accordingly, printing the tiny JSONL dialect `decode` below understands.
 *   ok:<text>        one turn, one tool call, usage, then <text> as the answer
 *   fail             prints to stderr and exits 3
 *   sleep            waits until killed
 *   commit:<file>    writes and commits <file> in its working directory
 */
const SCRIPT = `
task="$1"
case "$task" in
  ok:*) echo '{"t":"turn"}'; echo '{"t":"tool"}'; echo '{"t":"usage","in":100,"out":20,"cost":0.001}'; echo "{\\"t\\":\\"end\\",\\"text\\":\\"\${task#ok:}\\"}";;
  fail) echo "broken" >&2; exit 3;;
  sleep) sleep 30;;
  commit:*) f="\${task#commit:}"; mkdir -p "$(dirname "$f")"; echo x > "$f"; git add "$f" >/dev/null; git -c user.email=t@e -c user.name=t commit -qm w >/dev/null; echo '{"t":"end","text":"committed"}';;
esac
`;

const harness: HarnessCommand = {
  bin: "sh",
  args: ({ task }) => ["-c", SCRIPT, "worker", task],
  env: (tier) => ({
    SWARM_WORKER: "1",
    TEST_TIER: tier,
    GIT_CONFIG_PARAMETERS: "'core.fsmonitor=false'",
  }),
};

const decode: Decode = (line) => {
  const e = JSON.parse(line) as {
    t: string;
    text?: string;
    in?: number;
    out?: number;
    cost?: number;
  };
  switch (e.t) {
    case "turn":
      return [{ kind: "progress", progress: { turn: true } }];
    case "tool":
      return [{ kind: "progress", progress: { toolCall: true } }];
    case "usage":
      return [
        {
          kind: "progress",
          progress: {
            usage: {
              input: e.in ?? 0,
              output: e.out ?? 0,
              cacheRead: 0,
              cacheWrite: 0,
              cost: e.cost,
            },
          },
        },
      ];
    case "end":
      return [{ kind: "end", ...(e.text === undefined ? {} : { text: e.text }) }];
    default:
      return [];
  }
};

let root: string;
let stateDir: string;
let delivered: { message: string; workers: readonly Worker[] }[];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_PARAMETERS: "'core.fsmonitor=false'" },
  }).trim();
}

function makeSwarm(overrides: Partial<ConstructorParameters<typeof Swarm>[0]> = {}): Swarm {
  const log: SwarmLog = fileSwarmLog(stateDir);
  return new Swarm({
    config: DEFAULT_CONFIG,
    harness,
    decode,
    spawn: spawnWorker,
    worktree: { run: runCommand, fs: nodeWorktreeFs },
    log,
    now: () => Date.now(),
    root,
    onChange: () => {},
    onDeliver: (message, workers) => delivered.push({ message, workers }),
    ...overrides,
  });
}

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "swarm-run-")));
  stateDir = join(root, ".state");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  writeFileSync(join(root, ".gitignore"), ".state/\n");
  writeFileSync(join(root, "a.txt"), "a\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  delivered = [];
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a batch runs in the background and is delivered once", () => {
  test("three workers, one message with every answer, usage added up", async () => {
    const swarm = makeSwarm();
    const r = swarm.start(
      [
        { name: "a", task: "ok:alpha", files: ["a/**"] },
        { name: "b", task: "ok:beta", files: ["b/**"] },
        { name: "c", task: "ok:gamma", files: ["c/**"] },
      ],
      "main",
    );
    expect(r.ok).toBe(true);
    await until(() => delivered.length === 1);
    const { message, workers } = delivered[0] ?? { message: "", workers: [] };
    expect(workers.map((w) => w.spec.name).sort()).toEqual(["a", "b", "c"]);
    expect(message).toContain("alpha");
    expect(message).toContain("gamma");
    expect(swarm.current.every((w) => w.status === "done")).toBe(true);
    const a = swarm.current.find((w) => w.spec.name === "a");
    expect(a).toMatchObject({ turns: 1, toolCalls: 1 });
    expect(a?.usage).toMatchObject({ input: 100, output: 20, cost: 0.001 });
    expect(readFileSync(join(stateDir, "a.result.md"), "utf8")).toBe("alpha\n");
  });

  test("the tier's limit queues the rest; deterministic runs one at a time", async () => {
    const statuses: string[][] = [];
    const swarm = makeSwarm({ onChange: (w) => statuses.push(w.map((x) => x.status)) });
    swarm.start(
      [
        { name: "a", task: "ok:1", tier: "deterministic", files: ["a/**"] },
        { name: "b", task: "ok:2", tier: "deterministic", files: ["b/**"] },
      ],
      "main",
    );
    expect(swarm.current.map((w) => w.status)).toEqual(["working", "queued"]);
    await until(() => delivered.length === 1);
    expect(statuses.some((s) => s[0] === "working" && s[1] === "working")).toBe(false);
  });

  test("a failure is delivered at once, with the reason, before slow siblings end", async () => {
    const swarm = makeSwarm();
    swarm.start(
      [
        { name: "bad", task: "fail", files: ["x/**"] },
        { name: "slow", task: "sleep", files: ["y/**"] },
      ],
      "main",
    );
    await until(() => delivered.length === 1);
    expect(delivered[0]?.message).toContain("status 3");
    expect(delivered[0]?.message).toContain("broken");
    expect(swarm.current.find((w) => w.spec.name === "slow")?.status).toBe("working");
    swarm.shutdown();
  });
});

describe("stopping", () => {
  test("cancel stops a running worker and a queued one never starts", async () => {
    const swarm = makeSwarm();
    swarm.start(
      [
        { name: "s1", task: "sleep", tier: "deterministic", files: ["a/**"] },
        { name: "s2", task: "sleep", tier: "deterministic", files: ["b/**"] },
      ],
      "main",
    );
    expect(swarm.cancel()).toContain("s1");
    expect(swarm.current.map((w) => w.status)).toEqual(["cancelled", "cancelled"]);
    // the killed process exits later; the parent asked for the stop, so nothing is delivered
    await new Promise((r) => setTimeout(r, 300));
    expect(delivered).toEqual([]);
  });

  test("after shutdown nothing new starts", () => {
    const swarm = makeSwarm();
    swarm.shutdown();
    expect(swarm.start([{ name: "a", task: "ok:x" }], "main").ok).toBe(false);
  });
});

describe("isolated workers", () => {
  test("work on their own branch and wait for the owner's merge", async () => {
    const swarm = makeSwarm();
    swarm.start(
      [{ name: "iso", task: "commit:iso/x.txt", files: ["iso/**"], isolated: true }],
      "main",
    );
    await until(() => delivered.length === 1);
    expect(swarm.current[0]?.status).toBe("held");
    expect(delivered[0]?.message).toContain("git merge --no-ff iso");
    expect(git(root, "log", "--oneline", "iso").split("\n")).toHaveLength(2);
    expect(existsSync(join(root, "iso/x.txt"))).toBe(false);
  });

  test("a change outside the declared files is named", async () => {
    const swarm = makeSwarm();
    swarm.start(
      [{ name: "iso2", task: "commit:elsewhere/y.txt", files: ["iso2/**"], isolated: true }],
      "main",
    );
    await until(() => delivered.length === 1);
    expect(swarm.current[0]?.note).toContain("範囲外 1 件: elsewhere/y.txt");
    expect(delivered[0]?.message).toContain("elsewhere/y.txt");
  });

  test("merged worktrees of the swarm's own are cleaned up", async () => {
    const swarm = makeSwarm();
    swarm.start(
      [{ name: "iso3", task: "commit:iso3/z.txt", files: ["iso3/**"], isolated: true }],
      "main",
    );
    await until(() => delivered.length === 1);
    git(root, "merge", "-q", "--no-ff", "-m", "merge", "iso3");
    expect(await swarm.removeMergedWorktrees()).toEqual(["iso3"]);
    expect(swarm.createdWorktrees).toEqual([]);
  });
});

describe("refusals", () => {
  test("a bad item is refused with a reason and nothing starts", () => {
    const swarm = makeSwarm();
    const r = swarm.start([{ name: "A B", task: "x" }], "main");
    expect(r.ok).toBe(false);
    expect(swarm.current).toEqual([]);
  });
});
