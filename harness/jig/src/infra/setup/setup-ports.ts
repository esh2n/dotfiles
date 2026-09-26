/**
 * `SetupPorts` over the real machine. Warnings go to stdout with the report;
 * the build and link commands keep their stderr (activation's log is where a
 * failure is read) and drop their stdout;
 * `jig` runs the other subcommands in this same process.
 */

import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SetupPorts } from "../../app/setup/setup-harness";

export function createSetupPorts(jig: (argv: readonly string[]) => Promise<number>): SetupPorts {
  return {
    readText: async (path) => {
      try {
        return await readFile(path, "utf8");
      } catch {
        return undefined;
      }
    },
    writeText: async (path, text) => {
      await mkdir(dirname(path), { recursive: true });
      const staged = `${path}.tmp`;
      await writeFile(staged, text, "utf8");
      await rename(staged, path);
    },
    isDir: async (path) => {
      try {
        return (await stat(path)).isDirectory();
      } catch {
        return false;
      }
    },
    listDirs: async (path) => {
      try {
        const entries = await readdir(path, { withFileTypes: true });
        return entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort();
      } catch {
        return [];
      }
    },
    have: async (bin) => Bun.which(bin) !== null,
    run: async (bin, args, cwd) => {
      try {
        const proc = Bun.spawn([bin, ...args], { cwd, stdout: "ignore", stderr: "inherit" });
        return await proc.exited;
      } catch {
        return 127;
      }
    },
    // Each apply was its own process under the shell script; one that throws is a failed
    // step here too, never the end of the run.
    jig: async (argv) => {
      try {
        return await jig(argv);
      } catch (error) {
        process.stdout.write(
          `[WARN] jig setup: jig ${argv.join(" ")}: ${(error as Error).message}\n`,
        );
        return 1;
      }
    },
    warn: (message) => {
      // warnings are part of the run's report: stdout, like jig apply's
      process.stdout.write(`[WARN] jig setup: ${message}\n`);
    },
  };
}
