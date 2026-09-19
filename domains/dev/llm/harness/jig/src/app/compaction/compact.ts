import { type DecisionProvider, gate } from "../../domain/decision/provider";

export interface Item {
  readonly id: string;
  readonly summary: string;
  readonly pinned?: boolean;
}

export interface CompactOptions {
  readonly threshold?: number;
  readonly preserveRecent?: number;
}

export interface CompactionDecision {
  readonly id: string;
  readonly kept: boolean;
  readonly confidence: number;
  readonly source: "pinned" | "decided" | "fallback";
}

export interface CompactionResult {
  readonly kept: readonly Item[];
  readonly decisions: readonly CompactionDecision[];
}

/**
 * Memory compaction use-case. Pin the first item and the most recent N (never
 * dropped), then judge the remaining items in ONE batch: the batch's material is
 * the item list itself, so the judgment model sees the whole context instead of a
 * bare question, and one round trip covers up to 32 items instead of one round
 * trip per item.
 *
 * Each judgment is gated by confidence with the safe fallback being *keep* (never
 * lose context on a weak judgment). The default threshold is 0.6, not 0.5: when a
 * provider derives confidence from a probability (noul), the threshold IS the dead
 * band `1-T < p < T`, so 0.5 would mean "every judgment is good enough" and the
 * conservative fallback could never fire.
 *
 * The pin-recent + per-item keep-decision + threshold shape is adapted from the
 * reference project github.com/tamaratran/fast-jev-compaction (MIT) — its design,
 * re-expressed against jig's own port; no code is copied.
 */
export async function compact(
  items: readonly Item[],
  provider: DecisionProvider,
  options: CompactOptions = {},
): Promise<CompactionResult> {
  const threshold = options.threshold ?? 0.6;
  const preserveRecent = options.preserveRecent ?? 2;
  const pinnedFrom = items.length - preserveRecent;

  // Which items are never asked about (pinned), and which are judged together.
  const pinned = new Set<number>();
  const candidates: Item[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item === undefined) continue;
    if (index === 0 || index >= pinnedFrom || item.pinned === true) pinned.add(index);
    else candidates.push(item);
  }

  const judgments =
    candidates.length === 0
      ? []
      : await provider.boolBatch(
          {
            material: materialOf(items),
            prompts: candidates.map((item) => `Keep item "${item.id}" verbatim?`),
          },
          {},
        );

  const decisions: CompactionDecision[] = [];
  const kept: Item[] = [];
  let candidate = 0;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item === undefined) continue;

    if (pinned.has(index)) {
      decisions.push({ id: item.id, kept: true, confidence: 1, source: "pinned" });
      kept.push(item);
      continue;
    }

    const decided = judgments[candidate];
    candidate += 1;
    if (decided === undefined) {
      throw new Error(
        `provider returned ${judgments.length} judgments for ${candidates.length} items`,
      );
    }

    const gated = gate(decided, threshold, true);
    decisions.push({
      id: item.id,
      kept: gated.value,
      confidence: gated.confidence,
      source: gated.source,
    });
    if (gated.value) kept.push(item);
  }

  return { kept, decisions };
}

/**
 * The material one batch is judged against: every item in order, with its summary.
 * A model cannot judge "keep item x?" without seeing the items around it, so the
 * list is sent once as the material rather than repeated inside each question.
 */
function materialOf(items: readonly Item[]): string {
  return items
    .map((item) => `- [${item.id}]${item.pinned === true ? " (pinned)" : ""} ${item.summary}`)
    .join("\n");
}
