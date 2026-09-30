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
  ok:*) echo '{"t":"turn"}'; echo '{"t":"tool"}'; echo '{"t":"usage","in":100,"out":20}'; echo "{\\"t\\":\\"end\\",\\"text\\":\\"\${task#ok:}\\"}";;
  fail) echo "broken" >&2; exit 3;;
  sleep) sleep 30;;
  silent) exit 0;;
  tag) echo "{\\"t\\":\\"end\\",\\"text\\":\\"$JIG_SWARM_TAG\\"}";;
  grandchild:*) sleep 30 & echo $! > "\${task#grandchild:}"; wait;;
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
    expect(a?.usage).toMatchObject({ input: 100, output: 20 });
    expect(a?.cost).toBeUndefined();
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

describe("what a worker leaves behind", () => {
  test("a clean exit with nothing readable is a failure, not an empty success", async () => {
    const swarm = makeSwarm();
    swarm.start([{ name: "quiet", task: "silent", files: ["q/**"] }], "main");
    await until(() => delivered.length === 1);
    expect(swarm.current[0]?.status).toBe("failed");
    expect(swarm.current[0]?.note).toContain("output format may have changed");
  });

  test("cancel stops what the worker started too", async () => {
    const pidFile = join(root, "grandchild.pid");
    const swarm = makeSwarm();
    swarm.start([{ name: "gc", task: `grandchild:${pidFile}`, files: ["g/**"] }], "main");
    await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "");
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    swarm.cancel();
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    await until(() => !alive(), 5_000);
    expect(alive()).toBe(false);
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

describe("cost comes from LiteLLM's spend log, by each worker's tag", () => {
  function manualClock() {
    const ticks: (() => void)[] = [];
    let stopped = 0;
    return {
      every: (_ms: number, tick: () => void) => {
        ticks.push(tick);
        return () => {
          stopped += 1;
        };
      },
      tick: () => {
        for (const t of ticks) t();
      },
      stopped: () => stopped,
    };
  }

  test("each worker runs with its own tag, and the log's spend becomes its cost", async () => {
    const clock = manualClock();
    const asked: string[][] = [];
    const swarm = makeSwarm({
      spend: {
        tag: (name) => `jig-swarm:s:${name}`,
        lookup: async (tags) => {
          asked.push([...tags]);
          return new Map([["jig-swarm:s:a", 0.0123]]);
        },
        every: clock.every,
      },
    });
    swarm.start(
      [
        { name: "a", task: "tag", files: ["a/**"] },
        { name: "b", task: "ok:beta", files: ["b/**"] },
      ],
      "main",
    );
    await until(() => delivered.length === 1);
    expect(delivered[0]?.message).toContain("jig-swarm:s:a");
    clock.tick();
    await until(() => swarm.current.find((w) => w.spec.name === "a")?.cost !== undefined);
    expect(asked[0]?.sort()).toEqual(["jig-swarm:s:a", "jig-swarm:s:b"]);
    expect(swarm.current.find((w) => w.spec.name === "b")?.cost).toBeUndefined();
  });

  test("an unreachable proxy leaves the cost unknown and is logged", async () => {
    const clock = manualClock();
    let calls = 0;
    const swarm = makeSwarm({
      spend: {
        tag: (name) => name,
        lookup: async () => {
          calls += 1;
          throw new Error("connection refused");
        },
        every: clock.every,
      },
    });
    swarm.start([{ name: "a", task: "ok:alpha" }], "main");
    await until(() => delivered.length === 1);
    clock.tick();
    await until(() => calls === 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(swarm.current[0]?.cost).toBeUndefined();
    expect(readFileSync(join(stateDir, "events.jsonl"), "utf8")).toContain("connection refused");
  });

  test("watching stops when no cost can change any more, and at shutdown", async () => {
    const clock = manualClock();
    let now = Date.now();
    const swarm = makeSwarm({
      now: () => now,
      spend: { tag: (n) => n, lookup: async () => new Map(), every: clock.every },
    });
    swarm.start([{ name: "a", task: "ok:alpha" }], "main");
    await until(() => delivered.length === 1);
    now += 10 * 60_000;
    clock.tick();
    await until(() => clock.stopped() === 1);
    swarm.shutdown();
    expect(clock.stopped()).toBe(1);
  });
});

describe("wait: the parent blocks until the next delivery, and it becomes the tool result", () => {
  test("the batch's results come back from wait, not as a second message", async () => {
    const swarm = makeSwarm();
    swarm.start([{ name: "a", task: "ok:alpha" }], "main");
    const text = await swarm.wait();
    expect(text).toContain("alpha");
    expect(delivered).toHaveLength(0);
    expect(swarm.current[0]?.status).toBe("done");
  });

  test("a batch started while a wait is pending resolves it too", async () => {
    const swarm = makeSwarm();
    swarm.start([{ name: "slow", task: "sleep", files: ["slow/**"] }], "main");
    const waiting = swarm.wait();
    swarm.start([{ name: "quick", task: "ok:beta", files: ["quick/**"] }], "main");
    const text = await waiting;
    expect(text).toContain("beta");
    expect(text).not.toContain("slow");
    swarm.shutdown();
  });

  test("with nothing queued or running it returns at once", async () => {
    const swarm = makeSwarm();
    expect(await swarm.wait()).toContain("Nothing to wait for");
  });

  test("the abort signal ends it, and the results still arrive as a message", async () => {
    const swarm = makeSwarm();
    swarm.start([{ name: "a", task: "sleep" }], "main");
    const abort = new AbortController();
    const waiting = swarm.wait(abort.signal);
    abort.abort();
    expect(await waiting).toContain("Wait cancelled");
    swarm.shutdown();
  });

  test("the one safety cap returns the table, not an empty answer", async () => {
    const swarm = makeSwarm();
    swarm.start([{ name: "a", task: "sleep" }], "main");
    const text = await swarm.wait(undefined, 50);
    expect(text).toContain("Still running");
    expect(text).toContain("- a [working]");
    swarm.shutdown();
  });

  test("only one wait at a time, and shutdown releases it", async () => {
    const swarm = makeSwarm();
    swarm.start([{ name: "a", task: "sleep" }], "main");
    const first = swarm.wait();
    expect(await swarm.wait()).toContain("already in progress");
    swarm.shutdown();
    expect(await first).toContain("session is ending");
  });
});
