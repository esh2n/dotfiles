// cli.mjs — the entry-point guard and the failure path both scripts share.
//
// `isMain` compares realpaths on both sides: this skill is reached through
// `~/.claude/skills/yoki-artifact`, a symlink into the dotfiles repo, so
// `process.argv[1]` keeps the symlinked path while `import.meta.url` resolves
// to the real file. Comparing the strings directly makes the guard false and
// the CLI exits 0 having done nothing (writeup-kit hit exactly this).

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { ApiError } from "./cf-api.mjs";
import { SetupError } from "./env.mjs";

const realpathOr = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

export function isMain(importMetaUrl) {
  return realpathOr(resolve(process.argv[1] ?? "")) === realpathOr(fileURLToPath(importMetaUrl));
}

/** Print a failure the way an operator can act on, and return an exit code. */
export function reportFailure(err, label, io = { err: console.error }) {
  if (err instanceof SetupError) {
    io.err(`${label} failed: ${err.message}`);
    if (err.hint) io.err(err.hint);
  } else if (err instanceof ApiError) {
    io.err(`${label} failed: ${err.message}`);
  } else {
    io.err(`${label} failed:`, err instanceof Error ? (err.stack ?? err.message) : err);
  }
  return 1;
}

/** Run a `main(argv)` as a process: exit code out, no unhandled rejection. */
export function runCli(main, label) {
  main().then(
    (code) => process.exit(code ?? 0),
    (err) => process.exit(reportFailure(err, label)),
  );
}
