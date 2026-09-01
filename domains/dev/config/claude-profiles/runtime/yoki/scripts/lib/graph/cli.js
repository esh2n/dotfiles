#!/usr/bin/env node
'use strict';

/**
 * yoki-graph CLI — execute a Workflow-tool-shaped script outside Claude
 * Code. See API.md for the script-facing surface and runner.js for the
 * execution engine this dispatches into.
 *
 *   yoki-graph run <name|path> --backend codex|omp|mock
 *       [--args '<json>' | --args-file <f>] [--cwd <dir>]
 *       [--resume <runId>] [--dry-run] [--json] [--concurrency N]
 *       [--model haiku|sonnet|opus|<id>] [--effort low|medium|high|xhigh|max]
 *       [--mock <file>] [--timeout <ms>] [--gate-timeout <ms>] [--retries N]
 *       [--max-agent-calls N] [--max-tokens N] [--max-wall-ms N]
 *       [--model-map <tier>=<id>,...]
 *   yoki-graph list
 *   yoki-graph status <runId> [--watch]
 */

const fs = require('fs');
const path = require('path');

const runner = require('./runner');
const journalLib = require('./journal');
const models = require('./models');
const progress = require('./progress');
const { parseArgs: parseArgv, numberFlag } = require('./args');

/** The flags of this CLI that never take a value. Everything else is
 *  `--key value`; see args.js, which agent-cli.js parses with too. */
const BOOLEAN_FLAGS = ['dry-run', 'json', 'watch'];

const parseArgs = (argv) => parseArgv(argv, BOOLEAN_FLAGS);

function fail(message) {
  process.stderr.write(`yoki-graph: ${message}\n`);
  process.exitCode = 1;
}

function readArgsValue(flags) {
  if (flags['args-file']) {
    const text = fs.readFileSync(path.resolve(flags['args-file']), 'utf8');
    return JSON.parse(text);
  }
  if (flags.args) {
    try {
      return JSON.parse(flags.args);
    } catch (err) {
      throw new Error(`--args is not valid JSON: ${err.message}`);
    }
  }
  return undefined;
}

/**
 * The permanent, one-per-event human line: everything that should still be
 * in the scrollback after the run. Returns null for events that only belong
 * in the live status line (an agent starting, a tool-call tick) — those are
 * folded into progress.js's status instead of printed one by one.
 */
function humanLine(event) {
  const ts = (event.ts || '').slice(11, 19); // HH:MM:SS
  switch (event.type) {
    case 'run-start':
      return `[${ts}] ▶ ${event.name} (run ${event.runId}, backend ${event.backend})\n`;
    case 'phase':
      return `[${ts}] ── ${event.title} ──\n`;
    case 'log':
      return `[${ts}] ${event.message}\n`;
    case 'agent-start':
      // The resolved model id, not the tier the script asked for: two
      // lanes reading "sonnet" can be running different models once
      // --model-map or a per-call model is in play.
      return `[${ts}]   → ${event.label}${event.model ? ` (${[event.backend, event.model].filter(Boolean).join(' ')})` : ''}${event.phase ? ` [${event.phase}]` : ''}\n`;
    case 'agent-progress':
      return null; // live-only: folded into the status line
    case 'agent-cached':
      return `[${ts}]   ✓ ${event.label} (replayed #${event.index}, --resume)\n`;
    case 'resume-diverged':
      return `[${ts}] ↯ resume diverged at call #${event.index} (${event.label}) — everything from here runs live\n`;
    case 'agent-gate': {
      // The mechanical half of a verification, printed as its own permanent
      // line: which command ran, whether it passed, and how long it cost.
      // A reader scanning the log for "why was this rejected" should find
      // the exit-code verdict without having to open the JSON stream.
      const g = event.gate || {};
      const verdict = event.status === 'pass' ? 'pass' : (g.killed ? 'fail (timed out)' : `fail (exit ${g.exitCode})`);
      return `[${ts}]   ⛨ ${event.label} gate: ${g.command} → ${verdict} (${progress.formatElapsed(g.ms || 0)})\n`;
    }
    case 'agent-retry':
      return `[${ts}]   ↻ ${event.label} retry ${event.attempt}/${event.retries} in ${event.delayMs}ms: ${event.error}\n`;
    case 'agent-end': {
      const mark = event.status === 'ok' ? '✓' : event.status === 'dry-run' ? '·' : '✗';
      const model = event.model ? ` (${event.model})` : '';
      return `[${ts}]   ${mark} ${event.label}${model}${event.error ? `: ${event.error}` : ''}\n`;
    }
    case 'guard-denied':
    case 'run-locked':
      return `[${ts}] ✗ ${event.message}\n`;
    case 'run-end':
      return `[${ts}] ${event.status === 'ok' ? '■ done' : `■ ${event.status}${event.error ? `: ${event.error}` : ''}`}\n`;
    default:
      return `[${ts}] ${event.type}\n`;
  }
}

