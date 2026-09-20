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
 * The question is whether an item is REPRODUCIBLE — whether re-running what
 * produced it would produce it again. The obvious wording ("keep item X
 * verbatim?") was measured against the live judgment model and answers keep for
 * everything (0.59-0.77 on every item, including a byte-identical duplicate of a
 * 31k-char tool result), so it spends a judgment and decides nothing. Asking for
 * reproducibility instead answers the question that matters — a tool result whose
 * command can be re-run is the material worth dropping, an ask or a conclusion is
 * not — at confidence 0.69-0.95 on the same input, in the same single round trip.
 *
 * The answer therefore INVERTS: `true` means reproducible, i.e. droppable. Each
 * judgment is gated by confidence with the safe fallback being *keep* (never lose
 * context on a weak judgment), so an unsure answer about reproducibility keeps the
 * item. The default threshold is 0.6, not 0.5: when a provider derives confidence
 * from a probability (noul), the threshold IS the dead band `1-T < p < T`, so 0.5
 * would mean "every judgment is good enough" and the conservative fallback could
 * never fire.
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
            prompts: candidates.map((item) => reproducibilityQuestion(item.id)),
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

    // `true` = reproducible = droppable, so the safe fallback is `false` (keep).
    const gated = gate(decided, threshold, false);
    decisions.push({
      id: item.id,
      kept: !gated.value,
      confidence: gated.confidence,
      source: gated.source,
    });
    if (!gated.value) kept.push(item);
  }

  return { kept, decisions };
}

/**
 * The question one item is judged by, in the wording that was measured to
 * discriminate. It says what to answer for the cases the material cannot settle
 * (anything that is not a tool result), because a model left to guess about an ask
 * drops the ask.
 */
function reproducibilityQuestion(id: string): string {
  return `Is item "${id}" reproducible by running the same tool call again? Answer true only for a tool result whose content the same command or read would produce again; answer false for anything that is not a tool result.`;
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
