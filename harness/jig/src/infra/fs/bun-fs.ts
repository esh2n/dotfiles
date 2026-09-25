import type { FileSystem } from "../../domain/ports";

/** FileSystem port backed by Bun's file APIs. */
export class BunFileSystem implements FileSystem {
  async read(path: string): Promise<string> {
    return await Bun.file(path).text();
  }

  async write(path: string, data: string): Promise<void> {
    await Bun.write(path, data);
  }

  async exists(path: string): Promise<boolean> {
    return await Bun.file(path).exists();
  }
}
