/**
 * The wire contract for the judgment service.
 *
 * jig is installed in more than one harness (pi, DSH, …), but the key that
 * speaks to the judgment model lives in exactly ONE process — the always-on
 * judgment service started at login. Harnesses therefore never hold the key:
 * they construct a `RemoteDecisionProvider` pointed at `127.0.0.1` and the
 * service does the credentialed call.
 *
 * This module is the contract both sides share, at the level of the existing
 * `DecisionProvider` port: one operation tag, the port's own query shape, and a
 * `Decided`-shaped answer. Keeping it a mirror of the port (rather than a
 * bespoke API) is what lets a provider be swapped between in-process and
 * remote without callers noticing.
 */

import type {
  BoolBatchQuery,
  BoolQuery,
  ChoiceQuery,
  Decided,
  DecisionContext,
  ScoreQuery,
} from "./provider";

export type RemoteDecisionRequest =
  | {
      readonly op: "choice";
      readonly query: ChoiceQuery<string>;
      readonly context: DecisionContext;
    }
  | { readonly op: "bool"; readonly query: BoolQuery; readonly context: DecisionContext }
  | { readonly op: "boolBatch"; readonly query: BoolBatchQuery; readonly context: DecisionContext }
  | { readonly op: "score"; readonly query: ScoreQuery; readonly context: DecisionContext };

/**
 * The answer for one operation. Tagged with the operation it answers so a
 * mismatched or stale reply can never be read as a judgment about something
 * else — a judgment that does not match the question must fail, not degrade.
 */
export type RemoteDecisionResponse =
  | { readonly op: "choice"; readonly value: string; readonly confidence: number }
  | { readonly op: "bool"; readonly value: boolean; readonly confidence: number }
  | { readonly op: "boolBatch"; readonly values: readonly Decided<boolean>[] }
  | { readonly op: "score"; readonly value: number; readonly confidence: number };

export interface RemoteDecisionErrorBody {
  /** `bad-request` = the caller asked something malformed; `provider-error` = the judgment failed. */
  readonly kind: "bad-request" | "provider-error";
  readonly message: string;
}

export type RemoteDecisionErrorResponse = {
  readonly op: "error";
  readonly error: RemoteDecisionErrorBody;
};

export type RemoteDecisionReply = RemoteDecisionResponse | RemoteDecisionErrorResponse;

/** A malformed request or reply: a bug on one side of the wire, not a model failure. */
export class RemoteDecisionProtocolError extends Error {}

export const REMOTE_DECISION_OPS: readonly RemoteDecisionRequest["op"][] = [
  "choice",
  "bool",
  "boolBatch",
  "score",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new RemoteDecisionProtocolError(`${what} must be an object`);
  return value;
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string") throw new RemoteDecisionProtocolError(`${what} must be a string`);
  return value;
}

function requireStringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) throw new RemoteDecisionProtocolError(`${what} must be an array`);
  for (const entry of value) requireString(entry, `${what} entry`);
  return value as string[];
}

function optionalContext(value: unknown): DecisionContext {
  if (value === undefined) return {};
  return requireRecord(value, "context");
}

function requirePrompt(query: Record<string, unknown>, op: string): string {
  return requireString(query.prompt, `${op}.query.prompt`);
}

function parseChoiceQuery(query: Record<string, unknown>): ChoiceQuery<string> {
  const prompt = requirePrompt(query, "choice");
  const options = requireStringArray(query.options, "choice.query.options");
  if (options.length < 2) {
    throw new RemoteDecisionProtocolError("choice.query.options must offer at least two options");
  }
  const rawCriteria = query.criteria;
  if (rawCriteria === undefined) return { prompt, options };
  const criteria = requireRecord(rawCriteria, "choice.query.criteria");
  for (const [label, description] of Object.entries(criteria)) {
    requireString(description, `choice.query.criteria.${label}`);
  }
  return { prompt, options, criteria: criteria as Record<string, string> };
}

function parseScoreQuery(query: Record<string, unknown>): ScoreQuery {
  const prompt = requirePrompt(query, "score");
  const rawCriteria = query.criteria;
  if (rawCriteria === undefined) return { prompt };
  return { prompt, criteria: requireStringArray(rawCriteria, "score.query.criteria") };
}

/**
 * Validate a request off the wire. Throws `RemoteDecisionProtocolError` on
 * anything malformed — the service answers that as `bad-request`, because a
 * malformed request is never the model's fault and must not be retried as if it
 * were.
 */
export function parseRemoteDecisionRequest(value: unknown): RemoteDecisionRequest {
  const body = requireRecord(value, "request");
  const op = requireString(body.op, "request.op");
  const query = requireRecord(body.query, `request.query for op "${op}"`);
  const context = optionalContext(body.context);

  switch (op) {
    case "choice":
      return { op, query: parseChoiceQuery(query), context };
    case "bool":
      return { op, query: { prompt: requirePrompt(query, "bool") }, context };
    case "boolBatch":
      return {
        op,
        query: {
          material: requireString(query.material, "boolBatch.query.material"),
          prompts: requireStringArray(query.prompts, "boolBatch.query.prompts"),
        },
        context,
      };
    case "score":
      return { op, query: parseScoreQuery(query), context };
    default:
      throw new RemoteDecisionProtocolError(
        `request.op "${op}" is not one of ${REMOTE_DECISION_OPS.join(", ")}`,
      );
  }
}

/** Validate a probability-shaped number (confidence and noul-derived values). */
export function requireProbability(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RemoteDecisionProtocolError(`${what} is not a probability in [0, 1]`);
  }
  return value;
}

/** Validate one `Decided<boolean>` off the wire. */
export function requireDecidedBoolean(value: unknown, what: string): Decided<boolean> {
  const record = requireRecord(value, what);
  if (typeof record.value !== "boolean") {
    throw new RemoteDecisionProtocolError(`${what}.value must be a boolean`);
  }
  return {
    value: record.value,
    confidence: requireProbability(record.confidence, `${what}.confidence`),
  };
}

/** Read an error reply, if that is what this is. */
export function readErrorResponse(value: unknown): RemoteDecisionErrorBody | undefined {
  if (!isRecord(value) || value.op !== "error") return undefined;
  const error = isRecord(value.error) ? value.error : undefined;
  if (error === undefined) return undefined;
  const kind = error.kind === "bad-request" ? "bad-request" : "provider-error";
  const message = typeof error.message === "string" ? error.message : "judgment service failed";
  return { kind, message };
}
