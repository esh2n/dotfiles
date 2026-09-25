/**
 * Real `ApplyPorts` adapter: node's fs/promises + crypto. Atomic writes stage
 * to `<path>.jig-stage` then `rename` over the destination (same-filesystem
 * rename is atomic on every platform this runs on) — used for the target
 * files themselves and for the manifest, so a crash mid-write never leaves a
 * half-written file where `jig apply` (or dsh's Web Models page) will read it.
 */

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { ClaudeApplyPorts, ProvenanceInfo } from "../../app/apply/ports";
import type { RetirePorts } from "../../app/retire/ports";
import type { PathState } from "../../domain/claude/links";

function isErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function isEnoent(error: unknown): boolean {
  return isErrorCode(error, "ENOENT");
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

/** The one directory name whose regular files `removeTree` may take: yoki's own state. */
const YOKI_STATE_DIR = ".yoki";

/**
 * The regular files under `root`, as paths relative to it, symlinks not
 * followed. Only the ones outside any `.yoki/` component count — those are
 * the files a tree removal must refuse.
 */
async function regularFilesOutsideYoki(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      const rel = relative(root, path);
      const insideYoki =
        basename(root) === YOKI_STATE_DIR || rel.split("/").includes(YOKI_STATE_DIR);
      if (!insideYoki) found.push(rel);
    }
  };
  await walk(root);
  return found;
}

export function createNodeApplyFs(options: NodeApplyFsOptions): ClaudeApplyPorts & RetirePorts {
  const manifestPath = join(options.stateDir, "apply-manifest.json");

  return {
    readFile: readTextOrUndefined,

    writeAtomic: writeAtomicFile,

    // Forgiving on purpose: the directory this lists is a source of *extra*
    // lines in a generated document, so "no directory" is "no lines", not a
    // failed apply.
    async listDir(path: string): Promise<readonly string[]> {
      try {
        return await readdir(path);
      } catch {
        return [];
      }
    },

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

    // ENOTDIR is `missing` too: a path that runs through a regular file
    // (`skills/README.md/SKILL.md`) names nothing, exactly as a path whose
    // parent does not exist names nothing.
    async inspect(path: string): Promise<PathState> {
      let stat: Awaited<ReturnType<typeof lstat>>;
      try {
        stat = await lstat(path);
      } catch (error) {
        if (isEnoent(error) || isErrorCode(error, "ENOTDIR")) return { kind: "missing" };
        throw error;
      }
      if (stat.isSymbolicLink()) return { kind: "symlink", target: await readlink(path) };
      if (stat.isDirectory()) return { kind: "dir" };
      return { kind: "file" };
    },

    symlink: (target: string, path: string) => symlink(target, path),

    rename: (from: string, to: string) => rename(from, to),

    // `lstat` first so a symlink to a directory is unlinked as a link: `rm -r`
    // on the link would also only remove the link, but saying it here keeps
    // the promise in the port ("never what it points at") visible.
    async remove(path: string): Promise<void> {
      const stat = await lstat(path);
      if (stat.isDirectory()) await rm(path, { recursive: true });
      else await unlink(path);
    },

    async mkdir(path: string): Promise<void> {
      await mkdir(path, { recursive: true });
    },

    // The three retire verbs each check the kind of path before acting: the
    // use-case classified it, and the adapter will not act on a different kind
    // than the one the classification named.
    async removeLink(path: string): Promise<void> {
      const stat = await lstat(path);
      if (!stat.isSymbolicLink()) throw new Error(`removeLink: ${path} is not a symlink`);
      await unlink(path);
    },

    async removeFile(path: string): Promise<void> {
      const stat = await lstat(path);
      if (!stat.isFile()) throw new Error(`removeFile: ${path} is not a regular file`);
      await unlink(path);
    },

    async removeTree(path: string): Promise<void> {
      const stat = await lstat(path);
      if (!stat.isDirectory()) throw new Error(`removeTree: ${path} is not a directory`);
      const files = await regularFilesOutsideYoki(path);
      if (files.length > 0) {
        throw new Error(
          `removeTree: ${path} holds ${files.length} regular file${files.length === 1 ? "" : "s"} outside .yoki/ (${files.slice(0, 5).join(", ")}${files.length > 5 ? ", …" : ""}); refused`,
        );
      }
      await rm(path, { recursive: true });
    },

    now: () => new Date(),
    jigVersion: options.jigVersion,
  };
}
