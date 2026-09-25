/**
 * What one tier judgment wrote down. One line per `/tier` request, whatever
 * the answer, including the failures — the counters in `/metrics` say how
 * often each tier was chosen, but only this log can say for which requests,
 * which is the question behind "why does nothing go to the local model?".
 *
 * `promptPreview` is the request's first line, cut short: enough to see what
 * kind of work it was, not the whole prompt. The log is local and personal;
 * still, the full text has no business in a routing record.
 */

export interface TierLogEntry {
  readonly at: string;
  /** Which harness asked (`pi`, …); `unknown` when the request did not say. */
  readonly harness: string;
  readonly promptHash: string;
  readonly promptChars: number;
  readonly promptPreview: string;
  /** The tier returned to the caller. */
  readonly tier?: string;
  /** The tier the judgment preferred before the confidence gate. */
  readonly chosen?: string;
  readonly confidence?: number;
  readonly source?: "decided" | "fallback";
  readonly probabilities?: Readonly<Record<string, number>>;
  readonly durationMs?: number;
  /** Set when the judgment could not be made; the tier fields are then absent. */
  readonly error?: string;
}

export const PROMPT_PREVIEW_CHARS = 160;

/** The first line of the prompt, whitespace collapsed, cut to the preview length. */
export function promptPreview(prompt: string): string {
  const line = prompt.trim().split("\n")[0] ?? "";
  const collapsed = line.replace(/\s+/g, " ");
  return collapsed.length > PROMPT_PREVIEW_CHARS
    ? `${collapsed.slice(0, PROMPT_PREVIEW_CHARS - 1)}…`
    : collapsed;
}
