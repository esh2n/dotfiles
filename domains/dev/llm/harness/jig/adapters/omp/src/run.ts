/**
 * Running one external command, the way both the formatter and the gate need it:
 * never throwing, always bounded, and able to say "that program is not
 * installed" apart from "that program said no".
 *
 * `node:child_process` rather than `Bun.spawn` so the adapter can be
 * exercised and reasoned about outside omp's Bun runtime; no shell, so an
 * argument is an argument and never a command.
 */

import { execFile } from "node:child_process";

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** The binary was not on PATH — "not installed", not "failed". */
  readonly missing: boolean;
}

export type Runner = (
  bin: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs: number },
) => Promise<CommandResult>;

interface ExecError extends Error {
  readonly code?: number | string;
  readonly stdout?: string;
  readonly stderr?: string;
}

export const runCommand: Runner = (bin, args, options) =>
  new Promise<CommandResult>((resolve) => {
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
        const missing = err.code === "ENOENT";
        resolve({
          code: typeof err.code === "number" ? err.code : 1,
          stdout: err.stdout ?? stdout ?? "",
          stderr: err.stderr ?? stderr ?? err.message,
          missing,
        });
      },
    );
  });
