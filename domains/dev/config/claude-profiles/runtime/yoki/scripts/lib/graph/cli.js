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
 *   yoki-graph list
 *   yoki-graph status <runId>
 */

const fs = require('fs');
const path = require('path');

const runner = require('./runner');
const journalLib = require('./journal');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const BOOLEAN_FLAGS = new Set(['dry-run', 'json']);
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

/** Human-readable one-line-per-phase/agent progress printer, or NDJSON when
 *  `--json` was passed — both mirror the journal event shape 1:1. */
function makeEmitter({ json }) {
  return (event) => {
    if (json) {
      process.stdout.write(`${JSON.stringify(event)}\n`);
      return;
    }
    const ts = (event.ts || '').slice(11, 19); // HH:MM:SS
    switch (event.type) {
      case 'run-start':
        process.stdout.write(`[${ts}] ▶ ${event.name} (run ${event.runId}, backend ${event.backend})\n`);
        break;
      case 'phase':
        process.stdout.write(`[${ts}] ── ${event.title} ──\n`);
        break;
      case 'log':
        process.stdout.write(`[${ts}] ${event.message}\n`);
        break;
      case 'agent-start':
        process.stdout.write(`[${ts}]   → ${event.label}${event.phase ? ` [${event.phase}]` : ''}\n`);
        break;
      case 'agent-cached':
        process.stdout.write(`[${ts}]   ✓ ${event.label} (replayed #${event.index}, --resume)\n`);
        break;
      case 'resume-diverged':
        process.stdout.write(`[${ts}] ↯ resume diverged at call #${event.index} (${event.label}) — everything from here runs live\n`);
        break;
      case 'agent-retry':
        process.stdout.write(`[${ts}]   ↻ ${event.label} retry ${event.attempt}/${event.retries} in ${event.delayMs}ms: ${event.error}\n`);
        break;
      case 'agent-end': {
        const mark = event.status === 'ok' ? '✓' : event.status === 'dry-run' ? '·' : '✗';
        process.stdout.write(`[${ts}]   ${mark} ${event.label}${event.error ? `: ${event.error}` : ''}\n`);
        break;
      }
      case 'guard-denied':
        process.stdout.write(`[${ts}] ✗ ${event.message}\n`);
        break;
      case 'run-locked':
        process.stdout.write(`[${ts}] ✗ ${event.message}\n`);
        break;
      case 'run-end':
        process.stdout.write(`[${ts}] ${event.status === 'ok' ? '■ done' : `■ ${event.status}${event.error ? `: ${event.error}` : ''}`}\n`);
        break;
      default:
        process.stdout.write(`[${ts}] ${event.type}\n`);
    }
  };
}

async function cmdRun(rest, flags) {
  const target = rest[0];
  if (!target) throw new Error('usage: yoki-graph run <name|path> --backend codex|omp|mock [...]');
  const backendName = flags.backend || 'mock';
  const cwd = flags.cwd ? path.resolve(flags.cwd) : process.cwd();
  const scriptPath = runner.resolveScriptPath(target, cwd);
  const args = readArgsValue(flags);
  const emit = makeEmitter({ json: !!flags.json });

  const result = await runner.executeScript({
    scriptPath,
    args,
    backendName,
    cwd,
    runId: flags.resume,
    dryRun: !!flags['dry-run'],
    emit,
    concurrency: flags.concurrency ? Number(flags.concurrency) : undefined,
    model: flags.model,
    effort: flags.effort,
    mockFile: flags.mock ? path.resolve(flags.mock) : undefined,
    timeoutMs: numberFlag(flags.timeout),
    retries: numberFlag(flags.retries),
    maxAgentCalls: numberFlag(flags['max-agent-calls']),
    maxTokens: numberFlag(flags['max-tokens']),
    maxWallMs: numberFlag(flags['max-wall-ms']),
  });

  if (!flags.json) {
    process.stdout.write(`\nrunId: ${result.runId}\nstatus: ${result.status}\n`);
    if (result.usage) process.stdout.write(`${formatUsage(result.usage)}\n`);
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
  if (meta.error) process.stdout.write(`error: ${meta.error}\n`);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const flags = parseArgs(rest);
  const positional = flags._;
  try {
    if (cmd === 'run') await cmdRun(positional, flags);
    else if (cmd === 'list') cmdList(flags);
    else if (cmd === 'status') cmdStatus(positional, flags);
    else {
      process.stdout.write('usage: yoki-graph run <name|path> --backend codex|omp|mock [...]\n       yoki-graph list\n       yoki-graph status <runId>\n');
      if (cmd) process.exitCode = 1;
    }
  } catch (err) {
    fail(err.message);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, makeEmitter, cmdRun, cmdList, cmdStatus, main, formatUsage, numberFlag };
