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
 *       [--mock <file>] [--timeout <ms>] [--retries N]
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

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const BOOLEAN_FLAGS = new Set(['dry-run', 'json', 'watch']);
    if (BOOLEAN_FLAGS.has(key)) { out[key] = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) { out[key] = true; continue; }
    out[key] = value;
    i += 1;
  }
  return out;
}

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
    retries: numberFlag(flags.retries),
    maxAgentCalls: numberFlag(flags['max-agent-calls']),
    maxTokens: numberFlag(flags['max-tokens']),
    maxWallMs: numberFlag(flags['max-wall-ms']),
    modelMap: models.parseModelMap(typeof flags['model-map'] === 'string' ? flags['model-map'] : ''),
  });

  printer.finish();
  if (!flags.json) {
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

function numberFlag(value) {
  if (value === undefined || value === true) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Per-model breakdown for the end of a run: which models actually ran, how
 * many calls each took, and what they cost in tokens and model-seconds.
 * Keyed by the RESOLVED id, so a run that mixed a tier default with a
 * per-call override shows both rows rather than one blurred total.
 */
function formatModelTable(rows) {
  const pad = (text, width) => String(text).padEnd(width);
  const modelWidth = Math.max(5, ...rows.map((r) => r.model.length));
  const lines = [`\n${pad('model', modelWidth)}  calls    tokens      wall`];
  for (const row of rows) {
    lines.push([
      pad(row.model, modelWidth),
      String(row.calls).padStart(5),
      String(row.tokens).padStart(9),
      progress.formatElapsed(row.wallMs).padStart(9),
    ].join('  '));
  }
  return `${lines.join('\n')}\n`;
}

/** One line of end-of-run accounting. Measured and estimated tokens are
 *  reported separately on purpose: a total that silently mixes them cannot
 *  be reconciled against the cost tracker. */
function formatUsage(usage) {
  const parts = [`tokens: ${usage.tokens} (${usage.reportedTokens} reported, ${usage.estimatedTokens} estimated)`];
  parts.push(`over ${usage.calls} agent call${usage.calls === 1 ? '' : 's'}`);
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

function cmdStatus(rest, flags) {
  const runId = rest[0];
  if (!runId) throw new Error('usage: yoki-graph status <runId>');
  const meta = runner.readRunMeta(runId);
  const journal = new journalLib.Journal(runId);
  const entries = journal.readAll();
  const payload = {
    runId,
    meta,
    agentCalls: entries.filter((e) => e.status !== 'retry').length,
    ok: entries.filter((e) => e.status === 'ok').length,
    errors: entries.filter((e) => e.status === 'error').length,
    retries: entries.filter((e) => e.status === 'retry').length,
    usage: journal.usageTotals(),
    byModel: journal.usageByModel(),
    entries,
  };
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  if (!meta) {
    process.stdout.write(`no run found with id ${runId} (looked in ${journalLib.runDir(runId)})\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`run: ${meta.name} (${runId})\nstatus: ${meta.status}\nbackend: ${meta.backend}\nagent calls: ${payload.agentCalls} (${payload.ok} ok, ${payload.errors} error, ${payload.retries} retried)\n`);
  process.stdout.write(`${formatUsage(payload.usage)}\n`);
  if (payload.byModel.length) process.stdout.write(formatModelTable(payload.byModel));
  if (meta.error) process.stdout.write(`error: ${meta.error}\n`);
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

  let lastWidth = 0;
  for (let poll = 0; poll < maxPolls; poll += 1) {
    const meta = runner.readRunMeta(runId);
    if (!meta) {
      stream.write(`no run found with id ${runId} (looked in ${journalLib.runDir(runId)})\n`);
      process.exitCode = 1;
      return;
    }
    const entries = new journalLib.Journal(runId).readAll();
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
      cmdStatus([runId], { ...flags, watch: false });
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