/**
 * `--json` writes the NDJSON event stream verbatim (the machine source of
 * truth). Otherwise events go through progress.js, which prints the
 * permanent lines above and — on a TTY — keeps a live status line beneath
 * them. Off a TTY there is no status line: a `\r` redraw in a log file is
 * one unreadable line.
 */
function makeEmitter({ json, stream = process.stdout, isTty }) {
  if (json) {
    return {
      emit: (event) => { stream.write(`${JSON.stringify(event)}\n`); },
      finish: () => {},
    };
  }
  const renderer = progress.createRenderer({ stream, isTty, lineFor: humanLine });
  return { emit: (event) => renderer.handle(event), finish: () => renderer.finish() };
}

async function cmdRun(rest, flags) {
  const target = rest[0];
  if (!target) throw new Error('usage: yoki-graph run <name|path> --backend codex|omp|mock [...]');
  const backendName = flags.backend || 'mock';
  const cwd = flags.cwd ? path.resolve(flags.cwd) : process.cwd();
  const scriptPath = runner.resolveScriptPath(target, cwd);
  const args = readArgsValue(flags);
  const printer = makeEmitter({ json: !!flags.json });

  const result = await runner.executeScript({
    scriptPath,
    args,
    backendName,
    cwd,
    runId: flags.resume,
    dryRun: !!flags['dry-run'],
    emit: printer.emit,
    concurrency: flags.concurrency ? Number(flags.concurrency) : undefined,
    model: flags.model,
    effort: flags.effort,
    mockFile: flags.mock ? path.resolve(flags.mock) : undefined,
    timeoutMs: numberFlag(flags.timeout),
    gateTimeoutMs: numberFlag(flags['gate-timeout']),
    retries: numberFlag(flags.retries),
    maxAgentCalls: numberFlag(flags['max-agent-calls']),
    maxTokens: numberFlag(flags['max-tokens']),
    maxWallMs: numberFlag(flags['max-wall-ms']),
    modelMap: models.parseModelMap(typeof flags['model-map'] === 'string' ? flags['model-map'] : ''),
  });

  printer.finish();
  if (!flags.json) {
    // Accounting BEFORE the payload, deliberately: `result` is an arbitrary
    // workflow return value (review's findings run to thousands of lines),
    // and a per-model table printed after it is scrolled away on a TTY and
    // buried at the bottom of a redirected log. The numbers a caller checks
    // first — runId, status, tokens, per-model spend — stay at a fixed
    // distance from the top of the summary.
    process.stdout.write(`\nrunId: ${result.runId}\nstatus: ${result.status}\n`);
    if (result.usage) process.stdout.write(`${formatUsage(result.usage)}\n`);
    if (result.byModel && result.byModel.length) process.stdout.write(formatModelTable(result.byModel));
    if (result.status === 'ok') {
      process.stdout.write(`result: ${JSON.stringify(result.result, null, 2)}\n`);
    } else if (result.error) {
      process.stdout.write(`error: ${result.error}\n`);
    }
  }
  if (result.status === 'error' || result.status === 'denied' || result.status === 'locked') process.exitCode = 1;
}

/**
 * Per-model breakdown for the end of a run: which models actually ran on
 * which backend, how many calls each took, and what they cost in tokens and
 * model-seconds. Keyed by the RESOLVED id, so a run that mixed a tier
 * default with a per-call override shows both rows rather than one blurred
 * total; the backend column appears only when a run actually mixed backends
 * (MP1's per-call `{backend}`), so a single-backend run's table is unchanged.
 *
 * `cached` is how much of the input was served from cache. It is reported
 * beside the token count rather than inside it: on codex those tokens are a
 * SUBSET of the input already counted (adding them double-counted a whole
 * run — see backends/codex.js), on omp they are disjoint and the backend's
 * own total already includes them.
 */
