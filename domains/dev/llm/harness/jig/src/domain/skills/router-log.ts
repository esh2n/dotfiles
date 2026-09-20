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
  /** The skill the router put into the request, or `null` when it injected nothing. */
  readonly skill?: string | null;
  readonly confidence?: number;
  /** `decided` = the judgment cleared the gate; `fallback` = it did not act. */
  readonly source?: "decided" | "fallback";
  /** Set when the judgment could not be made at all; the other fields are then absent. */
  readonly error?: string;
}
