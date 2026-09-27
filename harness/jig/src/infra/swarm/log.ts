/**
 * The Swarm's record on disk, one directory per parent session under
 * `~/.local/state/jig/swarm/<session>/` (or `$XDG_STATE_HOME/jig/swarm/`):
 * `<name>.jsonl` is a worker's raw stream, `<name>.result.md` its final answer
 * in full, `events.jsonl` every state change. Nothing here is read back by the
 * Swarm (it does not resume across sessions); it is for the owner.
 *
 * The streams are appended through `fs.createWriteStream`, not a synchronous
 * write per line: the Swarm runs inside the parent harness, and eight workers
 * streaming at once must not stall the event loop that draws its screen.
 * Writes to one file stay in order; a crash loses at most what was still
 * buffered.
 */

import { type WriteStream, createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SwarmLog } from "../../app/swarm/ports";

export function swarmStateDir(env: NodeJS.ProcessEnv, session: string): string {
  const base =
    env.XDG_STATE_HOME !== undefined && env.XDG_STATE_HOME !== ""
      ? env.XDG_STATE_HOME
      : join(homedir(), ".local", "state");
  const safe = session.replace(/[^A-Za-z0-9._-]/g, "_") || "session";
  return join(base, "jig", "swarm", safe);
}

export function fileSwarmLog(dir: string): SwarmLog {
  let ready = false;
  const streams = new Map<string, WriteStream>();
  const ensure = () => {
    if (!ready) {
      mkdirSync(dir, { recursive: true });
      ready = true;
    }
  };
  const stream = (file: string): WriteStream => {
    let s = streams.get(file);
    if (s === undefined) {
      ensure();
      s = createWriteStream(join(dir, file), { flags: "a" });
      s.on("error", (error) => console.error(`swarm log ${file}: ${error.message}`));
      streams.set(file, s);
    }
    return s;
  };
  const safe = (name: string) => name.replace(/[^a-z0-9-]/g, "_");
  return {
    raw(name, line) {
      stream(`${safe(name)}.jsonl`).write(`${line}\n`);
    },
    result(name, text) {
      ensure();
      const path = join(dir, `${safe(name)}.result.md`);
      writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`);
      return path;
    },
    event(entry) {
      stream("events.jsonl").write(`${JSON.stringify(entry)}\n`);
    },
  };
}
