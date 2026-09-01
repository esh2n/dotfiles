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
const gateLib = require('./gate');
const retry = require('./retry');
const budgetLib = require('./budget');
const models = require('./models');
const backends = require('./backends');

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
 * @param {object} ctx.backend - the run-level default backend module (one of
 *   backends/{codex,omp,mock}.js). A single `agent()` call can override it
 *   with `{backend: 'codex'|'omp'|'mock'}`; see `backendFor` below.
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
 * @param {number} [ctx.gateTimeoutMs] - run-level `opts.gate` timeout default
 * @param {(command:string, options:object) => Promise<object>} [ctx.runGate]
 *   injectable gate executor (tests); defaults to gate.js's `run`.
 * @param {object} [ctx.caps] - budget.js caps; defaults applied when absent
 * @param {number} [ctx.retries] - transient-failure retries per backend call
 * @param {number} [ctx.retryBaseDelayMs]
 * @param {number} [ctx.retryMaxDelayMs]
 * @param {(ms:number) => Promise<void>} [ctx.sleep] - injected in tests
 * @param {number} [ctx.startedAt] - run start (ms) for the wall-clock cap
 * @param {object} [ctx.modelMap] - parsed `--model-map` tier overrides
 * @param {object|null} [ctx.harnessModels] - parsed core/harness-models.json
 * @param {number} [ctx.startIndex] - arrival-order position of this
 *   context's FIRST agent() call; defaults to 0. Used by yoki-agent to
 *   continue an existing run's journal sequence under `--run-id`.
 */
