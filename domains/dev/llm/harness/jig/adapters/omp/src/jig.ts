/**
 * How this extension reaches jig's core.
 *
 * omp discovers an extension by path and loads the file it finds there
 * (`~/.omp/agent/extensions/*`, a project `.omp/extensions/*`, or `-e`). The
 * generator links THIS file's directory into that root, so at runtime the
 * module is reached through a symlink, and a relative `import` would resolve
 * against wherever the link sits rather than against the repo. The pi
 * extension solved that the same way and for the same reason: find jig's
 * source tree from this file's REAL path and import it dynamically. Type-only
 * imports elsewhere in the adapter are erased at compile time, so they cost
 * nothing at runtime.
 *
 * The DSH adapter bundles instead (`bun build --target node`) because dsh
 * loads plain JS. omp runs on Bun and loads TypeScript directly — the same
 * way the retiring `yoki-bridge.ts` is loaded today — so a bundle here would
 * only add a build step whose output could drift from the core it copies.
 */

import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Environment = typeof import("../../../src/app/hooks/environment");
type RunHook = typeof import("../../../src/app/hooks/run-hook");
type Parse = typeof import("../../../src/domain/policy/parse");
type Audit = typeof import("../../../src/infra/audit/jsonl-audit");
type SessionLog = typeof import("../../../src/infra/logs/session-log");

export interface Jig {
  readonly env: Environment;
  readonly hook: RunHook;
  readonly parse: Parse;
  readonly audit: Audit;
  readonly sessions: SessionLog;
}

/** jig's source tree, found from where this file really lives. */
export const JIG_SRC = join(
  dirname(realpathSync(fileURLToPath(import.meta.url))),
  "..",
  "..",
  "..",
  "src",
);

let modules: Promise<Jig> | undefined;

/**
 * The core, loaded once. A failure is NOT cached: a half-installed repo that
 * is fixed mid-session must recover on the next call rather than block every
 * tool call until omp restarts.
 */
export function jig(): Promise<Jig> {
  modules ??= (async () => {
    try {
      return {
        env: (await import(join(JIG_SRC, "app", "hooks", "environment.ts"))) as Environment,
        hook: (await import(join(JIG_SRC, "app", "hooks", "run-hook.ts"))) as RunHook,
        parse: (await import(join(JIG_SRC, "domain", "policy", "parse.ts"))) as Parse,
        audit: (await import(join(JIG_SRC, "infra", "audit", "jsonl-audit.ts"))) as Audit,
        sessions: (await import(join(JIG_SRC, "infra", "logs", "session-log.ts"))) as SessionLog,
      };
    } catch (error) {
      modules = undefined;
      throw error;
    }
  })();
  return modules;
}
