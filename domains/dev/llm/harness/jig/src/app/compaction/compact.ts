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
 * dropped), then ask the decision provider whether each remaining item should be
 * kept — gated by confidence, with the safe fallback being *keep* (never lose
 * context on a low-confidence judgment). Depends only on the DecisionProvider
 * port, so jev, a local model, or a rule provider all slot in.
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
  const threshold = options.threshold ?? 0.5;
  const preserveRecent = options.preserveRecent ?? 2;
  const pinnedFrom = items.length - preserveRecent;

  const decisions: CompactionDecision[] = [];
  const kept: Item[] = [];

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item === undefined) continue;

    const isPinned = item.pinned === true || index === 0 || index >= pinnedFrom;
    if (isPinned) {
      decisions.push({ id: item.id, kept: true, confidence: 1, source: "pinned" });
      kept.push(item);
      continue;
    }

    const decided = await provider.bool(
      { prompt: "Should this item be kept verbatim?" },
      { id: item.id, summary: item.summary },
    );
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
