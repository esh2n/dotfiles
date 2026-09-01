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
 * @param {boolean} [ctx.resume] - whether to consult the journal cache
 * @param {number} [ctx.concurrency] - max concurrent agent() backend calls
 * @param {(event: object) => void} ctx.emit - progress/NDJSON sink
 * @param {(nameOrRef: any, args: any) => Promise<any>} [ctx.runChildWorkflow]
 *   injected by runner.js to avoid a require cycle; used by the `workflow()`
 *   global. Absent/throws when this context is itself already a child (one
 *   level of nesting only).
 * @param {number} [ctx.timeoutMs]
 */
function createApi(ctx) {
  const state = {
    currentPhase: null,
    worktreeCounter: 0,
  };
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

    if (ctx.resume) {
      const cached = ctx.journal.getCached(key);
      if (cached) {
        ctx.emit({ type: 'agent-cached', runId: ctx.runId, label, phase: effPhase, ts: nowIso() });
        return cached.result;
      }
    }

    ctx.emit({ type: 'agent-start', runId: ctx.runId, label, phase: effPhase, model, ts: nowIso() });

    if (ctx.dryRun) {
      const { placeholderFor } = require('./schema');
      const result = opts.schema ? placeholderFor(opts.schema) : `[dry-run] ${label}: ${prompt.slice(0, 120)}`;
      ctx.emit({ type: 'agent-end', runId: ctx.runId, label, phase: effPhase, status: 'dry-run', ts: nowIso() });
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
      // (schema retry means callBackend can run twice) so the journal's
      // durationMs reflects the full wall time this call spent in the backend.
      let durationMs = 0;
      const callBackend = async (promptText) => {
        const res = await ctx.backend.run({
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
          timeoutMs: ctx.timeoutMs,
        });
        durationMs += res.durationMs || 0;
        return ctx.backend.extractText(res.raw);
      };

      let result;
      let tokens;
      let raw;
      try {
        if (opts.schema) {
          const outcome = await runWithSchema(callBackend, prompt, opts.schema, {
            nativeSchema: !!ctx.backend.supportsSchemaNatively,
          });
          result = outcome.result;
          raw = outcome.raw;
        } else {
          raw = await callBackend(prompt);
          result = raw;
        }
      } catch (err) {
        if (err instanceof SchemaValidationError) {
          ctx.journal.append({
            key, label, phase: effPhase, status: 'error', durationMs,
            error: err.message, raw: String(err.raw || '').slice(0, 20000),
          });
          ctx.emit({ type: 'agent-end', runId: ctx.runId, label, phase: effPhase, status: 'error', error: err.message, ts: nowIso() });
          throw err; // hard-fail: schema validation failed after one retry
        }
        // Any other backend failure (spawn error, terminal non-zero exit):
        // per API.md, agent() resolves to null rather than rejecting.
        ctx.journal.append({ key, label, phase: effPhase, status: 'error', durationMs, error: err.message });
        ctx.emit({ type: 'agent-end', runId: ctx.runId, label, phase: effPhase, status: 'error', error: err.message, ts: nowIso() });
        return null;
      }

      tokens = extractTokens(raw);
      ctx.journal.append({
        key, label, phase: effPhase, status: 'ok', result, tokens, durationMs,
      });
      ctx.emit({ type: 'agent-end', runId: ctx.runId, label, phase: effPhase, status: 'ok', tokens, ts: nowIso() });
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

  async function parallel(thunks) {
    return Promise.all(thunks.map(async (thunk) => {
      try {
        return await thunk();
      } catch {
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
        } catch {
          return null;
        }
      }
      return value;
    }));
  }

  const budget = {
    total: null, // no turn-level directive exists outside a Claude Code turn
    spent() { return ctx.journal.tokensSpent(); },
    remaining() { return Infinity; },
  };

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

/** Best-effort token-count extraction from a backend's raw output — every
 *  backend's own envelope shape differs and none is guaranteed present, so
 *  this always degrades to `undefined` rather than throwing. */
function extractTokens(raw) {
  try {
    const obj = JSON.parse(raw);
    const usage = obj && (obj.usage || (obj.result && obj.result.usage));
    if (usage) {
      const input = usage.input_tokens || usage.prompt_tokens || 0;
      const output = usage.output_tokens || usage.completion_tokens || 0;
      const total = usage.total_tokens || (input + output);
      if (total) return total;
    }
  } catch {
    // raw wasn't a single JSON object (e.g. codex's JSONL stream) — scan
    // line by line for a usage-bearing event as a fallback.
    const lines = String(raw).split('\n');
    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        const usage = evt && evt.usage;
        if (usage && usage.total_tokens) return usage.total_tokens;
      } catch {
        // not a JSON line — ignore
      }
    }
  }
  return undefined;
}

module.exports = { createApi, makeLimiter };
