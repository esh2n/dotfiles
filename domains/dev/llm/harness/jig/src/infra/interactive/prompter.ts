/**
 * The terminal side of `jig` with no arguments: numbered menus over Bun's
 * global `prompt()`. Numbered rather than arrow-key driven on purpose —
 * there is no TUI to maintain, it works over ssh and in a box, and an empty
 * answer means "never mind" everywhere.
 */

import type { Prompter } from "../../cli/interactive";

export function createPrompter(): Prompter {
  return {
    async select(title: string, options: readonly string[]): Promise<number | undefined> {
      process.stdout.write(`\n${title}\n`);
      options.forEach((option, index) => {
        process.stdout.write(`  ${index + 1}) ${option}\n`);
      });
      const answer = prompt("> ");
      if (answer === null) return undefined;
      const choice = Number.parseInt(answer.trim(), 10);
      if (!Number.isInteger(choice) || choice < 1 || choice > options.length) return undefined;
      return choice - 1;
    },

    async confirm(question: string): Promise<boolean> {
      const answer = prompt(`${question} [y/N] `);
      return answer !== null && /^y(es)?$/i.test(answer.trim());
    },
  };
}

/** Whether a command is on PATH — `Bun.which` returns its path or null. */
export async function commandExists(command: string): Promise<boolean> {
  return Bun.which(command) !== null;
}

/** Start a harness on the host with the terminal handed straight to it. */
export async function spawnHarness(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<number> {
  const proc = Bun.spawn([command, ...args], {
    cwd,
    stdio: ["inherit", "inherit", "inherit"],
  });
  return await proc.exited;
}
