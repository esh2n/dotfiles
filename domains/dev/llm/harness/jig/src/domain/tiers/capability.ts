/**
 * The capability report every tiers writer (`./write-pi`, `./write-dsh`,
 * `./write-litellm`) returns alongside its generated content: which fields
 * of the canonical, upper-vocabulary schema (`./types.ts`) this target's
 * format cannot express, and why. `jig apply` prints this next to the diff
 * so a dropped field is visible, never a silent surprise.
 */

/** One canonical field a target's writer could not carry into its output. */
export interface DroppedField {
  /** Dotted path into the canonical schema, e.g. `"dsh.reasoningEfforts"` or `"backend"`. */
  readonly field: string;
  /** The tier alias this applies to, or `"*"` for a connection-level (not per-tier) field. */
  readonly tier: string;
  readonly reason: string;
}

/** A writer's output: the generated text plus what it had to leave out. */
export interface WriteResult {
  readonly content: string;
  readonly dropped: readonly DroppedField[];
}