function formatModelTable(rows) {
  const pad = (text, width) => String(text).padEnd(width);
  const backends = new Set(rows.map((r) => r.backend || ''));
  const showBackend = backends.size > 1;
  const modelWidth = Math.max(5, ...rows.map((r) => String(r.model).length));
  const backendWidth = showBackend ? Math.max(7, ...rows.map((r) => String(r.backend || '').length)) : 0;
  const header = [pad('model', modelWidth)];
  if (showBackend) header.push(pad('backend', backendWidth));
  header.push('calls', '   tokens', '   cached', '     wall');
  const lines = [`\n${header.join('  ')}`];
  for (const row of rows) {
    const cells = [pad(row.model, modelWidth)];
    if (showBackend) cells.push(pad(row.backend || '', backendWidth));
    cells.push(
      String(row.calls).padStart(5),
      String(row.tokens).padStart(9),
      String(row.cached || 0).padStart(9),
      progress.formatElapsed(row.wallMs).padStart(9),
    );
    lines.push(cells.join('  '));
  }
  return `${lines.join('\n')}\n`;
}

/** One line of end-of-run accounting. Measured and estimated tokens are
 *  reported separately on purpose: a total that silently mixes them cannot
 *  be reconciled against the cost tracker. */
function formatUsage(usage) {
  const parts = [`tokens: ${usage.tokens} (${usage.reportedTokens} reported, ${usage.estimatedTokens} estimated)`];
  parts.push(`over ${usage.calls} agent call${usage.calls === 1 ? '' : 's'}`);
  // Never folded into `tokens`: see formatModelTable's note and API.md.
  if (usage.cachedTokens) parts.push(`${usage.cachedTokens} cached`);
  if (usage.hasCost) parts.push(`cost: $${usage.costUsd.toFixed(4)}`);
  return parts.join(' — ');
}

function cmdList(flags) {
  const items = runner.listWorkflows();
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(items)}\n`);
    return;
  }
  if (!items.length) {
    process.stdout.write(`no workflows found in ${runner.workflowsDir()}\n`);
    return;
  }
  for (const item of items) {
    process.stdout.write(`${item.name}\t${item.description}\n`);
  }
}

/**
 * `deps.stream` (default `process.stdout`) makes the report capturable —
 * `cmdWatch` prints its final report through this, and a test can assert
 * what that report actually contained instead of it leaking to the real
 * stdout unasserted.
 *
 * The journal is read and parsed exactly ONCE here. It used to be three
 * times: `readAll()` for the counts, then `usageTotals()` and
 * `usageByModel()`, each re-reading the whole file synchronously.
 */
function cmdStatus(rest, flags, deps = {}) {
  const runId = rest[0];
  if (!runId) throw new Error('usage: yoki-graph status <runId>');
  const stream = deps.stream || process.stdout;
  const meta = runner.readRunMeta(runId);
  const entries = deps.entries || new journalLib.Journal(runId).readAll();
  const counts = { agentCalls: 0, ok: 0, errors: 0, retries: 0 };
  for (const entry of entries) {
    if (entry.status === 'retry') { counts.retries += 1; continue; }
    counts.agentCalls += 1;
    if (entry.status === 'ok') counts.ok += 1;
    else if (entry.status === 'error') counts.errors += 1;
  }
  const payload = {
    runId,
    meta,
    ...counts,
    usage: journalLib.usageTotalsFrom(entries),
    byModel: journalLib.usageByModelFrom(entries),
    entries,
  };
  if (flags.json) {
    stream.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  if (!meta) {
    stream.write(`no run found with id ${runId} (looked in ${journalLib.runDir(runId)})\n`);
    process.exitCode = 1;
    return;
  }
  stream.write(`run: ${meta.name} (${runId})\nstatus: ${meta.status}\nbackend: ${meta.backend}\nagent calls: ${payload.agentCalls} (${payload.ok} ok, ${payload.errors} error, ${payload.retries} retried)\n`);
  stream.write(`${formatUsage(payload.usage)}\n`);
  if (payload.byModel.length) stream.write(formatModelTable(payload.byModel));
  if (meta.error) stream.write(`error: ${meta.error}\n`);
}

/**
 * Rebuild the live view of a run from its journal, without having produced
 * it. The journal is the same record `run` writes as it goes, so the same
 * `progress.js` state can be folded from it — which is what makes
 * `status --watch` show the same status line as the run's own terminal.
 *
 * Journal lines are in COMPLETION order, so the reconstruction pairs each
 * entry's `index` with a synthetic start rather than assuming arrival order:
 * a call with an entry is finished, and a call whose index is below the
 * highest seen but has no entry is still running.
 */
function watchSnapshot(runId, meta, entries) {
  const state = progress.createState();
  state.runId = runId;
  state.name = meta && meta.name;
  state.backend = meta && meta.backend;
  const seen = new Map();
  for (const entry of entries) {
    if (!entry || entry.status === 'retry') continue;
    seen.set(entry.index, entry);
    if (entry.phase) state.phaseTitle = entry.phase;
  }
  for (const entry of seen.values()) {
    if (entry.status === 'error') state.failed += 1;
    else state.done += 1;
  }
  const highest = entries.reduce((max, e) => (Number.isInteger(e.index) && e.index > max ? e.index : max), -1);
  for (let index = 0; index <= highest; index += 1) {
    if (seen.has(index)) continue;
    // Started but not yet recorded. Its label/model are not in the journal
    // (nothing is written until the call settles), so it shows as pending.
    state.running.set(index, { label: `#${index}`, model: null, startedAt: Date.now(), toolCalls: 0 });
  }
  const status = meta && meta.status;
  state.finished = status !== undefined && status !== 'running';
  state.status = status;
  return state;
}

