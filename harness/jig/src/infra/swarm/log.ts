/**
 * The Swarm's record on disk, one directory per parent session under
 * `~/.local/state/jig/swarm/<session>/` (or `$XDG_STATE_HOME/jig/swarm/`):
 * `<name>.jsonl` is a worker's raw stream, `<name>.result.md` its final answer
 * in full, `events.jsonl` every state change. Synchronous appends: a crash
 * mid-run still leaves what happened so far. Nothing here is read back by the
 * Swarm (it does not resume across sessions); it is for the owner.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
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
  const ensure = () => {
    if (!ready) {
      mkdirSync(dir, { recursive: true });
      ready = true;
    }
  };
  const safe = (name: string) => name.replace(/[^a-z0-9-]/g, "_");
  return {
    raw(name, line) {
      ensure();
      appendFileSync(join(dir, `${safe(name)}.jsonl`), `${line}\n`);
    },
    result(name, text) {
      ensure();
      const path = join(dir, `${safe(name)}.result.md`);
      writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`);
      return path;
    },
    event(entry) {
      ensure();
      appendFileSync(join(dir, "events.jsonl"), `${JSON.stringify(entry)}\n`);
    },
  };
}
