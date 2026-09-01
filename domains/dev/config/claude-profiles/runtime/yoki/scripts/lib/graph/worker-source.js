'use strict';

/**
 * The JavaScript that runs INSIDE the workflow worker thread.
 *
 * worker-host.js spawns this with `new Worker(WORKER_SOURCE, { eval: true })`,
 * so it has to be an inlined string. It is plain CommonJS and never sees any
 * build step. Two boundaries stack here, and they are not the same boundary:
 *
 *     host thread  <-- postMessage -->  worker thread  <-- vm context -->  script body
 *
 * The worker/host split exists for KILLABILITY: `worker.terminate()` stops a
 * runaway body mid-loop, which an in-process `vm` timeout cannot do once the
 * body is inside an `await`. The vm context exists for DETERMINISM and
 * accident-avoidance (a non-bypassable Date/Math policy, and no host built-ins
 * the body could reach `require`/`process`/the host realm through) — see the
 * note on `codeGeneration` below. Treat it as a determinism boundary, not a
 * security boundary against a hostile script: every workflow this runs is
 * repo-managed, so the threat is "my own bug", not "an adversarial author".
 *
 * The 7 documented globals (agent, parallel, pipeline, phase, log, budget,
 * workflow) are the ONLY things injected on top of the realm's own built-ins,
 * plus `args`, `meta` is deliberately NOT injected (yoki strips the whole
 * `export const meta = {...}` block from the body, as it always has, so the
 * body never referenced it), and a frozen minimal `console` mapped to `log`.
 *
 * agent/workflow are RPC stubs: each call posts `{type:'call', callId, method,
 * payload}` to the host and awaits a `{type:'response', ...}` — the host keeps
 * ALL of the real logic (backend spawn, journal, worktree, guard, budget,
 * models, progress, gate) unchanged. parallel/pipeline stay here because they
 * orchestrate script closures the host can never see; they call the agent stub,
 * so every effect still leaves through the one RPC seam. phase/log/console post
 * fire-and-forget `{type:'emit', ...}` messages, ordered ahead of any agent RPC
 * that follows them because a MessagePort preserves post order.
 */

/**
 * Runs inside the realm, ahead of the body, on ONE line.
 *
 * One line matters: the body is compiled at `\n` + line 1 and the host passes
 * `lineOffset: -1`, so a reported line number matches the file the author
 * wrote. A newline in here would shift every workflow stack frame.
 *
 * Because `Date` and `Math` come FROM the realm, they cannot be neutered by
 * injection — there is nothing to inject over. So:
 *   - `Math.random` is reassigned to throw, then `Math` is frozen so the body
 *     cannot put it back (a plain reassignment silently un-does a stubbed
 *     method; a frozen own property throws under "use strict" instead).
 *   - `Date` is lexically shadowed by a `RestrictedDate` whose zero-arg
 *     constructor and `.now` throw, and the realm's own global `Date` is ALSO
 *     replaced with it — closing `new globalThis.Date()` as a way around the
 *     lexical shadow. The real constructor is captured in a closure the body
 *     can never name, so `globalThis.Date = anything` cannot reach a live
 *     clock. This mirrors api.js's makeRestrictedDate/makeRestrictedMath allow
 *     /deny exactly (Date.now / argless `new Date()` / Math.random throw;
 *     `new Date(x)`, `Date.parse`, `Date.UTC`, `Date()` without `new` and every
 *     other `Math.*` still work) — only now it is not bypassable.
 *
 * Determinism is enforced because a workflow's journal is replayed by prefix on
 * resume: a body that reads the clock produces a different prefix on the second
 * run and the replay silently diverges.
 */
const DETERMINISM_PRELUDE =
  'Math.random = function () { throw new Error("Math.random() is unavailable in workflow scripts (would break --resume) — vary the agent prompt/label by index instead"); };'
  + ' Object.freeze(Math);'
  + ' const Date = (function () {'
  + ' const RealDate = globalThis.Date;'
  + ' RealDate.now = function () { throw new Error("Date.now() is unavailable in workflow scripts (would break --resume) — pass timestamps via args instead"); };'
  + ' function RestrictedDate(...args) {'
  + ' if (!new.target) return RealDate(...args);'
  + ' if (args.length === 0) throw new Error("new Date() with no arguments is unavailable in workflow scripts (would break --resume) — pass timestamps via args instead");'
  + ' return new RealDate(...args);'
  + ' }'
  + ' RestrictedDate.prototype = RealDate.prototype;'
  + ' RestrictedDate.now = RealDate.now;'
  + ' RestrictedDate.parse = RealDate.parse.bind(RealDate);'
  + ' RestrictedDate.UTC = RealDate.UTC.bind(RealDate);'
  + ' globalThis.Date = RestrictedDate;'
  + ' return RestrictedDate;'
  + ' })();';

