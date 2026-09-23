/**
 * `jig codex register [--write]` — put jig's guard in front of codex's
 * PreToolUse hooks and trust it. Without `--write` it only reports what
 * would change. Thin: argv and formatting; the work is in
 * `app/codex/register-codex.ts`.
 */

import type { ApplyPorts } from "../app/apply/ports";
import { type CodexPaths, registerCodex } from "../app/codex/register-codex";
import type { RegistrationInput } from "../domain/codex/register";

export interface CodexCliResult {
  readonly stdout: string;
  readonly code: number;
}

export async function codexCli(
  args: readonly string[],
  ports: Pick<ApplyPorts, "readFile" | "writeAtomic" | "sha256">,
  paths: CodexPaths,
  input: RegistrationInput,
  validateToml?: (text: string) => void,
): Promise<CodexCliResult> {
  const [subcommand, ...rest] = args;
  if (subcommand !== "register") {
    return { stdout: "usage: jig codex register [--write]\n", code: 2 };
  }
  let write = false;
  for (const arg of rest) {
    if (arg === "--write") write = true;
    else return { stdout: `unknown argument ${JSON.stringify(arg)}\n`, code: 2 };
  }

  try {
    const result = await registerCodex(ports, paths, input, {
      write,
      ...(validateToml === undefined ? {} : { validateToml }),
    });
    const lines = [
      `command:     ${input.command}`,
      `matcher:     ${input.matcher}`,
      `trust key:   ${result.key}`,
      `trust hash:  sha256:${result.hash}`,
      `hooks.json:  ${result.hooksJsonChanged ? "would change" : "up to date"} (${paths.hooksJson})`,
      `config.toml: ${result.configTomlChanged ? "would change" : "up to date"} (${paths.configToml})`,
    ];
    if (result.written) {
      lines.push(
        "written. jig's group is now PreToolUse[0]; every other group moved down one, so",
        "Codex may ask to re-trust them on next launch (yoki's groups go with `jig retire yoki --write`).",
      );
    } else if (result.hooksJsonChanged || result.configTomlChanged) {
      lines.push("dry run: nothing written. Re-run with --write to apply.");
    }
    return { stdout: `${lines.join("\n")}\n`, code: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: `jig codex register: ${message}\n`, code: 1 };
  }
}
