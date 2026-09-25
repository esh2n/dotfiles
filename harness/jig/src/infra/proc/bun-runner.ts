import type { CommandResult, ProcessRunner } from "../../domain/ports";

/** ProcessRunner port backed by Bun.spawn. */
export class BunProcessRunner implements ProcessRunner {
  async run(
    command: string,
    args: readonly string[],
    options?: { readonly cwd?: string },
  ): Promise<CommandResult> {
    const proc = Bun.spawn([command, ...args], {
      cwd: options?.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  }
}
