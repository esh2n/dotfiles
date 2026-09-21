/**
 * The judgment service's transport and composition root.
 *
 * This process is the ONE place that holds the key to the judgment model: it is
 * started once at login, reads `TYPESAFE_API_KEY` a single time, and answers the
 * harnesses over the loopback. Harnesses get a `RemoteDecisionProvider`; they
 * never get the key, and never talk to the model vendor directly.
 *
 * Two layers live here on purpose, and only these two: the `respondTo*` functions
 * map an application result to a status code (transport's job), and
 * `serveDecisionService` is the HTTP shell around them. The dispatch itself lives
 * in `app/decision/*`, which is where it is tested.
 */

import { timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { type AnswerCompactionDeps, answerCompaction } from "../app/compaction/answer-compaction";
import type { CompactionResult } from "../app/compaction/compact";
import { type AnswerDecisionDeps, answerDecision } from "../app/decision/answer-decision";
import {
  type AnswerSkillDeps,
  type SkillDecision,
  answerSkill,
} from "../app/decision/answer-skill";
import { type AnswerTierDeps, type TierDecision, answerTier } from "../app/decision/answer-tier";
import type { DecisionProvider } from "../domain/decision/provider";
import type {
  RemoteDecisionErrorResponse,
  RemoteDecisionResponse,
} from "../domain/decision/remote";
import type { Logger } from "../domain/ports";
import { type TierLogEntry, promptPreview } from "../domain/routing/tier-log";
import type { SkillCandidate } from "../domain/skills/candidate";
import type { RouterLogEntry } from "../domain/skills/router-log";
import { JevProvider, type JevUsage } from "../infra/decision/jev-provider";
import { ensureDecisionToken, tokenFilePath } from "../infra/decision/token-file";
import {
  createTypesafeClient,
  resolveJudgmentClientConfig,
} from "../infra/decision/typesafe-client";
import { promptHash } from "../infra/logs/router-log";
import { type JudgmentKind, runWithJudgmentKind } from "../infra/metrics/judgment-kind";
import { METRICS_CONTENT_TYPE, MetricsRegistry } from "../infra/metrics/registry";
import { readSkillCatalog } from "../infra/skills/catalog";

/** A JSON reply: the endpoint's own body, or the shared error envelope. */
export type HttpResponse<Body> = {
  readonly status: number;
  readonly body: Body | RemoteDecisionErrorResponse;
};

export type DecisionHttpResponse = HttpResponse<RemoteDecisionResponse>;
export type TierHttpResponse = HttpResponse<TierDecision>;
export type CompactionHttpResponse = HttpResponse<CompactionResult>;
export type SkillHttpResponse = HttpResponse<SkillDecision>;

/**
 * Application result -> HTTP. A malformed request is the caller's bug (400); a
 * judgment that could not be made is an upstream failure (502). The error body
 * keeps the distinction, so a caller can tell "I asked wrong" from "the model
 * did not answer" without parsing prose.
 */
export async function respondToDecision(
  body: unknown,
  provider: DecisionProvider,
  deps: AnswerDecisionDeps = {},
): Promise<DecisionHttpResponse> {
  const result = await answerDecision(body, provider, deps);
  if (result.ok) return { status: 200, body: result.response };
  return {
    status: result.kind === "bad-request" ? 400 : 502,
    body: { op: "error", error: { kind: result.kind, message: result.message } },
  };
}

/**
 * Application result -> HTTP for the tier endpoint. Same mapping rule as
 * judgments: a malformed request is the caller's bug, a tier that could not be
 * judged is an upstream failure.
 */
export async function respondToTier(
  body: unknown,
  provider: DecisionProvider,
  deps: AnswerTierDeps = {},
): Promise<TierHttpResponse> {
  const result = await answerTier(body, provider, deps);
  if (result.ok) return { status: 200, body: result.decision };
  return {
    status: result.kind === "bad-request" ? 400 : 502,
    body: { op: "error", error: { kind: result.kind, message: result.message } },
  };
}

/**
 * Application result -> HTTP for the compaction endpoint. Same mapping rule: a
 * malformed item list is the caller's bug, a judgment that could not be made is
 * an upstream failure (the caller then keeps its context as it is).
 */
export async function respondToCompaction(
  body: unknown,
  provider: DecisionProvider,
  deps: AnswerCompactionDeps = {},
): Promise<CompactionHttpResponse> {
  const result = await answerCompaction(body, provider, deps);
  if (result.ok) return { status: 200, body: result.result };
  return {
    status: result.kind === "bad-request" ? 400 : 502,
    body: { op: "error", error: { kind: result.kind, message: result.message } },
  };
}

/**
 * Application result -> HTTP for the skill endpoint. Same mapping rule as the other
 * judgments: a malformed request is the caller's bug, a skill that could not be
 * judged is an upstream failure (the caller then injects nothing at all).
 */
export async function respondToSkill(
  body: unknown,
  provider: DecisionProvider,
  deps: AnswerSkillDeps,
): Promise<SkillHttpResponse> {
  const result = await answerSkill(body, provider, deps);
  if (result.ok) return { status: 200, body: result.decision };
  return {
    status: result.kind === "bad-request" ? 400 : 502,
    body: { op: "error", error: { kind: result.kind, message: result.message } },
  };
}

/**
 * Where the skill endpoint reads the list a harness shows. Matches the hook's own
 * default (`cli/jig.ts`): the merged farm Claude Code renders from, which on this
 * machine is every profile's skills.
 */
function defaultSkillRoot(): string {
  return join(homedir(), ".claude", ".skills-merged");
}

/**
 * The service's own composition root: build the credentialed provider exactly
 * once. Transport (DIRECT to the vendor, or PROXY through the local LiteLLM
 * boundary) is chosen from the environment by `resolveJudgmentClientConfig`, so
 * this root stays the single place the key is read.
 */
export function buildJudgmentProvider(
  env: Record<string, string | undefined> = process.env,
  onUsage?: (usage: JevUsage) => void,
): JevProvider {
  return new JevProvider({
    client: createTypesafeClient(resolveJudgmentClientConfig(env)),
    ...(onUsage === undefined ? {} : { onUsage }),
  });
}

export interface ServeDecisionOptions {
  readonly provider: DecisionProvider;
  readonly port: number;
  readonly hostname?: string;
  readonly logger?: AnswerDecisionDeps["logger"];
  readonly clock?: AnswerDecisionDeps["clock"];
  /** Compaction options, for tests and for an operator changing the caution level. */
  readonly compaction?: AnswerCompactionDeps["options"];
  /**
   * Where skill judgments are written down, one line per request. This is the `/skill`
   * path's half of the router log (`infra/log/router-log.ts`): a harness that calls this
   * endpoint decides nothing itself, so if the service does not write the line, no
   * record of the judgment exists anywhere but the model's own transcript.
   */
  readonly recordSkill?: (entry: RouterLogEntry) => Promise<void>;
  /** Where tier judgments are written down, one line per `/tier` request (`infra/logs/tier-log.ts`). */
  readonly recordTier?: (entry: TierLogEntry) => Promise<void>;
  /**
   * Where the service's own counters live. Pass one when the caller also feeds it
   * (the provider's token usage is reported to the caller, not to this function),
   * so `/metrics` and the usage hook share a single registry.
   */
  readonly metrics?: MetricsRegistry;
  /**
   * The skill list the skill endpoint chooses from. Read per call by default, since
   * the farm changes when skills are installed; a caller that knows better can pass
   * a cached reader.
   */
  readonly skillCatalog?: () => Promise<readonly SkillCandidate[]>;
}

export interface RunningDecisionService {
  readonly url: string;
  stop(): void;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The metric families this service owns, with the help text an operator reads. */
function describeMetrics(metrics: MetricsRegistry): void {
  metrics.describe(
    "jig_judgment_requests_total",
    "Judgment requests served, by endpoint and outcome. bad_request is a caller's bug, provider_error is an unmade judgment.",
  );
  metrics.describe(
    "jig_judgment_seconds",
    "Wall time the service spent producing an answer, by endpoint. Includes the model call.",
  );
  metrics.describe(
    "jig_judgment_tokens_total",
    "Tokens the judgment model reported, by endpoint, model and direction. This is what the judgment service costs.",
  );
  metrics.describe(
    "jig_tier_decisions_total",
    "Tier judgments by the tier that came back and whether it was decided or the confidence gate fell back. A fallback is the model declining to route, so the fallback rate is the number to watch.",
  );
  metrics.describe(
    "jig_compaction_items_total",
    "Items a compaction judgment kept or dropped. All-kept means the judgment ran and changed nothing, which is the signal that the question stopped discriminating.",
  );
}

function outcomeOf(status: number): string {
  if (status === 200) return "ok";
  if (status === 400) return "bad_request";
  if (status === 401) return "unauthorized";
  return "provider_error";
}

/**
 * Turn one answered request into the numbers and the log line that make its
 * behaviour reviewable after the fact.
 *
 * Counters answer "is this getting worse" across days; the log line answers "what
 * exactly happened here" for one request, which is what a report of "routing made
 * a bad choice at 14:20" needs. Both are written for every request because the
 * interesting cases (a fallback, a judgment that dropped nothing) look like
 * nothing at all from the outside.
 */
function recordDecision(
  metrics: MetricsRegistry,
  logger: Logger | undefined,
  kind: string,
  response: HttpResponse<unknown>,
  elapsedSeconds: number,
): void {
  const seconds = Number(elapsedSeconds.toFixed(3));
  if (response.status !== 200) {
    logger?.warn("judgment.failed", {
      kind,
      status: response.status,
      outcome: outcomeOf(response.status),
      seconds,
    });
    return;
  }

  const body = response.body;
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  if (kind === "tier") {
    const tier = typeof record.tier === "string" ? record.tier : "unknown";
    const source = record.source === "fallback" ? "fallback" : "decided";
    metrics.increment("jig_tier_decisions_total", { tier, source });
    logger?.info("judgment.tier", {
      tier,
      source,
      confidence: typeof record.confidence === "number" ? record.confidence : null,
      seconds,
    });
    return;
  }

  if (kind === "compact") {
    const decisions = Array.isArray(record.decisions) ? record.decisions : [];
    const dropped = decisions.filter(
      (decision) =>
        typeof decision === "object" &&
        decision !== null &&
        (decision as Record<string, unknown>).kept === false,
    ).length;
    metrics.increment(
      "jig_compaction_items_total",
      { decision: "kept" },
      decisions.length - dropped,
    );
    metrics.increment("jig_compaction_items_total", { decision: "dropped" }, dropped);
    logger?.info("judgment.compact", {
      judged: decisions.length,
      dropped,
      removedAll: decisions.length > 0 && dropped === decisions.length,
      seconds,
    });
    return;
  }

  if (kind === "skill") {
    logger?.info("judgment.skill", {
      skills: skillsOf(record).join(", "),
      passed: typeof record.passed === "number" ? record.passed : null,
      source: record.source === "fallback" ? "fallback" : "decided",
      confidence: topConfidenceOf(record) ?? null,
      seconds,
    });
    return;
  }

  logger?.info("judgment.decide", {
    op: typeof record.op === "string" ? record.op : "unknown",
    seconds,
  });
}

const UNAUTHORIZED: RemoteDecisionErrorResponse = {
  op: "error",
  error: { kind: "unauthorized", message: "missing or invalid bearer token" },
};

/**
 * Write down one skill judgment for the log `jig report skills` reads.
 *
 * The request body carries the harness (`{ harness: "pi", prompt }`) because the service
 * cannot work it out: every harness posts the same shape over the same loopback socket.
 * An unlabelled request is recorded as `unknown` rather than attributed to a harness whose
 * numbers it would then distort.
 *
 * A failed judgment is written down too — with `error` instead of a skill — because "the
 * router was consulted and could not answer" is a different fact from "the router was
 * never consulted", and only this log can tell them apart.
 */
/**
 * Write down one tier judgment. Like the skill log, the harness comes from the
 * request body (`{ harness: "pi", request }`) or is `unknown`; a failure is
 * written with `error`, because "asked and could not answer" and "never asked"
 * must stay distinguishable.
 */
async function recordTierDecision(
  record: ((entry: TierLogEntry) => Promise<void>) | undefined,
  request: unknown,
  response: HttpResponse<unknown>,
  at: string,
): Promise<void> {
  if (record === undefined) return;
  const requestBody =
    typeof request === "object" && request !== null ? (request as Record<string, unknown>) : {};
  const prompt = typeof requestBody.request === "string" ? requestBody.request : "";
  const rawHarness = typeof requestBody.harness === "string" ? requestBody.harness.trim() : "";
  const identity = {
    at,
    harness: rawHarness === "" ? "unknown" : rawHarness,
    promptHash: promptHash(prompt),
    promptChars: prompt.length,
    promptPreview: promptPreview(prompt),
  };
  const body = response.body;
  const decision =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (response.status !== 200) {
    const error = decision.error;
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : `status ${response.status}`;
    await record({ ...identity, error: message });
    return;
  }
  await record({
    ...identity,
    ...(typeof decision.tier === "string" ? { tier: decision.tier } : {}),
    ...(typeof decision.chosen === "string" ? { chosen: decision.chosen } : {}),
    ...(typeof decision.confidence === "number" ? { confidence: decision.confidence } : {}),
    ...(decision.source === "fallback" || decision.source === "decided"
      ? { source: decision.source }
      : {}),
    ...(typeof decision.probabilities === "object" && decision.probabilities !== null
      ? { probabilities: decision.probabilities as Record<string, number> }
      : {}),
    ...(typeof decision.durationMs === "number" ? { durationMs: decision.durationMs } : {}),
  });
}

async function recordSkillDecision(
  record: ((entry: RouterLogEntry) => Promise<void>) | undefined,
  request: unknown,
  response: HttpResponse<unknown>,
  at: string,
): Promise<void> {
  if (record === undefined) return;

  const requestBody =
    typeof request === "object" && request !== null ? (request as Record<string, unknown>) : {};
  const prompt = typeof requestBody.prompt === "string" ? requestBody.prompt : "";
  const rawHarness = typeof requestBody.harness === "string" ? requestBody.harness.trim() : "";
  const harness = rawHarness === "" ? "unknown" : rawHarness;
  const identity = { at, harness, promptHash: promptHash(prompt), promptChars: prompt.length };

  const body = response.body;
  const decision =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const entry: RouterLogEntry =
    response.status === 200
      ? {
          ...identity,
          skills: skillsOf(decision),
          ...(typeof decision.passed === "number" ? { passed: decision.passed } : {}),
          ...(topConfidenceOf(decision) === undefined
            ? {}
            : { confidence: topConfidenceOf(decision) }),
          ...(decision.source === "decided" || decision.source === "fallback"
            ? { source: decision.source }
            : {}),
        }
      : { ...identity, error: errorMessageOf(body) };

  await record(entry).catch(() => undefined);
}

/** The skill names out of a `/skill` answer, strongest first. */
function skillsOf(decision: Record<string, unknown>): readonly string[] {
  if (!Array.isArray(decision.skills)) return [];
  return decision.skills
    .map((pick) =>
      typeof pick === "object" && pick !== null
        ? (pick as Record<string, unknown>).name
        : undefined,
    )
    .filter((name): name is string => typeof name === "string");
}

/** The strongest confidence in a `/skill` answer, which is the first pick's. */
function topConfidenceOf(decision: Record<string, unknown>): number | undefined {
  if (!Array.isArray(decision.skills)) return undefined;
  const first = decision.skills[0];
  if (typeof first !== "object" || first === null) return undefined;
  const confidence = (first as Record<string, unknown>).confidence;
  return typeof confidence === "number" ? confidence : undefined;
}

/** The message out of the shared error envelope, for a line that could not be answered. */
function errorMessageOf(body: unknown): string {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const error =
    typeof record.error === "object" && record.error !== null
      ? (record.error as Record<string, unknown>)
      : {};
  return typeof error.message === "string" ? error.message : "skill judgment failed";
}

/**
 * Constant-time bearer check: a length mismatch is rejected before comparison
 * (`timingSafeEqual` requires equal-length buffers, and unequal length is
 * itself not a judgment's answer to have to time-hide from every caller — a
 * caller with no credential at all learns nothing from this branch that the
 * 401 doesn't already tell it).
 */
function isAuthorized(header: string | null, token: string): boolean {
  if (header === null || !header.startsWith("Bearer ")) return false;
  const presented = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(token, "utf8");
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/**
 * Serve the decision endpoint. Bind to the loopback only: this process holds a
 * credential, so nothing outside the machine has any business reaching it —
 * and since any other local process can still open a loopback socket, `/decide`,
 * `/tier` and `/compact` also require a bearer token read from a 0600 file
 * (`../infra/decision/token-file.ts`). `/health` stays open: it reveals nothing
 * a caller could use.
 */
export function serveDecisionService(
  options: ServeDecisionOptions,
  env: Record<string, string | undefined> = process.env,
): RunningDecisionService {
  const hostname = options.hostname ?? "127.0.0.1";
  const deps: AnswerDecisionDeps = {
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  };
  const compactionDeps: AnswerCompactionDeps = {
    ...deps,
    ...(options.compaction === undefined ? {} : { options: options.compaction }),
  };
  const skillDeps: AnswerSkillDeps = {
    ...deps,
    catalog:
      options.skillCatalog ?? (() => readSkillCatalog(env.JIG_SKILL_ROOT ?? defaultSkillRoot())),
  };

  const metrics = options.metrics ?? new MetricsRegistry();
  describeMetrics(metrics);

  const routes = new Set(["/decide", "/tier", "/compact", "/skill"]);
  // Kicked off now, at server start, so the token file exists (0600, created or
  // reused) before the first request rather than being generated lazily on it.
  const token = ensureDecisionToken(tokenFilePath(env));

  const server = Bun.serve({
    port: options.port,
    hostname,
    fetch: async (request) => {
      const { pathname } = new URL(request.url);

      if (request.method === "GET" && pathname === "/health") {
        return json(200, { ok: true, provider: options.provider.name });
      }
      if (request.method === "GET" && pathname === "/metrics") {
        // Prometheus 3.0 fails the scrape outright without a parsable type.
        return new Response(metrics.render(), {
          status: 200,
          headers: { "content-type": METRICS_CONTENT_TYPE },
        });
      }
      if (request.method !== "POST" || !routes.has(pathname)) {
        return new Response("not found", { status: 404 });
      }

      if (!isAuthorized(request.headers.get("authorization"), await token)) {
        // Counted so a consumer left behind without the token shows up on the
        // dashboard instead of failing silently into its fallback.
        metrics.increment("jig_judgment_requests_total", {
          kind: pathname.slice(1),
          outcome: outcomeOf(401),
        });
        return json(401, UNAUTHORIZED);
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        body = undefined;
      }

      // Three endpoints, one provider: `/decide` answers a caller's own typed
      // question, `/tier` answers jig's tier question, `/compact` answers jig's
      // keep-or-drop question — so no harness has to restate either one.
      const kind = pathname.slice(1);
      const startedAt = performance.now();
      // Inside the kind scope, so the provider's usage hook — composed before this
      // request existed — labels its token counts with the endpoint that spent them.
      const response = await runWithJudgmentKind(kind as JudgmentKind, async () => {
        if (pathname === "/tier") return respondToTier(body, options.provider, deps);
        if (pathname === "/skill") return respondToSkill(body, options.provider, skillDeps);
        if (pathname === "/compact") {
          return respondToCompaction(body, options.provider, compactionDeps);
        }
        return respondToDecision(body, options.provider, deps);
      });

      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      metrics.increment("jig_judgment_requests_total", {
        kind,
        outcome: outcomeOf(response.status),
      });
      metrics.observe("jig_judgment_seconds", elapsedSeconds, { kind });
      recordDecision(metrics, options.logger, kind, response, elapsedSeconds);
      if (pathname === "/tier") {
        await recordTierDecision(
          options.recordTier,
          body,
          response,
          (deps.clock?.now() ?? new Date()).toISOString(),
        );
      }
      if (pathname === "/skill") {
        await recordSkillDecision(
          options.recordSkill,
          body,
          response,
          (deps.clock?.now() ?? new Date()).toISOString(),
        );
      }
      return json(response.status, response.body);
    },
  });

  const url = `http://${hostname}:${server.port}`;
  options.logger?.info("decision.service.listening", { url, provider: options.provider.name });

  return { url, stop: () => void server.stop(true) };
}
