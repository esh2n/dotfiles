/**
 * One-shot tier entrypoint: the request text on stdin, the tier on stdout.
 *
 * Same application use-case as the service's `/tier` endpoint (`answerTier`), so
 * a harness that cannot or does not want to speak HTTP gets the identical
 * judgment: the question, the criteria and the threshold are not re-stated here.
 */

import { type AnswerTierDeps, answerTier } from "../app/decision/answer-tier";
import type { DecisionProvider } from "../domain/decision/provider";

export interface TierCliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export async function tier(
  stdin: string,
  provider: DecisionProvider,
  deps: AnswerTierDeps = {},
): Promise<TierCliResult> {
  const result = await answerTier({ request: stdin.trim() }, provider, deps);
  if (result.ok) return { stdout: `${JSON.stringify(result.decision)}\n`, stderr: "", code: 0 };
  return { stdout: "", stderr: `${result.kind}: ${result.message}\n`, code: 1 };
}
