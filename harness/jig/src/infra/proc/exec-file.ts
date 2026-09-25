/**
 * The `Runner` port, backed by `node:child_process`'s `execFile`: never
 * throwing, always bounded, and able to say "that program is not installed"
 * apart from "that program said no".
 *
 * `node:child_process` rather than `Bun.spawn` so the same adapter works
 * inside a harness that embeds jig in its own runtime (pi, omp, DSH) as well
 * as in jig's own CLI. No shell, so an argument is an argument and never a
 * command.
 */

import { execFile } from "node:child_process";
import type { RunResult, Runner } from "../../domain/hooks/run";

interface ExecError extends Error {
  readonly code?: number | string;
  readonly stdout?: string;
  readonly stderr?: string;
}

export const runCommand: Runner = (bin, args, options) =>
  new Promise<RunResult>((resolve) => {
    execFile(
      bin,
      [...args],
      { cwd: options.cwd, timeout: options.timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr, missing: false });
          return;
        }
        const err = error as ExecError;
        resolve({
          code: typeof err.code === "number" ? err.code : 1,
          stdout: err.stdout ?? stdout ?? "",
          stderr: err.stderr ?? stderr ?? err.message,
          missing: err.code === "ENOENT",
        });
      },
    );
  });
