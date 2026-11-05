import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Records `key` in a newline-separated file and answers whether it was new. Only the last
 * `keep` keys are kept, so the file stays a few kilobytes however long it is used.
 */
export async function claimOnce(path: string, key: string, keep: number): Promise<boolean> {
  let keys: readonly string[];
  try {
    keys = (await readFile(path, "utf8")).split("\n").filter((line) => line !== "");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    keys = [];
  }
  if (keys.includes(key)) return false;
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${[...keys.slice(-(keep - 1)), key].join("\n")}\n`);
  await rename(temp, path);
  return true;
}
