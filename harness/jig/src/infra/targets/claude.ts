import type { ComposedProfile, FileSystem, TargetWriter } from "../../domain/ports";

/**
 * TargetWriter for Claude Code: write the composed settings as `settings.json`
 * in the claude directory. IO goes through the `FileSystem` port, so the writer
 * is tested with an in-memory fake.
 */
export class ClaudeTargetWriter implements TargetWriter {
  readonly target = "claude";

  constructor(
    private readonly fs: FileSystem,
    private readonly claudeDir: string,
  ) {}

  async write(profile: ComposedProfile): Promise<void> {
    const path = `${this.claudeDir}/settings.json`;
    await this.fs.write(path, `${JSON.stringify(profile.settings, null, 2)}\n`);
  }
}
