/**
 * Asking jig's judgment service which skill a request matches, for the
 * harnesses whose skill selection runs in-process (omp's extension, DSH's
 * plugin). Claude Code's hook and pi's extension reach the same `/skill`
 * endpoint; the judgment — the question, the per-option criteria, the
 * confidence gate — lives in the service, so every harness gets the same
 * answer to the same prompt.
 *
 * The reminder text is the one pi's extension and the Claude Code hook write,
 * down to the `- "<name>": <path>` lines, because the report reads a turn's
 * injection back out of the transcript by that shape.
 *
 * Failure is the caller's to swallow: this module throws on a service that is
 * down, slow, unauthorized or malformed, and each adapter turns that into
 * "inject nothing".
 */

import { invocation } from "../../domain/skills/opener";
import { readDecisionToken, tokenFilePath } from "./token-file";

/** One skill to inject, with where its body is and how strongly it was judged. */
export interface SkillPick {
  readonly name: string;
  readonly path: string;
  readonly confidence: number;
}

export interface SkillDecision {
  readonly skills: readonly SkillPick[];
  readonly passed: number;
  readonly source: "decided" | "fallback";
}

function readSkillPick(value: unknown): SkillPick {
  if (typeof value !== "object" || value === null) throw new Error("skill pick is not an object");
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string") throw new Error("skill pick has no name");
  if (typeof record.path !== "string") throw new Error("skill pick has no path");
  if (typeof record.confidence !== "number") throw new Error("skill pick has no confidence");
  return { name: record.name, path: record.path, confidence: record.confidence };
}

/** Read the service's reply. Throws on a shape this client cannot trust. */
export function readSkillDecision(body: unknown): SkillDecision {
  if (typeof body !== "object" || body === null) {
    throw new Error("skill service replied with no body");
  }
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.skills)) throw new Error("skill service reply has no skills");
  if (typeof record.passed !== "number") throw new Error("skill service reply has no passed count");
  if (record.source !== "decided" && record.source !== "fallback") {
    throw new Error("skill service reply has no source");
  }
  return { skills: record.skills.map(readSkillPick), passed: record.passed, source: record.source };
}

/** The reminder the model receives, or `undefined` when nothing matched. */
export function skillReminder(decision: SkillDecision, harness: string): string | undefined {
  if (decision.skills.length === 0) return undefined;
  const confidences = decision.skills.map((pick) => pick.confidence.toFixed(2)).join(", ");
  const count =
    decision.skills.length === 1 ? "1 skill matches" : `${decision.skills.length} skills match`;
  return [
    `jig skill router: ${count} this request (judgment confidence ${confidences}).`,
    `${invocation(harness)}:`,
    ...decision.skills.map((pick) => `- "${pick.name}": ${pick.path}`),
  ].join("\n");
}

/** A prompt worth judging: not empty, not a slash command (those carry their own instructions). */
export function routable(prompt: string): boolean {
  const trimmed = prompt.trim();
  return trimmed !== "" && !trimmed.startsWith("/");
}

type Env = Readonly<Record<string, string | undefined>>;

/** `JIG_DECISION_URL` may point at an endpoint; the base is what `/skill` hangs off. */
export function serviceBase(env: Env = process.env): string {
  const configured = env.JIG_DECISION_URL ?? "http://127.0.0.1:4100";
  return configured.replace(/\/(decide|tier|skill|compact)$/, "").replace(/\/$/, "");
}

export interface AskSkillOptions {
  readonly env?: Env;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

/** Post one prompt to `/skill` on behalf of `harness`. */
export async function askSkill(
  harness: string,
  prompt: string,
  options: AskSkillOptions = {},
): Promise<SkillDecision> {
  const env = options.env ?? process.env;
  const token = await readDecisionToken(tokenFilePath(env));
  const response = await (options.fetch ?? fetch)(`${serviceBase(env)}/skill`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ harness, prompt }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  if (!response.ok) throw new Error(`skill service answered ${response.status}`);
  return readSkillDecision(await response.json());
}
