import {
  type SelectSkillsOptions,
  type SkillPick,
  selectSkills,
} from "../../app/routing/select-skills";
import type { DecisionProvider } from "../../domain/decision/provider";
import type { Logger } from "../../domain/ports";
import type { SkillCandidate } from "../../domain/skills/candidate";
import { classifyPromptOrigin } from "../../domain/skills/prompt-origin";
import type { RouterLogEntry } from "../../domain/skills/router-log";
import { promptHash } from "../../infra/logs/router-log";

interface UserPromptSubmitPayload {
  readonly prompt?: unknown;
  /** Claude Code sets both only inside a subagent; see `domain/skills/prompt-origin.ts`. */
  readonly agent_type?: unknown;
  readonly agent_id?: unknown;
}

export interface SkillRouterDeps {
  readonly provider: DecisionProvider;
  readonly catalog: () => Promise<readonly SkillCandidate[]>;
  /**
   * One line per prompt, whether or not anything was injected. Without it the only
   * visible effect of a router is a reminder appearing in the transcript — and the
   * failure that matters (a request that matched nothing, or a judgment below the
   * gate) looks exactly like a router that was never consulted.
   */
  readonly record: (entry: RouterLogEntry) => Promise<void>;
  readonly logger?: Logger;
  readonly env?: Record<string, string | undefined>;
}

export interface SkillRouterOptions extends SelectSkillsOptions {
  /**
   * The harness name the wrapper declared, mirroring `PreToolUseOptions.harness` and its
   * `--harness` flag. The hook cannot discover it (see `harnessOf`), and the reminder's
   * wording depends on it: how a model opens a skill is a harness fact.
   */
  readonly harness?: string;
}

/**
 * How the model is told to open a skill, per harness.
 *
 * All 209 injections measured on 2026-09-22 named an absolute path and NONE named the
 * `Skill` tool — which is Claude Code's own, cheaper way to load a skill body, and the one
 * the model reaches for unprompted (3 of the injected turns called `Skill(<the injected
 * skill>)` and were scored as misses for it, and 1,208 `Skill` calls in 30 days were
 * counted as zero). Pointing only at a path steers the model toward `Read`, which is the
 * thing the report happened to count — wording that agreed with the metric rather than with
 * the harness.
 *
 * A harness that has not said who it is gets the path-only wording: naming a tool that does
 * not exist there is worse than naming none.
 */
function opener(harness: string): string {
  if (harness === "claude") {
    return "Invoke each with the Skill tool — `Skill(<name>)`, or `/<name>` — before doing the work.\nThe path is the same body, if you would rather read it directly:";
  }
  return "Read and follow these before doing the work:";
}

/**
 * The reminder the model receives. It names each skill, says how to open it, and points
 * at the bodies rather than carrying them: a body is 1-15k characters, and injecting one
 * would hand back most of the list tokens this router exists to save. The
 * `disable-model-invocation` refusal message in Claude Code tells a model to ask the
 * user to run the skill by name; this reminder is the other half of that arrangement —
 * the model still gets the instructions, without the skills being listed.
 *
 * The list is written one skill per line so that the report can read it back: the parser
 * recognises `- "<name>": <path>` lines, which is how a turn's injection is joined to what
 * the model then opened. Changing THOSE lines without changing that parser makes the router
 * look like it was never consulted — which is why the per-harness wording above them is
 * prose the parser never reads.
 */
export function reminder(picks: readonly SkillPick[], harness = "unknown"): string {
  const confidences = picks.map((pick) => pick.confidence.toFixed(2)).join(", ");
  const count = picks.length === 1 ? "1 skill matches" : `${picks.length} skills match`;
  return [
    `jig skill router: ${count} this request (judgment confidence ${confidences}).`,
    opener(harness),
    ...picks.map((pick) => `- "${pick.candidate.name}": ${pick.candidate.path}`),
  ].join("\n");
}

function isDisabled(env: Record<string, string | undefined>): boolean {
  const value = (env.JIG_SKILL_ROUTER ?? "on").toLowerCase();
  return value === "off" || value === "false" || value === "0";
}

/**
 * Which harness this hook is running inside, from the wrapper that invoked it.
 *
 * The hook cannot discover it: by the time it runs, all it has is a prompt on stdin, and
 * the same binary is wired into more than one harness. The wrapper knows, so the wrapper
 * says (`JIG_HARNESS=claude`). `unknown` is the honest default — attributing an unlabelled
 * invocation to a harness would put a harness's numbers in another's.
 */
