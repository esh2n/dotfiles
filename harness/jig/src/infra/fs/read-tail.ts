import { open } from "node:fs/promises";

/**
 * The last `bytes` of a file as text; a multi-byte character cut at the start decodes as
 * U+FFFD. A missing file is an error (Bun's `file().slice()` would answer "" instead).
 */
export async function readTail(path: string, bytes: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}
