/**
 * Where a rendered kit lands: a temp directory per box name, wiped and
 * rewritten on every launch. The kit is never installed anywhere durable on
 * purpose — it is a function of the caller's checkout, so a stored copy would
 * be wrong the moment jig is run from a different one.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { KitWriter } from "../../app/box/ports";

export function createKitWriter(root: string = join(tmpdir(), "jig-box")): KitWriter {
  return {
    async write(name: string, files: Readonly<Record<string, string>>): Promise<string> {
      const dir = join(root, name);
      // Fresh every launch: a file left over from a previous kit would still
      // be copied into the box, and nothing else would ever remove it.
      await rm(dir, { recursive: true, force: true });
      for (const [relative, content] of Object.entries(files)) {
        const path = join(dir, relative);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content, "utf8");
      }
      return dir;
    },
  };
}
