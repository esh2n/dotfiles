'use strict';

/**
 * Builds the concrete injected globals (`agent`, `parallel`, `pipeline`,
 * `log`, `phase`, `budget`, `workflow`, restricted `Date`/`Math`) for one
 * script execution, given a run context. See API.md for the contract each
 * of these implements.
 */

const { callKey } = require('./journal');
const { runWithSchema, SchemaValidationError } = require('./schema');
const worktree = require('./worktree');
const retry = require('./retry');
const budgetLib = require('./budget');

/**
 * Fallback per-agent wall-clock ceiling, used when neither the call nor the
 * run set one. Without it a wedged backend child blocked its `agent()` call
 * forever and, through the concurrency limiter, eventually the whole run.
 * 15 minutes is long enough that no healthy call in this repo's workflows
 * comes close and short enough that a stuck lane fails within one coffee.
 */
const DEFAULT_AGENT_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * @param {object} ctx
 * @param {string} ctx.runId
 * @param {import('./journal').Journal} ctx.journal
 * @param {object} ctx.backend - one of backends/{claude,codex,omp,mock}.js
 * @param {string} ctx.cwd - default working directory for agent() calls
 * @param {string} [ctx.model] - run-level default model tier/id
 * @param {string} [ctx.effort] - run-level default effort
 * @param {string} [ctx.mockFile] - --mock fixture path (mock backend only)
 * @param {boolean} [ctx.dryRun]
 * @param {boolean} [ctx.resume] - whether to replay this run's journal prefix
 * @param {number} [ctx.concurrency] - max concurrent agent() backend calls
 * @param {(event: object) => void} ctx.emit - progress/NDJSON sink
 * @param {(nameOrRef: any, args: any) => Promise<any>} [ctx.runChildWorkflow]
 *   injected by runner.js to avoid a require cycle; used by the `workflow()`
 *   global. Absent/throws when this context is itself already a child (one
 *   level of nesting only).
 * @param {number} [ctx.timeoutMs] - run-level per-agent timeout default
 * @param {object} [ctx.caps] - budget.js caps; defaults applied when absent
 * @param {number} [ctx.retries] - transient-failure retries per backend call
 * @param {number} [ctx.retryBaseDelayMs]
 * @param {number} [ctx.retryMaxDelayMs]
 * @param {(ms:number) => Promise<void>} [ctx.sleep] - injected in tests
 * @param {number} [ctx.startedAt] - run start (ms) for the wall-clock cap
 */
