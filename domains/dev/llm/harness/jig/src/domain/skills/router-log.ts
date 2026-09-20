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
  /** Set when the judgment could not be made at all; the other fields are then absent. */
  readonly error?: string;
}