function harnessOf(options: SkillRouterOptions, env: Record<string, string | undefined>): string {
  const harness = (options.harness ?? env.JIG_HARNESS)?.trim();
  return harness === undefined || harness === "" ? "unknown" : harness;
}

/**
 * Identity of the prompt exactly as it arrived. `promptChars` alone cannot tell two
 * prompts apart: a batch of same-length but different requests reads as one prompt
 * whose confidence wandered, and a repeatability claim made on lengths cannot be
 * checked afterwards. Twelve hex characters of SHA-256 are enough to group repeats.
 *
 * The hash and the writer live in `infra/log/router-log.ts`, because the judgment service
 * writes to the same log for the harnesses that call `/skill`; two copies of this function
 * would make those lines impossible to join to this one's.
 */
/**
 * Claude Code `UserPromptSubmit` hook entrypoint: pick the skill this prompt matches and
 * put it back into the request as context.
 *
 * This exists because a harness builds its skill list before the model sees a request,
 * and no hook can remove what is already in the prompt. So the list is a fixed cost on
 * every turn, and the harness's own selection starts losing accuracy as that list grows
 * (Anthropic's own tool-search documentation puts the degradation past 30-50 candidates;
 * this machine lists 55). Routing outside the prompt pays for the catalog in the
 * judgment model's context instead of the coding model's, and it decides per request
 * rather than per installed skill.
 *
 * Every failure returns the empty string, which is what a hook with no opinion returns:
 * a missing service, an unreadable catalog, a malformed payload and a low-confidence
 * judgment all leave the prompt exactly as it was. The router is an addition to the
 * request, never a gate on it.
 *
 * A prompt that is not a human request gets the same empty string, but BEFORE the judgment
 * is spent rather than after: see `domain/skills/prompt-origin.ts` for what counts and why.
 * The skip is written to the log, because a skip and a decline are otherwise the same
 * silence.
 */
export async function userPromptSubmit(
  stdin: string,
  deps: SkillRouterDeps,
  options: SkillRouterOptions = {},
): Promise<string> {
  const env = deps.env ?? process.env;
  if (isDisabled(env)) return "";

  let payload: UserPromptSubmitPayload;
  try {
    payload = JSON.parse(stdin) as UserPromptSubmitPayload;
  } catch {
    deps.logger?.warn("skill-router.unparseable-input");
    return "";
  }

  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
  if (prompt.trim() === "") return "";

  const harness = harnessOf(options, env);
  const identity = {
    harness,
    promptHash: promptHash(prompt),
    promptChars: prompt.length,
  };

  const origin = classifyPromptOrigin({
    prompt,
    agentType: payload.agent_type,
    agentId: payload.agent_id,
  });
  if (!origin.human) {
    await deps
      .record({ at: new Date().toISOString(), ...identity, skipped: origin.reason })
      .catch(() => undefined);
    return "";
  }

  try {
    const candidates = await deps.catalog();
    // Around the provider call and nothing else: the catalog read is a local directory
    // walk, and folding it in would report a judgment as slower than it was.
    const startedAt = performance.now();
    const judged = await selectSkills(prompt, candidates, deps.provider, {}, options);
    const latencyMs = Math.round(performance.now() - startedAt);
    await deps.record({
      at: new Date().toISOString(),
      ...identity,
      candidates: candidates.length,
      skills: judged.picks.map((pick) => pick.candidate.name),
      passed: judged.passed,
      // The strongest yes, gate or not: a request the judgment liked at 0.7 and the router
      // did not act on is what a threshold question is decided from later.
      ...(judged.confidence === undefined ? {} : { confidence: judged.confidence }),
      source: judged.source,
      latency_ms: latencyMs,
      // No `usage`: this path decides through `/decide`, whose reply carries a `Decided`
      // and no token counts (`domain/decision/remote.ts`). The service-side `/skill`
      // writer records it instead.
    });
    if (judged.picks.length === 0) return "";
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: reminder(judged.picks, harness),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger?.warn("skill-router.failed", { reason: message });
    await deps
      .record({ at: new Date().toISOString(), ...identity, error: message })
      .catch(() => undefined);
    return "";
  }
}
