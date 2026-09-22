/**
 * The `sbx` adapter. Two things it does beyond spawning:
 *
 * 1. It removes `SSH_AUTH_SOCK` from the child's environment, because sbx's
 *    documentation says the host agent is forwarded "when SSH_AUTH_SOCK is
 *    set". Measured on v0.43.0 (2026-09-22), that is NOT sufficient: with and
 *    without it, `/run/ssh-agent.sock` exists inside the box and answers, so
 *    what is forwarded is the daemon's agent, not the CLI's. The stripping
 *    stays as the cheap half of the defense; the half that actually holds is
 *    `createBox`'s refusal while `ssh.agentForwardingEnabled` is on.
 * 2. `attach` inherits stdio, because the agent owns the terminal from there.
 */

import type { SbxRunner } from "../../app/box/ports";
import type { CommandResult } from "../../domain/ports";

const SBX = "sbx";

/** The environment an sbx child gets: this process's, minus the SSH agent handle. */
export function sbxEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "SSH_AUTH_SOCK") continue;
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export function createSbxRunner(): SbxRunner {
  return {
    async run(args: readonly string[]): Promise<CommandResult> {
      const proc = Bun.spawn([SBX, ...args], {
        env: sbxEnvironment(),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, stdout, stderr };
    },

    async attach(args: readonly string[]): Promise<number> {
      const proc = Bun.spawn([SBX, ...args], {
        env: sbxEnvironment(),
        stdio: ["inherit", "inherit", "inherit"],
      });
      return await proc.exited;
    },
  };
}
