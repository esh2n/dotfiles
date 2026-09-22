import type { BoxPorts } from "../../../src/app/box/ports";
import type { CommandResult } from "../../../src/domain/ports";

export interface FakeBox {
  readonly ports: BoxPorts;
  /** Every `sbx` invocation, in order. */
  readonly calls: string[][];
  /** Every `git` invocation, in order. */
  readonly gitCalls: string[][];
  /** Arguments `sbx.attach` was called with, in order. */
  readonly attached: string[][];
  /** The kit that was written: relative path -> content. */
  readonly kit: { dir?: string; files?: Readonly<Record<string, string>> };
  /** The first `sbx <verb> …` invocation, or `undefined` if there was none. */
  sbxCall(verb: string): string[] | undefined;
}

export interface FakeBoxOptions {
  /** Canned results, keyed by the first sbx argument. */
  readonly sbx?: Readonly<Record<string, Partial<CommandResult>>>;
  readonly git?: Readonly<Record<string, Partial<CommandResult>>>;
  readonly toplevel?: string | undefined;
  readonly branch?: string;
  readonly attachCode?: number;
  /** Makes `source.read()` reject, as it does when no guard policy is installed. */
  readonly sourceError?: string;
}

const OK: CommandResult = { code: 0, stdout: "", stderr: "" };

/**
 * `sbx settings get ssh.agentForwardingEnabled` — the fake answers "off" by
 * default, so a test that is about something else is not derailed by the
 * refusal; the tests that are about it override this.
 */
const DEFAULTS: Readonly<Record<string, Partial<CommandResult>>> = {
  settings: { stdout: "false\n" },
};

export function fakeBoxPorts(options: FakeBoxOptions = {}): FakeBox {
  const calls: string[][] = [];
  const gitCalls: string[][] = [];
  const attached: string[][] = [];
  const kit: { dir?: string; files?: Readonly<Record<string, string>> } = {};

  const ports: BoxPorts = {
    sbx: {
      async run(args) {
        const verb = args[0] ?? "";
        calls.push([...args]);
        return { ...OK, ...(DEFAULTS[verb] ?? {}), ...(options.sbx?.[verb] ?? {}) };
      },
      async attach(args) {
        attached.push([...args]);
        return options.attachCode ?? 0;
      },
    },
    kit: {
      async write(name, files) {
        kit.dir = `/tmp/jig-box/${name}`;
        kit.files = files;
        return kit.dir;
      },
    },
    source: {
      async read() {
        if (options.sourceError !== undefined) throw new Error(options.sourceError);
        return {
          files: { "package.json": "{}", "src/cli/jig.ts": "// entry" },
          guardRules: '{"version":3,"rules":[]}',
          instructions: "# box",
        };
      },
    },
    git: {
      async toplevel() {
        return "toplevel" in options ? options.toplevel : "/Users/x/dotfiles";
      },
      async branch() {
        return options.branch ?? "main";
      },
      async run(args) {
        gitCalls.push([...args]);
        return { ...OK, ...(options.git?.[args[0] ?? ""] ?? {}) };
      },
    },
  };

  return {
    ports,
    calls,
    gitCalls,
    attached,
    kit,
    sbxCall: (verb) => calls.find((call) => call[0] === verb),
  };
}

/**
 * One `sbx ls --json` payload, as the real thing shapes it. `agent` defaults
 * to `jig-claude`, which is what a box created from jig's fork kit reports.
 * `workspace` defaults to the same root `git.toplevel` fakes, so a box is
 * "this repository's" unless a test says otherwise.
 */
export function listing(
  boxes: readonly {
    name: string;
    agent?: string;
    status?: string;
    lastUsedAt?: string;
    gitPort?: number;
    workspace?: string;
  }[],
): string {
  return JSON.stringify({
    sandboxes: boxes.map((box) => ({
      name: box.name,
      id: box.name,
      agent: box.agent ?? "jig-claude",
      status: box.status ?? "running",
      last_used_at: box.lastUsedAt ?? "2026-09-22T00:00:00Z",
      workspaces: [box.workspace ?? "/Users/x/dotfiles"],
      ...(box.gitPort === undefined
        ? {}
        : { ports: [{ sandbox_port: 9418, host_port: box.gitPort }] }),
    })),
  });
}
