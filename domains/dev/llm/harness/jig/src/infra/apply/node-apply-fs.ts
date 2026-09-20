/**
 * Real `ApplyPorts` adapter: node's fs/promises + crypto. Atomic writes stage
 * to `<path>.jig-stage` then `rename` over the destination (same-filesystem
 * rename is atomic on every platform this runs on) — used for the target
 * files themselves and for the manifest, so a crash mid-write never leaves a
 * half-written file where `jig apply` (or dsh's Web Models page) will read it.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ApplyPorts, ProvenanceInfo } from "../../app/apply/ports";

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function readTextOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw error;
  }
}

async function writeAtomicFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const stagePath = `${path}.jig-stage`;
  await writeFile(stagePath, content, "utf8");
  await rename(stagePath, path);
}

export interface NodeApplyFsOptions {
  /** Directory holding `apply-manifest.json` (default: `~/.local/state/jig`, override via `JIG_STATE_DIR` at the call site). */
  readonly stateDir: string;
  readonly jigVersion: string;
}

export function createNodeApplyFs(options: NodeApplyFsOptions): ApplyPorts {
  const manifestPath = join(options.stateDir, "apply-manifest.json");

  return {
    readFile: readTextOrUndefined,

    writeAtomic: writeAtomicFile,

    sha256(content: string): string {
      return createHash("sha256").update(content, "utf8").digest("hex");
    },

    async readManifest(): Promise<Record<string, string>> {
      const text = await readTextOrUndefined(manifestPath);
      if (text === undefined) return {};
      return JSON.parse(text) as Record<string, string>;
    },

    async writeManifest(manifest: Readonly<Record<string, string>>): Promise<void> {
      await mkdir(options.stateDir, { recursive: true });
      await writeAtomicFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    },

    async writeProvenance(destDir: string, info: ProvenanceInfo): Promise<void> {
      await mkdir(destDir, { recursive: true });
      await writeFile(
        join(destDir, ".jig-provenance.json"),
        `${JSON.stringify(info, null, 2)}\n`,
        "utf8",
      );
    },

    now: () => new Date(),
    jigVersion: options.jigVersion,
  };
}
