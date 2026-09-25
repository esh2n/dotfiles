/**
 * The managed-block markers `spliceManagedBlock` looks for. Shared by the
 * dsh and litellm writers so both generated subtrees are found and replaced
 * the same way, and by `jig apply` when it decides whether a target's file
 * is ready to be written (markers absent = not wired up yet).
 */

import type { SpliceMarkers } from "./splice";

export const TIERS_MANAGED_BLOCK_MARKERS: SpliceMarkers = {
  begin: "# BEGIN jig:tiers (generated — edit policy/tiers.json, then jig apply)",
  end: "# END jig:tiers",
};
