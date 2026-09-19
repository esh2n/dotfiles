import { type ComposeInput, composeSettings } from "../../domain/compose/layers";
import type { Logger, TargetWriter } from "../../domain/ports";

export interface InstallDeps {
  readonly logger: Logger;
}

/**
 * Application use-case: compose the profile once, then write it to every target.
 * Depends only on the domain compose logic and the `TargetWriter` / `Logger`
 * ports — no IO of its own — so it is tested with fake writers.
 */
export async function installProfile(
  input: ComposeInput,
  writers: readonly TargetWriter[],
  deps: InstallDeps,
): Promise<void> {
  const settings = composeSettings(input);
  for (const writer of writers) {
    await writer.write({ settings });
    deps.logger.info("target.written", { target: writer.target });
  }
}
