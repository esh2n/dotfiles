/**
 * What one router judgment wrote down.
 *
 * The shape is shared by both writers (the Claude Code hook deciding client-side and the
 * judgment service answering `/skill`) so that a report can read either without knowing
 * which path produced the line. `harness` is the harness the judgment was made for, and it
 * is a plain string rather than an enum on purpose: it names whoever asked, and a new
 * harness must be able to appear in this log without a jig release.
 */
export interface RouterLogEntry {
  readonly at: string;
  /** Which harness this judgment was made for (`claude`, `pi`, `dsh`, …). */
  readonly harness: string;
  /** Twelve hex characters identifying the prompt, so repeats can be grouped. */
  readonly promptHash: string;
  readonly promptChars: number;
  /** How many skills the router was choosing from, when the deciding side knows. */
  readonly candidates?: number;
  /**
   * The skills the router put into the request, in the order it ranked them. Empty when it
   * injected nothing, which is an answer and not a missing one.
   *
   * Lines written before 2026-09-20 carry `skill: string | null` instead: back then the
   * question could only name one skill. Nothing reads those fields yet, so the shape moved
   * rather than gaining a compatibility arm.
   */
  readonly skills?: readonly string[];
  /** The strongest confidence among `skills`; the per-skill values are in the reminder. */
  readonly confidence?: number;
  /** How many candidates cleared the gate, before the cap — a saturating batch shows here. */
  readonly passed?: number;
  /** `decided` = the judgment cleared the gate; `fallback` = it did not act. */
  readonly source?: "decided" | "fallback";
  /**
   * Set when no judgment was asked for because the prompt is not a human request, naming
   * which signature matched (`domain/skills/prompt-origin.ts`). The judgment fields are then
   * absent, and so is any injection: the hook returned no opinion.
   *
   * A declined prompt and a skipped one look identical in a transcript — nothing is
   * injected either way — so without this line the skip is unauditable, and a signature
   * that starts eating real requests would be invisible.
   */
  readonly skipped?: string;
  /**
   * Wall time of the judgment, measured around the decision-provider call. Absent when no
   * judgment was made (a skip, or a failure before the call).
   *
   * Snake-cased, unlike its neighbours, to match `usage` below, whose keys are the vendor's
   * own. The 1,708 lines written before 2026-09-22 carry neither field, so anything reading
   * this log treats both as optional.
   */
  readonly latency_ms?: number;
  /**
   * What the judgment model reported spending, when the writer can see it. Only the
   * service-side writer can: the hook decides through `/decide`, whose wire contract
   * (`domain/decision/remote.ts`) carries a `Decided` and no usage. So hook lines have
   * `latency_ms` and no `usage`; `/skill` lines have both.
   */
  readonly usage?: RouterLogUsage;
  /** Set when the judgment could not be made at all; the other fields are then absent. */
  readonly error?: string;
  /**
   * Set when the hook injected the fallback catalog instead of a selection, naming why
   * (`domain/skills/fallback-catalog.ts`'s `FallbackReason`). Absent on every line written
   * before 2026-09-22 and on every line where the router decided, so a reader treats it as
   * optional like `latency_ms` and `usage`.
   *
   * It sits alongside the other fields rather than replacing them: a fallback for
   * `below-threshold` still carries the `confidence` that fell short and the `source` that
   * said so, and the question the experiment asks of this log — did a turn with no selection
   * get the catalog, and did the model then open something — needs both halves on one line.
   */
  readonly fallback?: string;
}

/** The judgment model's own token counts, keys as the vendor reports them. */
export interface RouterLogUsage {
  readonly model: string;
  readonly input_tokens: number;
  readonly output_tokens: number;
}
