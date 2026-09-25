import { type PermissionsSidecar, composeSettings } from "../../domain/compose/compose";
import { type LayerSelectionInput, selectLayers } from "../../domain/compose/layers";
import type { JsonObject } from "../../domain/compose/merge";
import type { Logger, TargetWriter } from "../../domain/ports";

/** Everything the use-case needs: which profile, and the two compiled sidecars. */
export interface InstallInput {
  readonly selection: LayerSelectionInput;
  readonly permissions: PermissionsSidecar;
  readonly mcpServers: JsonObject;
}

export interface InstallDeps {
  readonly logger: Logger;
}

/**
 * Application use-case: select the layers, compose the settings once, then hand
 * the same composed profile to every target writer. Depends only on the domain
 * compose logic and the `TargetWriter` / `Logger` ports — no IO of its own — so
 * it is tested with fake writers.
 *
 * Still missing on purpose (no premature ports): where the sidecars come from
 * (permissions.yaml is compiled by infra), the template pass, the `.autoMode`
 * carry-over, and the symlink/merge-dir part of `apply`.
 *
 * Not yet wired to a CLI command — this is staged ahead of the `install` /
 * `apply --target claude` command that will call it, on purpose, not an
 * oversight.
 */
export async function installProfile(
  input: InstallInput,
  writers: readonly TargetWriter[],
  deps: InstallDeps,
): Promise<void> {
  const selection = selectLayers(input.selection);
  for (const pack of selection.skipped) {
    // A missing pack definition is not fatal: log it and apply the rest, so it
    // cannot be missed.
    deps.logger.warn("pack.skipped", { pack });
  }

  const settings = composeSettings({
    ...selection,
    permissions: input.permissions,
    mcpServers: input.mcpServers,
  });
  for (const writer of writers) {
    await writer.write({ settings });
    deps.logger.info("target.written", { target: writer.target });
  }
}
