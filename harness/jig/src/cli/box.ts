/**
 * `jig box` — run an agent in a Docker Sandboxes microVM instead of on the
 * host. Thin: argv parsing and text formatting, delegating to the use-cases
 * in `app/box/`. The composition root (`./jig.ts`) builds the real ports and
 * resolves the posture kit directories; this module touches neither the
 * filesystem nor `process.env`.
 *
 * The shape is fixed by `rules/decisions/2026-09-22-box-shape.md`: a box is
 * not the default, the repository enters by clone, and results leave by git.
 */

import { createBox } from "../app/box/create";
import { fetchBox } from "../app/box/fetch";
import { BOX_AGENTS, type BoxAgent } from "../app/box/kit";
import { listBoxes } from "../app/box/list";
import type { BoxPorts, BoxResult } from "../app/box/ports";
import { removeBox } from "../app/box/remove";
import { resumeBox } from "../app/box/resume";

export interface BoxCliResult {
  readonly stdout: string;
  readonly code: number;
}

export interface BoxCliContext {
  /** Where the caller ran jig; the repository is found from here unless `--path` says otherwise. */
  readonly cwd: string;
  /** The two posture mixins, by directory. */
  readonly postureKits: { readonly guarded: string; readonly connected: string };
  /** Set when `JIG_BOX_DRY_RUN=1`; `--dry-run` sets it per call. */
  readonly dryRun: boolean;
  /** Set when `JIG_BOX_NO_ATTACH=1`; `--no-attach` sets it per call. */
  readonly noAttach: boolean;
}

const USAGE = `usage: jig box <new | list | resume | fetch | rm>
  new [--agent claude|codex] [--pr] [--path <dir>] [--dry-run] [--no-attach]
      Create a box around a clone of this repository and attach to it.
      --pr grants the GitHub token through the sbx proxy; without it the box
      has no credentials at all and its work leaves only by fetch.
  list [--path <dir>] [--all]
      Boxes for this repository, newest first. --all lists every sandbox.
  resume <name>              Re-attach and continue that box's session.
  fetch <name> [--path <dir>]  Pull its branches into refs/remotes/sandbox-<name>/*.
  rm <name> [--dry-run]      Remove the box. Irreversible; fetch first.
`;

/** `pi`, `dsh` and `omp` have no built-in sbx agent — community templates only. */
function agentError(value: string): string {
  return (
    `jig box: no built-in sbx agent for ${JSON.stringify(value)} ` +
    `(available: ${BOX_AGENTS.join(", ")})`
  );
}

interface ParsedArgs {
  /** Everything that was not a flag or a flag's value — the box name, for the commands that take one. */
  readonly positionals: readonly string[];
  readonly path?: string;
  readonly agent?: string;
  readonly dryRun: boolean;
  readonly noAttach: boolean;
  readonly pr: boolean;
  readonly all: boolean;
}

/**
 * One pass, so a flag's value is never mistaken for the positional name:
 * `jig box new --agent codex` has no positional at all, and splitting flags
 * from positionals in two passes would read `codex` as one.
 */
function parseArgs(args: readonly string[]): ParsedArgs | { readonly error: string } {
  const positionals: string[] = [];
  let path: string | undefined;
  let agent: string | undefined;
  let dryRun = false;
  let noAttach = false;
  let pr = false;
  let all = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--no-attach") noAttach = true;
    else if (arg === "--pr") pr = true;
    else if (arg === "--all") all = true;
    else if (arg === "--path") path = args[++i];
    else if (arg.startsWith("--path=")) path = arg.slice("--path=".length);
    else if (arg === "--agent") agent = args[++i];
    else if (arg.startsWith("--agent=")) agent = arg.slice("--agent=".length);
    else if (arg.startsWith("-")) return { error: `unknown argument ${JSON.stringify(arg)}` };
    else positionals.push(arg);
  }

  return {
    positionals,
    ...(path === undefined ? {} : { path }),
    ...(agent === undefined ? {} : { agent }),
    dryRun,
    noAttach,
    pr,
    all,
  };
}

function render(result: BoxResult): BoxCliResult {
  const body = result.lines.join("\n");
  return { stdout: body === "" ? "" : `${body}\n`, code: result.code };
}

export async function boxCli(
  args: readonly string[],
  ports: BoxPorts,
  context: BoxCliContext,
): Promise<BoxCliResult> {
  const [subcommand, ...rest] = args;

  const flags = parseArgs(rest);
  if ("error" in flags) return { stdout: `jig box: ${flags.error}\n`, code: 2 };

  // `resume`, `fetch` and `rm` each take one box name.
  const positional = flags.positionals[0];
  const dryRun = context.dryRun || flags.dryRun;
  const path = flags.path ?? context.cwd;

  switch (subcommand) {
    case "new": {
      const agent = flags.agent ?? "claude";
      if (!(BOX_AGENTS as readonly string[]).includes(agent)) {
        return { stdout: `${agentError(agent)}\n`, code: 2 };
      }
      return render(
        await createBox(
          {
            agent: agent as BoxAgent,
            path,
            postureKitDir: flags.pr ? context.postureKits.connected : context.postureKits.guarded,
            dryRun,
            attach: !(context.noAttach || flags.noAttach),
          },
          ports,
        ),
      );
    }

    case "list": {
      // The repository root, not the caller's directory: a box is matched by
      // the workspace it was cloned from, and that is the root.
      const repoRoot = flags.all ? undefined : await ports.git.toplevel(path);
      const listed = await listBoxes(repoRoot === undefined ? {} : { repoPath: repoRoot }, ports);
      if (listed.error !== undefined) {
        return { stdout: `jig box list: sbx ls failed\n${listed.error}\n`, code: listed.code };
      }
      if (listed.boxes.length === 0) {
        return { stdout: "no boxes\n", code: 0 };
      }
      const lines = listed.boxes.map(
        (box) => `${box.name}\t${box.agent}\t${box.status}\t${box.lastUsedAt}`,
      );
      return { stdout: `${lines.join("\n")}\n`, code: 0 };
    }

    // `resume` and `rm` pass the repository along so the name is checked
    // against it: two checkouts sharing a basename derive the same name, and
    // attaching to — or deleting — the wrong one is silent otherwise. Outside
    // a repository there is nothing to check against, and the name stands.
    case "resume": {
      if (positional === undefined) return { stdout: "jig box resume: need a name\n", code: 2 };
      const repoRoot = await ports.git.toplevel(path);
      return render(
        await resumeBox(
          { name: positional, dryRun, ...(repoRoot === undefined ? {} : { repoRoot }) },
          ports,
        ),
      );
    }

    case "fetch": {
      if (positional === undefined) return { stdout: "jig box fetch: need a name\n", code: 2 };
      return render(await fetchBox({ name: positional, path }, ports));
    }

    case "rm": {
      if (positional === undefined) return { stdout: "jig box rm: need a name\n", code: 2 };
      const repoRoot = await ports.git.toplevel(path);
      return render(
        await removeBox(
          { name: positional, dryRun, ...(repoRoot === undefined ? {} : { repoRoot }) },
          ports,
        ),
      );
    }

    default:
      return { stdout: USAGE, code: subcommand === undefined ? 0 : 2 };
  }
}
