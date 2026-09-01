'use strict';

/**
 * Host side of the workflow worker: spawn the worker that runs the body in a
 * `node:vm` context (worker-source.js), then service its RPC by calling the
 * SAME `createApi(ctx)` object the in-process runner always used — so backend
 * spawn, journal, worktree, guard, budget, models, progress and gate keep every
 * bit of their behaviour, now reached across a message boundary instead of a
 * function call.
 *
 * What the boundary buys, and could not before (comparison.md §2-7/§2-8): the
 * body is no longer in the host realm, the Date/Math determinism policy is no
 * longer bypassable, and a runaway or wedged body can actually be KILLED —
 * `worker.terminate()` on a wall-time cap, an explicit abort, or a run-level
 * idle watchdog, each surfacing as a clean run error rather than a hung process.
 *
 * The RPC shape:
 *   worker -> host : {type:'call', callId, method:'agent'|'workflow', payload}
 *                    {type:'emit', method:'phase'|'log', payload}
 *                    {type:'complete', value}   (structured-cloned, not JSON)
 *                    {type:'error', message, stack}
 *   host -> worker : {type:'response', callId, ok, value, error, fatal, spent}
 *
 * `spent` rides on every response so the worker's `budget.spent()` is a mirror
 * of this run's journal total, never a second tally.
 */

const { Worker } = require('node:worker_threads');
const { WORKER_SOURCE } = require('./worker-source');
const budgetLib = require('./budget');

/**
 * Run one compiled body to completion in an isolated worker.
 *
 * @param {object} opts
 * @param {string} opts.body                 the script body (meta already stripped)
 * @param {object} opts.api                  createApi(ctx) — the host globals
 * @param {*} opts.args                       args value for the script
 * @param {number|null} opts.budgetTotal      token cap for the worker's `budget.total`
 * @param {import('./journal').Journal} opts.journal
 * @param {number} [opts.maxWallMs]           finite -> terminate the run at this age
 * @param {number} [opts.idleTimeoutMs]       finite -> terminate after this long with no agent activity
 * @param {AbortSignal} [opts.signal]         abort -> terminate the run
 * @returns {Promise<*>} the script's return value (rejects on script error / termination)
 */
function runBodyInWorker(opts) {
  const {
    body, api, args, budgetTotal, journal,
    maxWallMs, idleTimeoutMs, signal,
  } = opts;

  return new Promise(function (resolve, reject) {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      // spentTotal seeds the worker's budget.spent()/remaining() mirror so it is
      // correct from the body's FIRST read — before any agent()/workflow() RPC
      // round-trip. It matters on --resume, where the journal already carries
      // real spend from a prior invocation.
      workerData: { body: body, args: args, budgetTotal: budgetTotal, spentTotal: journal.spent() },
    });

    let settled = false;
    let wallTimer = null;
    let idleTimer = null;

    function clearTimers() {
      if (wallTimer) { clearTimeout(wallTimer); wallTimer = null; }
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    }

    function armIdle() {
      if (!(Number.isFinite(idleTimeoutMs) && idleTimeoutMs > 0)) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(function () {
        terminate('graph budget: no agent activity for ' + idleTimeoutMs + 'ms — the workflow body was terminated by the idle watchdog');
      }, idleTimeoutMs);
      if (idleTimer.unref) idleTimer.unref();
    }

    function settle(fn) {
      if (settled) return;
      settled = true;
      clearTimers();
      if (signal) signal.removeEventListener('abort', onAbort);
      // Resolve/reject only once the thread is actually down, so a caller that
      // awaits this is guaranteed not to leak a worker.
      worker.terminate().then(fn, fn);
    }
    function finishOk(value) { settle(function () { resolve(value); }); }
    function finishErr(error) { settle(function () { reject(error); }); }
    function terminate(message) { finishErr(new Error(message)); }
    function onAbort() { terminate('the workflow was aborted'); }

    function respond(callId, ok, value, error, fatal) {
      if (settled) return;
      worker.postMessage({
        type: 'response', callId: callId, ok: ok, value: value,
        // journal.spent() is an O(1) running total (journal.js), not a full
        // re-read+parse of the journal per RPC — so stamping the worker's
        // budget mirror on every response is not an O(n)-per-call cost.
        error: error, fatal: fatal, spent: journal.spent(),
      });
    }

    async function handleAgent(callId, payload) {
      armIdle(); // agent traffic IS the activity the watchdog measures
      try {
        const value = await api.agent(payload.prompt, payload.opts || {});
        respond(callId, true, value);
      } catch (error) {
        respond(callId, false, undefined, messageOf(error), isFatalError(error));
      }
    }

    async function handleWorkflow(callId, payload) {
      // A nested workflow() is real activity too: it spawns and awaits a whole
      // child run (its own agent() calls), during which the parent worker is
      // blocked on this RPC. Without re-arming, the parent's idle watchdog would
      // fire and kill a run that is actively progressing through its child.
      armIdle();
      try {
        const value = await api.workflow(payload.nameOrRef, payload.args);
        respond(callId, true, value);
      } catch (error) {
        respond(callId, false, undefined, messageOf(error), isFatalError(error));
      }
    }

    // The worker's lifecycle listeners are attached BEFORE the pre-aborted
    // early-return below: the Worker is already spawning asynchronously, so it
    // could emit 'error' during startup even in the aborted path — and an
    // 'error' event with no listener throws out of the host process (Node's
    // default EventEmitter behaviour), crashing the whole run rather than
    // failing this one call.
    worker.on('message', function (message) {
      if (!message || settled) return;
      switch (message.type) {
        case 'call':
          if (message.method === 'agent') { void handleAgent(message.callId, message.payload); return; }
          if (message.method === 'workflow') { void handleWorkflow(message.callId, message.payload); return; }
          respond(message.callId, false, undefined, 'unknown host call "' + message.method + '"', true);
          return;
        case 'emit':
          if (message.method === 'phase') api.phase(message.payload.title);
          else if (message.method === 'log') api.log(message.payload.message);
          return;
        case 'complete':
          finishOk(message.value);
          return;
        case 'error':
          finishErr(new Error(message.message || 'the workflow script failed'));
          return;
        default:
          return;
      }
    });

    worker.on('error', function (error) {
      finishErr(error instanceof Error ? error : new Error(String(error)));
    });
    worker.on('exit', function (code) {
      // Only meaningful if we did not ask for it: a normal settle terminates the
      // worker itself (settled is already true by then).
      if (!settled) finishErr(new Error('the workflow worker exited unexpectedly (code ' + code + ')'));
    });

    // Listeners are live now, so a pre-aborted signal can terminate cleanly
    // without leaving an 'error' event unhandled.
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    if (Number.isFinite(maxWallMs) && maxWallMs > 0) {
      wallTimer = setTimeout(function () {
        // Same wording as budget.js's assertWithinCaps so either the in-agent
        // cap or this terminator satisfies a "wall-clock cap reached" assertion.
        terminate('graph budget: wall-clock cap reached (' + maxWallMs + 'ms) — the workflow body was terminated');
      }, maxWallMs);
      if (wallTimer.unref) wallTimer.unref();
    }
    armIdle();
  });
}

/** A budget breach or an unknown backend is the run's, not the item's, so
 *  parallel()/pipeline() must re-raise it — same rule api.js's rethrowIfFatal
 *  applies in-process. */
function isFatalError(error) {
  return (error instanceof budgetLib.BudgetExceededError) || !!(error && error.fatal);
}

function messageOf(error) {
  return error && error.message ? String(error.message) : String(error);
}

module.exports = { runBodyInWorker };
