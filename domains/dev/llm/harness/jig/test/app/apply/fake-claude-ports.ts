/**
 * An in-memory `ClaudeApplyPorts` for the apply tests: files, symlinks and
 * directories as three maps keyed by absolute path, so a test can stage
 * "`~/.claude/skills` is a symlink to yoki-switch's staging dir" and read back
 * what `--write` did to it. A directory exists when it was `mkdir`ed or when
 * anything lives under it; `listDir` follows a symlinked directory the way
 * `readdir` does, so a test can seed a link's target as well.
 */

import type { ClaudeApplyPorts, ProvenanceInfo } from "../../../src/app/apply/ports";
import type { PathState } from "../../../src/domain/claude/links";

export interface FakeClaudeFs {
  readonly ports: ClaudeApplyPorts;
  readonly files: Record<string, string>;
  /** path → target, verbatim. */
  readonly links: Record<string, string>;
  /** Explicitly created directories (those implied by a file's path need no entry). */
  readonly dirs: Set<string>;
  readonly manifest: Record<string, string>;
  readonly provenance: Record<string, ProvenanceInfo>;
}

export interface FakeClaudeFsSeed {
  readonly files?: Record<string, string>;
  readonly links?: Record<string, string>;
  readonly dirs?: readonly string[];
  readonly now?: Date;
}

export function fakeClaudeFs(seed: FakeClaudeFsSeed = {}): FakeClaudeFs {
  const files: Record<string, string> = { ...seed.files };
  const links: Record<string, string> = { ...seed.links };
  const dirs = new Set<string>(seed.dirs ?? []);
  const manifest: Record<string, string> = {};
  const provenance: Record<string, ProvenanceInfo> = {};
  const now = seed.now ?? new Date("2026-09-23T00:00:00.000Z");

  const under = (dir: string) => {
    const prefix = `${dir}/`;
    return [...Object.keys(files), ...Object.keys(links), ...dirs].filter((p) =>
      p.startsWith(prefix),
    );
  };
  const isDir = (path: string) => dirs.has(path) || under(path).length > 0;

  /** A path through a symlinked directory, resolved one hop — enough to list a staged target. */
  const resolve = (path: string): string => {
    for (const [link, target] of Object.entries(links)) {
      if (path === link) return target;
      if (path.startsWith(`${link}/`)) return `${target}${path.slice(link.length)}`;
    }
    return path;
  };

  const inspect = async (path: string): Promise<PathState> => {
    const target = links[path];
    if (target !== undefined) return { kind: "symlink", target };
    if (files[path] !== undefined) return { kind: "file" };
    if (isDir(path)) return { kind: "dir" };
    return { kind: "missing" };
  };

  const ports: ClaudeApplyPorts = {
    async readFile(path) {
      return files[resolve(path)];
    },
    async writeAtomic(path, content) {
      files[path] = content;
    },
    async listDir(path) {
      const dir = resolve(path);
      const names = new Set<string>();
      for (const p of under(dir)) {
        const rest = p.slice(dir.length + 1);
        names.add(rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : rest);
      }
      return [...names];
    },
    inspect,
    async symlink(target, path) {
      if ((await inspect(path)).kind !== "missing") throw new Error(`EEXIST: ${path}`);
      links[path] = target;
    },
    async rename(from, to) {
      const move = (record: Record<string, string>) => {
        for (const key of Object.keys(record)) {
          if (key === from || key.startsWith(`${from}/`)) {
            const value = record[key];
            delete record[key];
            if (value !== undefined) record[`${to}${key.slice(from.length)}`] = value;
          }
        }
      };
      move(files);
      move(links);
      for (const dir of [...dirs]) {
        if (dir === from || dir.startsWith(`${from}/`)) {
          dirs.delete(dir);
          dirs.add(`${to}${dir.slice(from.length)}`);
        }
      }
    },
    async remove(path) {
      if (links[path] !== undefined) {
        delete links[path];
        return;
      }
      for (const key of Object.keys(files)) {
        if (key === path || key.startsWith(`${path}/`)) delete files[key];
      }
      for (const key of Object.keys(links)) {
        if (key.startsWith(`${path}/`)) delete links[key];
      }
      for (const dir of [...dirs]) {
        if (dir === path || dir.startsWith(`${path}/`)) dirs.delete(dir);
      }
    },
    async mkdir(path) {
      dirs.add(path);
    },
    sha256(content) {
      let h = 0;
      for (let i = 0; i < content.length; i++) h = (h * 31 + content.charCodeAt(i)) | 0;
      return `fake:${h}`;
    },
    async readManifest() {
      return { ...manifest };
    },
    async writeManifest(next) {
      for (const key of Object.keys(manifest)) if (!(key in next)) delete manifest[key];
      Object.assign(manifest, next);
    },
    async writeProvenance(destDir, info) {
      provenance[destDir] = info;
    },
    now: () => now,
    jigVersion: "0.0.0-test",
  };

  return { ports, files, links, dirs, manifest, provenance };
}
