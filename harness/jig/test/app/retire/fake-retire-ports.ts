/**
 * An in-memory `RetirePorts` on top of the apply tests' fake filesystem:
 * the same three maps (files, links, directories), plus the three removal
 * verbs with the adapter's refusals — a link verb on a file, a file verb on
 * a link, a tree holding a regular file outside `.yoki/` — and a log of
 * every removal in the order it happened, so a test can pin "files and
 * links first, rewrites, directories last".
 */

import type { RetirePorts } from "../../../src/app/retire/ports";
import { type FakeClaudeFs, type FakeClaudeFsSeed, fakeClaudeFs } from "../apply/fake-claude-ports";

export interface FakeRetireFs extends FakeClaudeFs {
  readonly retire: RetirePorts;
  /** `remove-link <path>`, `remove-file <path>`, `remove-tree <path>`, `rename <from> <to>`, `write <path>`. */
  readonly log: string[];
}

export function fakeRetireFs(seed: FakeClaudeFsSeed = {}): FakeRetireFs {
  const fake = fakeClaudeFs(seed);
  const { files, links, dirs, ports } = fake;
  const log: string[] = [];

  const under = (dir: string) =>
    [...Object.keys(files), ...Object.keys(links), ...dirs].filter((p) => p.startsWith(`${dir}/`));
  const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  // A real filesystem keeps a directory once its last entry goes; this one
  // infers directories from their entries, so the parent is pinned instead.
  const keepParent = (path: string) => dirs.add(path.slice(0, Math.max(path.lastIndexOf("/"), 0)));

  const retire: RetirePorts = {
    readFile: ports.readFile,
    async writeAtomic(path, content) {
      log.push(`write ${path}`);
      await ports.writeAtomic(path, content);
    },
    listDir: ports.listDir,
    inspect: ports.inspect,
    async rename(from, to) {
      log.push(`rename ${from} ${to}`);
      await ports.rename(from, to);
    },
    async removeLink(path) {
      if (links[path] === undefined) throw new Error(`removeLink: ${path} is not a symlink`);
      delete links[path];
      keepParent(path);
      log.push(`remove-link ${path}`);
    },
    async removeFile(path) {
      if (files[path] === undefined || links[path] !== undefined) {
        throw new Error(`removeFile: ${path} is not a regular file`);
      }
      delete files[path];
      keepParent(path);
      log.push(`remove-file ${path}`);
    },
    async removeTree(path) {
      if ((await ports.inspect(path)).kind !== "dir") {
        throw new Error(`removeTree: ${path} is not a directory`);
      }
      const offending = Object.keys(files).filter((file) => {
        if (!file.startsWith(`${path}/`)) return false;
        if (basename(path) === ".yoki") return false;
        return !file
          .slice(path.length + 1)
          .split("/")
          .includes(".yoki");
      });
      if (offending.length > 0) {
        throw new Error(
          `removeTree: ${path} holds ${offending.length} regular files outside .yoki/; refused`,
        );
      }
      for (const key of under(path)) {
        delete files[key];
        delete links[key];
        dirs.delete(key);
      }
      dirs.delete(path);
      log.push(`remove-tree ${path}`);
    },
    now: ports.now,
  };

  return { ...fake, retire, log };
}