function createApi(ctx) {
  const state = {
    currentPhase: null,
    worktreeCounter: 0,
    // Position of the next agent() call in arrival order. This is what
    // resume replays against — see journal.js's header.
    callIndex: 0,
    // Calls actually dispatched (replayed ones are free), counted against
    // the agent-call cap.
    liveCalls: 0,
    // Cleared for good at the first divergence: once this run's call
    // sequence stops matching the journal's, NOTHING later may be replayed,
    // because every later result was computed from a different upstream.
    replaying: !!ctx.resume,
  };
  const caps = ctx.caps || budgetLib.resolveCaps(ctx.cwd);
  const startedAt = Number.isFinite(ctx.startedAt) ? ctx.startedAt : Date.now();
  const limiter = makeLimiter(ctx.concurrency || 4);

  function phase(title) {
    state.currentPhase = String(title);
    ctx.emit({ type: 'phase', runId: ctx.runId, title: state.currentPhase, ts: nowIso() });
  }

  function log(message) {
    ctx.emit({ type: 'log', runId: ctx.runId, message: String(message), ts: nowIso() });
  }

  async function agent(prompt, opts = {}) {
    const agentType = opts.agentType || opts.subagent_type; // subagent_type: accepted alias, see API.md
    const normalizedOpts = { ...opts, agentType };
    delete normalizedOpts.subagent_type;
    const effPhase = opts.phase || state.currentPhase;
    const model = opts.model || ctx.model;
    const effort = opts.effort || ctx.effort;
    const label = opts.label || '(unlabeled)';
    const key = callKey(prompt, normalizedOpts);
    const index = state.callIndex;
    state.callIndex += 1;

    if (state.replaying) {
      const cached = ctx.journal.replayAt(index, key);
      if (cached) {
        ctx.emit({ type: 'agent-cached', runId: ctx.runId, label, phase: effPhase, index, ts: nowIso() });
        return cached.result;
      }
      // First divergence: this call, and every call after it, runs live.
      state.replaying = false;
      ctx.emit({ type: 'resume-diverged', runId: ctx.runId, label, phase: effPhase, index, ts: nowIso() });
    }

    // Checked before the dry-run short-circuit on purpose: a runaway loop
    // needs to be stopped in a dry run too. A breach throws (see budget.js)
    // rather than resolving to null, and parallel()/pipeline() re-raise it.
    budgetLib.assertWithinCaps(caps, {
      callsMade: state.liveCalls,
      tokensSpent: ctx.journal.tokensSpent(),
      elapsedMs: Date.now() - startedAt,
    });
    state.liveCalls += 1;

    ctx.emit({ type: 'agent-start', runId: ctx.runId, label, phase: effPhase, model, index, ts: nowIso() });

    if (ctx.dryRun) {
      const { placeholderFor } = require('./schema');
      const result = opts.schema ? placeholderFor(opts.schema) : `[dry-run] ${label}: ${prompt.slice(0, 120)}`;
      ctx.emit({ type: 'agent-end', runId: ctx.runId, label, phase: effPhase, index, status: 'dry-run', ts: nowIso() });
      return result;
    }

    let effectiveCwd = ctx.cwd;
    let wt = null;
    if (opts.isolation === 'worktree') {
      state.worktreeCounter += 1;
      // awaited, not sync: several agent() calls run concurrently and a
      // blocking `git worktree add` would stall all of them (see worktree.js).
      wt = await worktree.create(ctx.cwd, ctx.runId, state.worktreeCounter);
      effectiveCwd = wt.path;
    }

    const release = await limiter.acquire();
    try {
      // Summed across every backend.run() invocation for this agent() call
      // (a schema retry or a transient-failure retry means callBackend can
      // run several times) so the journal's durationMs and token counts
      // reflect the full cost this call incurred, not just its last attempt.
      let durationMs = 0;
      const usage = newUsageAccumulator();
      let timedOut = false;
      const callBackend = async (promptText) => {
        const res = await retry.withRetry(() => ctx.backend.run({
          prompt: promptText,
          model,
          effort,
          schema: opts.schema,
          agentType,
          // Every real backend defaults to its own least-privilege mode;
          // only a script that actually writes asks for more, per call.
          // codex has a native `-s`; claude and omp express read-only
          // through their tool-restriction flags (--disallowedTools /
          // --tools) rather than ignoring the option. See each backend's
          // DEFAULT_SANDBOX.
          sandbox: opts.sandbox,
          cwd: effectiveCwd,
          opts: normalizedOpts,
          mockFile: ctx.mockFile,
          timeoutMs: timeoutFor(opts, ctx),
        }), {
          retries: ctx.retries,
          baseDelayMs: ctx.retryBaseDelayMs,
          maxDelayMs: ctx.retryMaxDelayMs,
          sleep: ctx.sleep,
          onRetry: ({ attempt, retries: maxRetries, delayMs, error }) => {
            // Journaled as its own line so `yoki-graph status` shows that a
            // lane was retried, not just that it eventually passed. Never
            // status 'ok', so it is invisible to the resume prefix.
            ctx.journal.append({
              key, index, label, phase: effPhase, status: 'retry',
              attempt, retries: maxRetries, delayMs, error: error.message,
              timedOut: !!error.timedOut,
            });
            ctx.emit({
              type: 'agent-retry', runId: ctx.runId, label, phase: effPhase, index,
              attempt, retries: maxRetries, delayMs, error: error.message, ts: nowIso(),
            });
          },
        });
        durationMs += res.durationMs || 0;
        recordUsage(usage, ctx.backend, res.raw);
        return ctx.backend.extractText(res.raw);
      };

      let result;
      try {
        if (opts.schema) {
          const outcome = await runWithSchema(callBackend, prompt, opts.schema, {
            nativeSchema: !!ctx.backend.supportsSchemaNatively,
          });
          result = outcome.result;
        } else {
          result = await callBackend(prompt);
        }
      } catch (err) {
        timedOut = !!err.timedOut;
        const settled = settleUsage(usage);
        if (err instanceof SchemaValidationError) {
          ctx.journal.append({
            key, index, label, phase: effPhase, status: 'error', durationMs,
            ...settled,
            error: err.message, raw: String(err.raw || '').slice(0, 20000),
          });
          ctx.emit({ type: 'agent-end', runId: ctx.runId, label, phase: effPhase, index, status: 'error', error: err.message, ts: nowIso() });
          throw err; // hard-fail: schema validation failed after one retry
        }
        // Any other backend failure (spawn error, terminal non-zero exit, a
        // child killed at the timeout after its retries): per API.md,
        // agent() resolves to null rather than rejecting.
        ctx.journal.append({
          key, index, label, phase: effPhase, status: 'error', durationMs,
          ...settled, timedOut, error: err.message,
        });
        ctx.emit({ type: 'agent-end', runId: ctx.runId, label, phase: effPhase, index, status: 'error', timedOut, error: err.message, ts: nowIso() });
        return null;
      }

      const settled = settleUsage(usage);
      ctx.journal.append({
        key, index, label, phase: effPhase, status: 'ok', result, durationMs, ...settled,
      });
      ctx.emit({
        type: 'agent-end', runId: ctx.runId, label, phase: effPhase, index, status: 'ok',
        tokens: settled.tokens, tokensSource: settled.tokensSource, ts: nowIso(),
      });
      return result;
    } finally {
      release();
      if (wt) {
        // eslint-disable-next-line no-await-in-loop
        const outcome = await worktree.cleanup(wt);
        if (!outcome.removed) {
          log(`worktree left in place (dirty): ${outcome.path}`);
        }
      }
    }
  }

  // parallel()/pipeline() swallow a lane's failure into `null` by contract
  // (API.md) — but NOT a cap breach. A budget error that degrades to null is
  // a cap the runaway loop keeps running past: the loop reads null, logs it,
  // and calls agent() again. Re-raising ends the run instead.
  function rethrowIfFatal(err) {
    if (err instanceof budgetLib.BudgetExceededError) throw err;
  }

  async function parallel(thunks) {
    return Promise.all(thunks.map(async (thunk) => {
      try {
        return await thunk();
      } catch (err) {
        rethrowIfFatal(err);
        return null;
      }
    }));
  }

  async function pipeline(items, ...stages) {
    return Promise.all(items.map(async (item, index) => {
      let value = item;
      for (const stage of stages) {
        try {
          // eslint-disable-next-line no-await-in-loop
          value = await stage(value, item, index);
        } catch (err) {
          rethrowIfFatal(err);
          return null;
        }
      }
      return value;
    }));
  }

  // `total`/`remaining()` are real numbers whenever a token cap is
  // configured (budget.js), and only fall back to null/Infinity when the run
  // genuinely has no ceiling — the honest answer for "no target set", and no
  // longer the invitation to loop forever that a hardcoded Infinity was.
  const budget = budgetLib.createBudget(caps, ctx.journal);

  async function workflow(nameOrRef, childArgs) {
    if (!ctx.runChildWorkflow) {
      throw new Error('workflow(): nesting is one level only — this script is already running as a child workflow');
    }
    return ctx.runChildWorkflow(nameOrRef, childArgs);
  }

  return {
    args: ctx.args,
    agent,
    parallel,
    pipeline,
    log,
    phase,
    budget,
    workflow,
    Date: makeRestrictedDate(),
    Math: makeRestrictedMath(),
  };
}

