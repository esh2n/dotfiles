/**
 * The hand-edit-detection decision for `jig apply --write`, Stow-style:
 * compare what's currently at the destination against both (a) the hash
 * `jig` recorded the last time it wrote there (the apply manifest) and
 * (b) what it would write now. Pure — no IO, no hashing algorithm choice
 * baked in (the caller injects `sha256` so this stays testable without a
 * real crypto call and swappable if the hash ever changes).
 */

export type PlanAction = "write" | "noop" | "conflict";

export interface PlanApplyInput {
  /** `undefined` when the destination file doesn't exist yet. */
  readonly currentContent: string | undefined;
  readonly generatedContent: string;
  /** `undefined` when there is no manifest entry for this destination yet (first run). */
  readonly manifestHash: string | undefined;
  readonly sha256: (content: string) => string;
}

export interface PlanApplyResult {
  readonly action: PlanAction;
}

export function planApply(input: PlanApplyInput): PlanApplyResult {
  const { currentContent, generatedContent, manifestHash, sha256 } = input;

  if (currentContent === undefined) {
    return { action: "write" };
  }

  const matchesGenerated = currentContent === generatedContent;

  if (manifestHash === undefined) {
    // First run for this dest: nothing to compare a hand-edit against, so
    // proceed like a normal write.
    return { action: matchesGenerated ? "noop" : "write" };
  }

  const matchesManifest = sha256(currentContent) === manifestHash;

  if (matchesManifest) {
    return { action: matchesGenerated ? "noop" : "write" };
  }

  // Hand-edited since the last apply. Only a real conflict if it ALSO
  // doesn't match what we'd write now — if it already happens to match,
  // there is nothing to do (and nothing to abort over).
  return { action: matchesGenerated ? "noop" : "conflict" };
}
