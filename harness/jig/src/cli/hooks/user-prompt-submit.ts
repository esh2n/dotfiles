import {
  type SelectSkillsOptions,
  type SkillPick,
  selectSkills,
} from "../../app/routing/select-skills";
import type { DecisionProvider } from "../../domain/decision/provider";
import { RemoteDecisionProtocolError } from "../../domain/decision/remote";
import type { Logger } from "../../domain/ports";
import type { SkillCandidate } from "../../domain/skills/candidate";
import {
  type FallbackReason,
  type RepoSignals,
  UNKNOWN_SIGNALS,
  fallbackCatalog,
  renderFallbackCatalog,
} from "../../domain/skills/fallback-catalog";
import { invocation } from "../../domain/skills/opener";
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
  /**
   * The skills the router may offer. `includeHidden` is true exactly when the fallback is
   * on, because arm B' is one arrangement and not three: the listing is hidden, the fallback
   * is on, and the hidden skills stay routable. Leaving them out while the listing is hidden
   * leaves the router with an empty catalog and the arm measures nothing.
   */
  readonly catalog: (includeHidden: boolean) => Promise<readonly SkillCandidate[]>;
  /**
   * One line per prompt, whether or not anything was injected. Without it the only
   * visible effect of a router is a reminder appearing in the transcript — and the
   * failure that matters (a request that matched nothing, or a judgment below the
   * gate) looks exactly like a router that was never consulted.
   */
  readonly record: (entry: RouterLogEntry) => Promise<void>;
  /**
   * What the repository in front of this prompt is made of, for the fallback catalog's
   * language filter. Called only when the fallback actually fires — it walks a directory,
   * and a router that decided should not pay for it. Absent means "unknown", which keeps
   * the fallback to the skills that apply anywhere.
   */
  readonly signals?: () => Promise<RepoSignals>;
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
  /**
   * Inject the fallback catalog when the router produces no selection (`--fallback`, or
   * `JIG_ROUTER_FALLBACK=1`). Default off, and that default is not timidity: it belongs to
   * exactly one arm of the skill-selection experiment.
   *
   * In arms A and C the harness's own skill listing is visible, so a fallback would put a
   * second copy of the same catalog into the same turn and the arm would be measuring
   * duplication. In arm B' the listing is hidden (`jig skills hide`) and the injection is
   * the only path a skill has to the model — there, a silent failure means a turn with no
   * skills at all.
   *
   * It is one switch for the whole arrangement, not one of three: turning it on also makes
   * the hidden skills routable (`SkillRouterDeps.catalog`). Arm B' is hidden listing +
   * fallback + hidden-but-routable together, and a knob per part would let the machine sit
   * in a state that is none of the arms.
   */
  readonly fallback?: boolean;
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
    return `${invocation(harness)} — before doing the work.\nThe path is the same body, if you would rather read it directly:`;
  }
  return `${invocation(harness)}:`;
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

function fallbackEnabled(
  options: SkillRouterOptions,
  env: Record<string, string | undefined>,
): boolean {
  if (options.fallback === true) return true;
  const value = (env.JIG_ROUTER_FALLBACK ?? "").toLowerCase();
  return value === "1" || value === "on" || value === "true";
}

/**
 * Why the router produced no selection, from the failure itself rather than from a message.
 *
 * The three provider failures the fallback exists for are distinguishable structurally at
 * exactly one boundary: `RemoteDecisionProtocolError` is thrown when the reply is not a
 * judgment (wrong op, wrong arity, a confidence that is not a probability), which is the
 * malformed case. Unreachable and timed-out both arrive as the transport's own error, and
 * the transport folds the timeout into the same message — so those two are told apart on the
 * text, and anything unrecognised is `error` rather than a guess.
 *
 * Getting this wrong costs a mislabelled line in the log, never a missing fallback: every
 * branch here returns a reason, and every reason injects.
 */
export function fallbackReason(error: unknown): FallbackReason {
  if (error instanceof RemoteDecisionProtocolError) return "malformed";
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout|aborted/i.test(message)) return "timeout";
  if (/unreachable|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(message)) return "unreachable";
  return "error";
}

/**
 * The fallback injection, or the empty string when it is switched off, when nothing in the
 * catalog applies to this repository, or when reading the repository itself fails.
 *
 * It never throws: this runs on the path that is already handling a failure, and a fallback
 * that could fail would turn "the router had no opinion" into "the hook errored".
 */
async function fallbackContext(
  reason: FallbackReason,
  catalog: readonly SkillCandidate[],
  deps: SkillRouterDeps,
  harness: string,
  enabled: boolean,
): Promise<string> {
  if (!enabled) return "";

  try {
    const signals = deps.signals === undefined ? UNKNOWN_SIGNALS : await deps.signals();
    const relevant = fallbackCatalog(catalog, signals);
    if (relevant.length === 0) return "";
    return renderFallbackCatalog(relevant, reason, { harness });
  } catch (error) {
    deps.logger?.warn("skill-router.fallback-failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return "";
  }
}

function additionalContext(context: string): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
  });
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
 * Unless the fallback is switched on (`--fallback` / `JIG_ROUTER_FALLBACK=1`), in which
 * case a failure to SELECT injects the relevant catalog instead of nothing — see
 * `domain/skills/fallback-catalog.ts` for why, and `SkillRouterOptions.fallback` for why it
 * is off by default. A failure to select is: the provider unreachable, timed out or
 * answering with something that is not a judgment, and a judgment that named nothing or
 * nothing above the gate. It is NOT the skip below, which is a prompt no model will act on
 * — putting a catalog into a compaction pass would be the 2026-09-22 defect again, with a
 * bigger payload.
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
  // One switch for the whole arm: it turns the fallback on AND makes the hidden skills
  // routable, because a listing that is hidden and a catalog that skips hidden skills leave
  // the router with nothing to choose from.
  const fallback = fallbackEnabled(options, env);
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

  // Held outside the try so the failure path can still offer what the catalog held: a
  // provider that died had a catalog, and a catalog that died has nothing to fall back to.
  let candidates: readonly SkillCandidate[] = [];

  try {
    candidates = await deps.catalog(fallback);
    // Around the provider call and nothing else: the catalog read is a local directory
    // walk, and folding it in would report a judgment as slower than it was.
    const startedAt = performance.now();
    const judged = await selectSkills(prompt, candidates, deps.provider, {}, options);
    const latencyMs = Math.round(performance.now() - startedAt);

    // No pick is the other half of the fallback's job. "Nothing applies" and "yes, but under
    // the gate" are different judgments and stay apart in the log — but they leave a
    // hidden-listing turn in the identical state, with no skills, so both fall back.
    const reason: FallbackReason = judged.source === "fallback" ? "below-threshold" : "no-match";
    const context =
      judged.picks.length === 0
        ? await fallbackContext(reason, candidates, deps, harness, fallback)
        : reminder(judged.picks, harness);
    const injected = judged.picks.length === 0 && context !== "";

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
      ...(injected ? { fallback: reason } : {}),
      // No `usage`: this path decides through `/decide`, whose reply carries a `Decided`
      // and no token counts (`domain/decision/remote.ts`). The service-side `/skill`
      // writer records it instead.
    });
    return context === "" ? "" : additionalContext(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger?.warn("skill-router.failed", { reason: message });
    const reason = fallbackReason(error);
    const context = await fallbackContext(reason, candidates, deps, harness, fallback);
    await deps
      .record({
        at: new Date().toISOString(),
        ...identity,
        error: message,
        ...(context === "" ? {} : { fallback: reason }),
      })
      .catch(() => undefined);
    return context === "" ? "" : additionalContext(context);
  }
}
