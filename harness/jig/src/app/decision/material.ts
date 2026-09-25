/**
 * How much of a request becomes a judgment's material.
 *
 * Measured against the live model on an 89k-character prompt (a task statement,
 * a 1,400-line file, and the ask at the end):
 *
 *  - sent whole, the call FAILS (`HTTP 400 max_tokens_exceeded`, served as 502), so
 *    a long prompt gets no routing at all and silently keeps the current model
 *  - head + tail (4k/4k, 1.5k/1.5k) decides `complex` with confidence 1.00 in 0.2s
 *  - the tail alone collapses to `main` with confidence 0.04: an ask without the
 *    context it refers to is not routable, and the gate throws the call away
 *  - the head alone decided correctly on that prompt, but the head is not where the
 *    current ask is when a request ends with its question
 *
 * The middle is the pasted body, which a judgment needs least; both ends are what it
 * needs. 2k each keeps the call well inside the provider's limit and inside the size
 * that was measured to answer confidently.
 *
 * Shared by the tier judgment and the skill router because both ask a question about
 * a request the user typed, and both fail identically when that request is huge.
 */
const MATERIAL_HEAD_CHARS = 2_000;
const MATERIAL_TAIL_CHARS = 2_000;

/**
 * The head and the tail, with the middle elided. The elision is announced instead of
 * hidden: a judgment told it sees an excerpt of a longer request can say the excerpt
 * does not settle the question, and the confidence gate then declines to route rather
 * than guessing from a truncated view.
 */
export function boundedMaterial(request: string): string {
  if (request.length <= MATERIAL_HEAD_CHARS + MATERIAL_TAIL_CHARS) return request;
  const elided = request.length - MATERIAL_HEAD_CHARS - MATERIAL_TAIL_CHARS;
  return [
    request.slice(0, MATERIAL_HEAD_CHARS),
    `… [${elided} characters elided from the middle of a ${request.length}-character request] …`,
    request.slice(-MATERIAL_TAIL_CHARS),
  ].join("\n\n");
}