const WORKER_SOURCE = `"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");

const port = parentPort;
const PRELUDE = ${JSON.stringify(DETERMINISM_PRELUDE)};
const BUDGET_TOTAL = typeof workerData.budgetTotal === "number" ? workerData.budgetTotal : null;

/* ------------------------------------------------------------------ *
 * RPC to the host. The script never touches the agent manager: every
 * effect leaves as a "call" and comes back as a "response", so the host
 * owns the semaphore, the caps, the journal and the abort story.
 * ------------------------------------------------------------------ */

let nextCallId = 1;
const pending = new Map();

/**
 * Output the run has spent, mirrored from the host on every response — one
 * counter, not a second tally, so it cannot drift. Between responses it cannot
 * be stale in any way the script can observe: tokens accrue only through
 * agents, and an agent's response is the only thing the script waits on.
 */
let spentMirror = 0;

function callHost(method, payload) {
  return new Promise(function (resolve, reject) {
    const callId = nextCallId++;
    pending.set(callId, { resolve: resolve, reject: reject });
    port.postMessage({ type: "call", callId: callId, method: method, payload: payload });
  });
}

port.on("message", function (message) {
  if (!message || message.type !== "response") return;
  if (typeof message.spent === "number") spentMirror = message.spent;
  const waiter = pending.get(message.callId);
  if (!waiter) return;
  pending.delete(message.callId);
  if (message.ok) { waiter.resolve(message.value); return; }
  const error = new Error(message.error || "the workflow host rejected the call");
  // A fatal error is the run's, not the item's: parallel()/pipeline() swallow
  // ordinary failures into null, and a cap breach or unknown backend must not
  // be absorbed that way.
  if (message.fatal) error.workflowFatal = true;
  waiter.reject(error);
});

function isFatal(error) {
  return !!(error && typeof error === "object" && error.workflowFatal === true);
}

function emit(method, payload) {
  port.postMessage({ type: "emit", method: method, payload: payload });
}

/* ------------------------------------------------------------------ *
 * The 7 globals (+ console)
 * ------------------------------------------------------------------ */

function agent(prompt, opts) {
  // Validation the host also does, surfaced HERE so a typo stops the script at
  // the call that made it rather than as an opaque host rejection.
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return Promise.reject(new Error("agent(prompt) requires a non-empty string prompt"));
  }
  const options = opts === undefined || opts === null ? {} : opts;
  if (typeof options !== "object" || Array.isArray(options)) {
    return Promise.reject(new Error("agent(prompt, opts) expects opts to be an object"));
  }
  return callHost("agent", { prompt: prompt, opts: options });
}

async function parallel(thunks) {
  if (!Array.isArray(thunks)) throw new Error("parallel(thunks) expects an array of functions");
  return Promise.all(thunks.map(async function (thunk, i) {
    if (typeof thunk !== "function") {
      throw new Error("parallel(thunks) expects an array of functions; item " + i + " is not one");
    }
    try {
      return await thunk();
    } catch (error) {
      if (isFatal(error)) throw error;
      return null;
    }
  }));
}

async function pipeline(items) {
  const stages = Array.prototype.slice.call(arguments, 1);
  if (!Array.isArray(items)) throw new Error("pipeline(items, ...stages) expects items to be an array");
  for (let i = 0; i < stages.length; i++) {
    if (typeof stages[i] !== "function") {
      throw new Error("pipeline(items, ...stages) expects stages to be functions; stage " + i + " is not one");
    }
  }
  return Promise.all(items.map(async function (item, index) {
    let value = item;
    for (let s = 0; s < stages.length; s++) {
      try {
        value = await stages[s](value, item, index);
      } catch (error) {
        if (isFatal(error)) throw error;
        return null;
      }
    }
    return value;
  }));
}

function phase(title) {
  emit("phase", { title: String(title) });
}

function log(message) {
  emit("log", { message: typeof message === "string" ? message : String(message) });
}

function workflow(nameOrRef, args) {
  return callHost("workflow", { nameOrRef: nameOrRef, args: args });
}

const budget = Object.freeze({
  total: BUDGET_TOTAL,
  spent: function () { return spentMirror; },
  remaining: function () {
    return BUDGET_TOTAL === null ? Infinity : Math.max(0, BUDGET_TOTAL - spentMirror);
  },
});

function makeConsole() {
  const write = function () {
    const parts = [];
    for (let i = 0; i < arguments.length; i++) parts.push(String(arguments[i]));
    emit("log", { message: parts.join(" ") });
  };
  return Object.freeze({ log: write, info: write, warn: write, error: write, debug: write });
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

async function main() {
  const sandbox = {
    agent: agent,
    parallel: parallel,
    pipeline: pipeline,
    phase: phase,
    log: log,
    workflow: workflow,
    budget: budget,
    console: makeConsole(),
    args: workerData.args,
  };

  const context = vm.createContext(sandbox, {
    name: "workflow",
    // The load-bearing defense: eval("…") and Function("…") throw EvalError
    // inside the realm, so even a host closure captured off an injected global
    // (agent.constructor === the host Function) cannot compile anything. It
    // does not touch vm.Script compiled from OUT here, which is how the body
    // and prelude get in.
    codeGeneration: { strings: false, wasm: false },
  });

  const script = new vm.Script(
    "(async () => {" + PRELUDE + "\\n" + workerData.body + "\\n})()",
    {
      filename: "workflow.js",
      // The wrapper adds exactly one line above the body; undo it so a thrown
      // error points at the line the author wrote.
      lineOffset: -1,
    }
  );

  const value = await script.runInContext(context);
  // Structured clone, NOT JSON: postMessage preserves Infinity/NaN that a
  // JSON round-trip would flatten to null — budget.remaining() returning
  // Infinity is part of the documented result of a capless run.
  port.postMessage({ type: "complete", value: value });
}

main().catch(function (error) {
  port.postMessage({
    type: "error",
    message: error && error.message ? String(error.message) : String(error),
    stack: error && error.stack ? String(error.stack) : undefined,
  });
});
`;

module.exports = { WORKER_SOURCE, DETERMINISM_PRELUDE };