function makeLimiter(max) {
  let active = 0;
  const queue = [];
  function next() {
    if (active >= max || queue.length === 0) return;
    active += 1;
    const resolve = queue.shift();
    resolve(() => { active -= 1; next(); });
  }
  return {
    acquire() {
      return new Promise((resolve) => {
        queue.push(resolve);
        next();
      });
    },
  };
}

function nowIso() {
  // The runner's OWN clock, not the sandboxed script's — restricting Date is
  // a script-facing rule (see API.md), not a rule on yoki-graph itself.
  return new Date().toISOString();
}

function makeRestrictedDate() {
  const RealDate = Date;
  function RestrictedDate(...args) {
    if (!new.target) return RealDate(...args); // Date() called without `new` — timestamp string, harmless
    if (args.length === 0) {
      throw new Error("new Date() with no arguments is unavailable in workflow scripts (would break --resume) — pass timestamps via args instead");
    }
    return new RealDate(...args);
  }
  RestrictedDate.prototype = RealDate.prototype;
  RestrictedDate.now = () => {
    throw new Error('Date.now() is unavailable in workflow scripts (would break --resume) — pass timestamps via args instead');
  };
  RestrictedDate.parse = RealDate.parse.bind(RealDate);
  RestrictedDate.UTC = RealDate.UTC.bind(RealDate);
  return RestrictedDate;
}