/**
 * `yoki-graph status <runId> --watch` — re-render every `intervalMs` until
 * the run's own `run.json` stops saying "running", then print the same
 * final report `status` prints. Injectable clock/sleep/stream so the loop is
 * testable without waiting.
 */
async function cmdWatch(rest, flags, deps = {}) {
  const runId = rest[0];
  if (!runId) throw new Error('usage: yoki-graph status <runId> --watch');
  const stream = deps.stream || process.stdout;
  const intervalMs = Number.isFinite(deps.intervalMs) ? deps.intervalMs : 2000;
  const sleep = deps.sleep || ((ms) => new Promise((r) => { setTimeout(r, ms); }));
  const maxPolls = Number.isFinite(deps.maxPolls) ? deps.maxPolls : Infinity;
  const isTty = deps.isTty === undefined ? !!stream.isTTY : deps.isTty;

  // One tailer for the whole loop: each poll parses only the bytes appended
  // since the last one (journal.js's JournalTail), instead of re-reading and
  // re-parsing the entire growing NDJSON every two seconds.
  const tail = new journalLib.JournalTail(runId);
  let lastWidth = 0;
  let entries = [];
  for (let poll = 0; poll < maxPolls; poll += 1) {
    const meta = runner.readRunMeta(runId);
    if (!meta) {
      stream.write(`no run found with id ${runId} (looked in ${journalLib.runDir(runId)})\n`);
      process.exitCode = 1;
      return;
    }
    entries = tail.read();
    const state = watchSnapshot(runId, meta, entries);
    const line = progress.renderStatus(state);
    if (isTty) {
      const padded = line.length < lastWidth ? line + ' '.repeat(lastWidth - line.length) : line;
      stream.write(`\r${padded}`);
      lastWidth = line.length;
    } else {
      stream.write(`${line}\n`);
    }
    if (state.finished) {
      if (isTty && lastWidth) stream.write(`\r${' '.repeat(lastWidth)}\r`);
      // Through the SAME stream the watch line went to, and reusing the
      // entries this loop already parsed: the final report used to go
      // straight to the real process.stdout, so a test could neither
      // capture it nor tell whether it had been printed at all.
      cmdStatus([runId], { ...flags, watch: false }, { stream, entries });
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs);
  }
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const flags = parseArgs(rest);
  const positional = flags._;
  try {
    if (cmd === 'run') await cmdRun(positional, flags);
    else if (cmd === 'list') cmdList(flags);
    else if (cmd === 'status') {
      if (flags.watch) await cmdWatch(positional, flags);
      else cmdStatus(positional, flags);
    }
    else {
      process.stdout.write('usage: yoki-graph run <name|path> --backend codex|omp|mock [...]\n       yoki-graph list\n       yoki-graph status <runId> [--watch]\n');
      if (cmd) process.exitCode = 1;
    }
  } catch (err) {
    fail(err.message);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs, makeEmitter, humanLine, cmdRun, cmdList, cmdStatus, cmdWatch, watchSnapshot, main,
  formatUsage, formatModelTable, numberFlag,
};