function createApi(ctx) {
  const state = {
    currentPhase: null,
    worktreeCounter: 0,
    // Position of the next agent() call in arrival order. This is what
    // resume replays against — see journal.js's header.
    //
    // A run normally starts at 0. `ctx.startIndex` lets a caller that is
    // journaling into an EXISTING run continue the sequence instead —
    // yoki-agent with `--run-id <existing>`, whose fresh context otherwise
    // began at 0 again and wrote a second entry claiming index 0, colliding
    // with the first rather than following it.
    callIndex: Number.isInteger(ctx.startIndex) && ctx.startIndex > 0 ? ctx.startIndex : 0,
    // index -> last reported live tool-call count, so agent-progress is
    // emitted only when the number actually moves.
    toolCalls: new Map(),
    // Calls actually dispatched (replayed ones are free), counted against
    // the agent-call cap.
    liveCalls: 0,
    // Cleared for good at the first divergence: once this run's call
    // sequence stops matching the journal's, NOTHING later may be replayed,
    // because every later result was computed from a different upstream.
    replaying: !!ctx.resume,
  };
  const caps = ctx.caps || budgetLib.resolveCaps(ctx.cwd);
  const runBackendName = (ctx.backend && ctx.backend.name) || 'mock';
  const modelOptions = { overrides: ctx.modelMap || {}, harnessModels: ctx.harnessModels };
  const startedAt = Number.isFinite(ctx.startedAt) ? ctx.startedAt : Date.now();
  // ONE limiter for the whole run, shared across backends: a mixed
  // codex+omp run must not get twice the concurrency (and twice the machine
  // load) just because it spread its calls over two CLIs.
  const limiter = makeLimiter(ctx.concurrency || 4);

  /**
   * The backend module this ONE call runs on: `agent(prompt, {backend})`
   * overrides the run-level `--backend` (MP1). Resolved per call rather than
   * captured once, so a single run can mix codex and omp lanes — each with
   * its own model map, its own schema-native support and its own usage
   * reader — while sharing this run's limiter, journal, caps and progress.
   */
  function backendFor(opts) {
    const requested = typeof opts.backend === 'string' ? opts.backend.trim() : '';
    if (!requested || requested === runBackendName) {
      return { name: runBackendName, module: ctx.backend };
    }
    return { name: requested, module: backends.loadBackend(requested) };
  }

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
    // Per-call `backend` wins over the run's `--backend`, and the model is
    // resolved against THAT backend's tier map: `sonnet` is a different id
    // on codex than on omp, so resolving against the run backend would have
    // handed a codex id to omp in a mixed run.
    const { name: backendName, module: backend } = backendFor(opts);
    // Per-call `model` wins over the run's `--model`. Resolved HERE rather
    // than inside the backend so the id the backend will actually be given
    // is what every event, journal line and status row reports — a progress
    // line reading "sonnet" tells you nothing about which model ran.
    const requestedModel = opts.model || ctx.model;
    const resolvedModel = models.resolve(backendName, requestedModel, modelOptions);
    const model = resolvedModel.id || undefined;
    const effort = opts.effort || ctx.effort;
    const label = opts.label || '(unlabeled)';
    // A workflow-authored shell command (see gate.js's trust boundary) run
    // after this call returns, whose exit code decides whether the result
    // stands. Blank/absent means no gate — the default for every call.
    const gateCommand = typeof opts.gate === 'string' && opts.gate.trim() ? opts.gate.trim() : null;
    // The RESOLVED backend and model are part of the call's identity, not
    // just of its display: the same prompt answered by gpt-5.4-mini and by
    // gpt-5.6-sol is not the same work, so a `--resume` that changed
    // `--model`/`--model-map`/`{backend}` must re-run the call instead of
    // replaying a result some other model produced.
    //
    // `opts.gate` rides along inside `normalizedOpts` and is therefore part
    // of the key by construction — which is the behaviour we want and a
    // journal.test.js case pins: a result recorded WITHOUT a gate was never
    // verified by one, and a result recorded under a DIFFERENT gate was
    // verified against a different bar, so neither is reusable for this call.
    const key = callKey(prompt, normalizedOpts, { backend: backendName, model });
    const index = state.callIndex;
    state.callIndex += 1;

    if (state.replaying) {
      const cached = ctx.journal.replayAt(index, key);
      if (cached) {
        ctx.emit({
          type: 'agent-cached', runId: ctx.runId, label, phase: effPhase, index,
          backend: backendName, model: cached.model || model, ts: nowIso(),
        });
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

    ctx.emit({
      type: 'agent-start', runId: ctx.runId, label, phase: effPhase, index,
      backend: backendName, model, modelTier: resolvedModel.tier, ts: nowIso(),
    });

    if (ctx.dryRun) {
      const { placeholderFor } = require('./schema');
      const result = opts.schema ? placeholderFor(opts.schema) : `[dry-run] ${label}: ${prompt.slice(0, 120)}`;
      ctx.emit({
        type: 'agent-end', runId: ctx.runId, label, phase: effPhase, index,
        backend: backendName, model, status: 'dry-run', ts: nowIso(),
      });
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
        const res = await retry.withRetry(() => backend.run({
          prompt: promptText,
          model,
          effort,
          schema: opts.schema,
          agentType,
          // Every real backend defaults to its own least-privilege mode;
          // only a script that actually writes asks for more, per call.
          // codex has a native `-s`; omp expresses read-only through its
          // own --tools allow-list rather than ignoring the option. See
          // each backend's DEFAULT_SANDBOX.
          sandbox: opts.sandbox,
          cwd: effectiveCwd,
          opts: normalizedOpts,
          mockFile: ctx.mockFile,
          timeoutMs: timeoutFor(opts, ctx),
          // Live tool-call counting: each backend parses its own event
          // stream as it arrives and calls this whenever the count moves,
          // so a long-running lane shows activity instead of a frozen line.
          onProgress: ({ toolCalls }) => {
            if (state.toolCalls.get(index) === toolCalls) return;
            state.toolCalls.set(index, toolCalls);
            ctx.emit({
              type: 'agent-progress', runId: ctx.runId, label, phase: effPhase, index,
              backend: backendName, model, toolCalls, ts: nowIso(),
            });
          },
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
              backend: backendName, model, attempt, retries: maxRetries, delayMs,
              error: error.message, ts: nowIso(),
            });
          },
        });
        durationMs += res.durationMs || 0;
        recordUsage(usage, backend, res.raw);
        return backend.extractText(res.raw);
      };

      let result;
      try {
        if (opts.schema) {
          const outcome = await runWithSchema(callBackend, prompt, opts.schema, {
            nativeSchema: !!backend.supportsSchemaNatively,
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
            backend: backendName, model, ...settled,
            error: err.message, raw: String(err.raw || '').slice(0, 20000),
          });
          ctx.emit({
            type: 'agent-end', runId: ctx.runId, label, phase: effPhase, index,
            backend: backendName, model, status: 'error', error: err.message, ts: nowIso(),
          });
          throw err; // hard-fail: schema validation failed after one retry
        }
        // Any other backend failure (spawn error, terminal non-zero exit, a
        // child killed at the timeout after its retries): per API.md,
        // agent() resolves to null rather than rejecting.
        ctx.journal.append({
          key, index, label, phase: effPhase, status: 'error', durationMs,
          backend: backendName, model, ...settled, timedOut, error: err.message,
        });
        ctx.emit({
          type: 'agent-end', runId: ctx.runId, label, phase: effPhase, index,
          backend: backendName, model, status: 'error', timedOut, error: err.message, ts: nowIso(),
        });
        return null;
      }

      const settled = settleUsage(usage);

      // ---- gate -----------------------------------------------------------
      // Run AFTER the backend call (and after schema validation, which has
      // already thrown if the shape was wrong: the reader should see the
      // schema error, not a gate error standing in front of it) and BEFORE
      // the `finally` below removes the worktree — `effectiveCwd` is that
      // worktree while it still exists, which is the only moment at which
      // `npm test` means "the code this agent just wrote" rather than
      // "whatever is in the main tree".
      let gateRecord;
      if (gateCommand) {
        const outcome = await (ctx.runGate || gateLib.run)(gateCommand, {
          cwd: effectiveCwd,
          timeoutMs: gateTimeoutFor(opts, ctx),
        });
        gateRecord = gateLib.toRecord(outcome);
        ctx.emit({
          type: 'agent-gate', runId: ctx.runId, label, phase: effPhase, index,
          backend: backendName, model, status: outcome.ok ? 'pass' : 'fail',
          gate: gateRecord, ts: nowIso(),
        });
        if (!outcome.ok) {
          // Failing the agent, not just noting it: an unverified result that
          // still resolves is a gate nobody enforced. This takes the same
          // route as any other terminal backend failure — journaled
          // `status: 'error'` (so `--resume` will NOT replay it and the call
          // re-runs), emitted as a failing `agent-end`, and resolving to
          // `null` per agent()'s documented contract.
          const err = new gateLib.GateFailureError(gateLib.failureMessage(outcome), gateRecord);
          ctx.journal.append({
            key, index, label, phase: effPhase, status: 'error', durationMs,
            backend: backendName, model, ...settled,
            gate: gateRecord, timedOut: err.timedOut, error: err.message,
          });
          ctx.emit({
            type: 'agent-end', runId: ctx.runId, label, phase: effPhase, index,
            backend: backendName, model, status: 'error', timedOut: err.timedOut,
            gate: gateRecord, error: err.message, ts: nowIso(),
          });
          return null;
        }
      }

      ctx.journal.append({
        key, index, label, phase: effPhase, status: 'ok', result, durationMs,
        backend: backendName, model, ...settled,
        ...(gateRecord ? { gate: gateRecord } : {}),
      });
      ctx.emit({
        type: 'agent-end', runId: ctx.runId, label, phase: effPhase, index, status: 'ok',
        backend: backendName, model, tokens: settled.tokens,
        tokensSource: settled.tokensSource, durationMs,
        ...(gateRecord ? { gate: gateRecord } : {}), ts: nowIso(),
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
  // (API.md) — but NOT a cap breach, and NOT an unresolvable per-call
  // backend. A budget error that degrades to null is a cap the runaway loop
  // keeps running past: the loop reads null, logs it, and calls agent()
  // again. A typo'd `{backend: 'codexx'}` that degrades to null is
  // indistinguishable from "that provider found nothing", in every lane at
  // once. Both re-raise and end the run instead.
  function rethrowIfFatal(err) {
    if (err instanceof budgetLib.BudgetExceededError) throw err;
    if (err && err.fatal) throw err;
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

/** `opts.gateTimeoutMs` per call, else the run's `gateTimeoutMs`, else
 *  gate.js's 10-minute default. `0` or negative means "no timeout"
 *  explicitly — the same convention `timeoutFor` uses. Kept separate from
 *  the agent timeout on purpose: a five-minute agent call and a fifteen-
 *  minute test suite are unrelated ceilings, and sharing one number would
 *  make tightening the agent's leash silently truncate the verification. */
function gateTimeoutFor(opts, ctx) {
  const chosen = [opts.gateTimeoutMs, ctx.gateTimeoutMs].find((v) => Number.isFinite(v));
  return chosen === undefined ? gateLib.DEFAULT_GATE_TIMEOUT_MS : chosen;
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
  gateTimeoutFor,
  DEFAULT_AGENT_TIMEOUT_MS,
};
