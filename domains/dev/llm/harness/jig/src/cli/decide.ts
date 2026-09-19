/**
 * The harness-facing one-shot entrypoint: a request envelope on stdin, a
 * judgment on stdout.
 *
 * This exists so a harness needs nothing from jig but the ability to run a
 * command. It has no key, no SDK, no knowledge of the vendor — it writes JSON to
 * stdin and reads JSON from stdout. `pi`'s extension shells out to this; so can
 * any other harness, which is the point of putting the judgment behind one
 * command instead of behind one implementation per harness.
 *
 * A judgment and a failure are kept apart by the exit code: 0 means stdout holds
 * a judgment, 1 means no judgment was made and stderr says why. A caller that
 * cannot tell those apart would eventually read an error as an answer.
 */

import { answerDecision } from "../app/decision/answer-decision";
import type { DecisionProvider } from "../domain/decision/provider";
import type { Logger } from "../domain/ports";

export interface DecideResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export async function decide(
  stdin: string,
  provider: DecisionProvider,
  logger?: Logger,
): Promise<DecideResult> {
  let body: unknown;
  try {
    body = JSON.parse(stdin);
  } catch {
    return { stdout: "", stderr: "request on stdin is not JSON\n", code: 1 };
  }

  const result = await answerDecision(body, provider, {
    ...(logger === undefined ? {} : { logger }),
  });

  if (result.ok) return { stdout: `${JSON.stringify(result.response)}\n`, stderr: "", code: 0 };
  return { stdout: "", stderr: `${result.kind}: ${result.message}\n`, code: 1 };
}
