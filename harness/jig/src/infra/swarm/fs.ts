/**
 * The Swarm's file operations on the real filesystem. `node:fs` rather than
 * Bun's API so the same code runs inside pi and omp, which embed their own
 * runtimes (the same reason as `infra/proc/exec-file.ts`).
 */

import { appendFile, copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { WorktreeFs } from "../../app/swarm/worktree";

export const nodeWorktreeFs: WorktreeFs = {
  async readFile(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  },
  async appendFile(path, text) {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, text, "utf8");
  },
  async copyFile(from, to) {
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  },
};