function makeRestrictedMath() {
  return new Proxy(Math, {
    get(target, prop, receiver) {
      if (prop === 'random') {
        return () => {
          throw new Error('Math.random() is unavailable in workflow scripts (would break --resume) — vary the agent prompt/label by index instead');
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** `opts.timeoutMs` per call, else the run's `--timeout`, else the 15-minute
 *  fallback above. `0` or a negative value means "no timeout" explicitly. */
function timeoutFor(opts, ctx) {
  const chosen = [opts.timeoutMs, ctx.timeoutMs].find((v) => Number.isFinite(v));
  const ms = chosen === undefined ? DEFAULT_AGENT_TIMEOUT_MS : chosen;
  return ms > 0 ? ms : undefined;
}

function newUsageAccumulator() {
  return {
    reportedTokens: 0, estimatedTokens: 0,
    inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0,
    costUsd: 0, hasCost: false, sawReported: false, sawEstimate: false,
  };
}

/**
 * Fold one backend invocation's usage into this call's accumulator.
 *
 * The token counts come from the backend's OWN primary source when it has
 * one — `turn.completed` in codex's `--json` stream, the `usage` block and
 * `total_cost_usd` in claude's `--output-format json` envelope, an omp
 * assistant record's `usage` — read off the backend's raw envelope, before
 * `extractText` unwraps it. (Reading the unwrapped text was the old bug:
 * claude's answer string carries no usage at all, so `budget.spent()` sat
 * silently at zero.)
 *
 * When a backend reports nothing, the tokens are ESTIMATED from the output
 * length and labelled as such, rather than counted as zero. A zero looks
 * like a free call; an estimate that says it is an estimate does not lie to
 * whoever reconciles this against the cost tracker.
 */
function recordUsage(acc, backend, raw) {
  const reported = typeof backend.extractUsage === 'function' ? backend.extractUsage(raw) : null;
  if (reported && Number.isFinite(reported.totalTokens) && reported.totalTokens > 0) {
    acc.reportedTokens += reported.totalTokens;
    acc.inputTokens += reported.inputTokens || 0;
    acc.outputTokens += reported.outputTokens || 0;
    acc.cacheRead += reported.cacheRead || 0;
    acc.cacheWrite += reported.cacheWrite || 0;
    acc.sawReported = true;
  } else {
    acc.estimatedTokens += estimateTokens(raw);
    acc.sawEstimate = true;
  }
  if (reported && typeof reported.costUsd === 'number') {
    acc.costUsd += reported.costUsd;
    acc.hasCost = true;
  }
}

/** ~4 characters per token — the same order-of-magnitude rule of thumb the
 *  prior-art runners use for unreported backends. Only ever reached through
 *  the `estimated` label. */
function estimateTokens(raw) {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw || '');
  return Math.ceil(String(text).length / 4);
}

/** Turn the accumulator into the fields a journal entry carries. */
function settleUsage(acc) {
  const tokens = acc.reportedTokens + acc.estimatedTokens;
  let tokensSource = 'reported';
  if (acc.sawReported && acc.sawEstimate) tokensSource = 'mixed';
  else if (!acc.sawReported) tokensSource = 'estimated';
  return {
    tokens,
    tokensSource,
    usage: {
      reportedTokens: acc.reportedTokens,
      estimatedTokens: acc.estimatedTokens,
      inputTokens: acc.inputTokens,
      outputTokens: acc.outputTokens,
      cacheRead: acc.cacheRead,
      cacheWrite: acc.cacheWrite,
      ...(acc.hasCost ? { costUsd: acc.costUsd } : {}),
    },
  };
}

module.exports = {
  createApi,
  makeLimiter,
  estimateTokens,
  timeoutFor,
  DEFAULT_AGENT_TIMEOUT_MS,
};
