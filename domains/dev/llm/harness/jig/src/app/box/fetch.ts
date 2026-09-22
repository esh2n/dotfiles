/**
 * `jig box fetch <name>` — the only way work leaves a box.
 *
 * The box runs a git daemon that sbx publishes on a host port, and that port
 * is different on every start, so it is read now and never remembered. The
 * fetch is one-way by construction: the host pulls into
 * `refs/remotes/sandbox-<name>/`, and nothing in the box can reach back.
 */

import { listBoxes, locateBox } from "./list";
import type { BoxPorts, BoxResult } from "./ports";
import { fetchArgs, gitDaemonPort, wakeArgs } from "./sbx";

export interface FetchBoxInput {
  readonly name: string;
  /** Any directory inside the repository the refs should land in. */
  readonly path: string;
}

export async function fetchBox(input: FetchBoxInput, ports: BoxPorts): Promise<BoxResult> {
  const repoRoot = await ports.git.toplevel(input.path);
  if (repoRoot === undefined) {
    return { lines: [`jig box fetch: ${input.path} is not inside a git repository`], code: 2 };
  }

  // Refuse a box from a different checkout outright: fetching another
  // repository's branches into this one would be quietly wrong.
  const located = await locateBox("jig box fetch", input.name, repoRoot, ports);
  if ("failure" in located) return located.failure;

  let port = gitDaemonPort([located.box], input.name);
  if (port === undefined) {
    // A stopped box publishes no ports. Waking it is cheap and the only way
    // to reach the daemon, so do it rather than telling the caller to.
    const woken = await ports.sbx.run(wakeArgs(input.name));
    if (woken.code !== 0) {
      return {
        lines: [`jig box fetch: could not start ${input.name}`, woken.stderr.trimEnd()],
        code: woken.code,
      };
    }
    const again = await listBoxes({}, ports);
    port = gitDaemonPort(again.boxes, input.name);
  }
  if (port === undefined) {
    return {
      lines: [
        `jig box fetch: ${input.name} publishes no git daemon port even after starting it`,
        "a box created without --clone has no git daemon; its work cannot be fetched.",
      ],
      code: 1,
    };
  }

  const args = fetchArgs({ repoRoot, name: input.name, port });
  const fetched = await ports.git.run(args, repoRoot);
  if (fetched.code !== 0) {
    return {
      lines: [`jig box fetch: git fetch failed (exit ${fetched.code})`, fetched.stderr.trimEnd()],
      code: fetched.code,
    };
  }
  return {
    lines: [
      `fetched ${input.name} into refs/remotes/sandbox-${input.name}/*`,
      `review it with: git log --oneline main..sandbox-${input.name}/<branch>`,
    ],
    code: 0,
  };
}
