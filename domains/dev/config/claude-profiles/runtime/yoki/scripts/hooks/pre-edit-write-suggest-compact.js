#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_STDIN = 1024 * 1024;
const DEFAULT_THRESHOLD = 50;
const REMINDER_INTERVAL = 25;

let raw = '';

function counterFileFor(sessionId) {
  const safeId = String(sessionId || 'default').replace(/[^A-Za-z0-9_-]/g, '');
  return path.join(os.tmpdir(), `claude-tool-count-${safeId || 'default'}`);
}

function bumpCount(counterFile) {
  let count = 0;
  try {
    count = parseInt(fs.readFileSync(counterFile, 'utf8'), 10) || 0;
  } catch {
    // first call in this session
  }
  count += 1;
  try {
    fs.writeFileSync(counterFile, String(count));
  } catch {
    // counter is best-effort; never block the tool call
  }
  return count;
}

function run(rawInput) {
  try {
    const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    const counterFile = counterFileFor(input.session_id);
    const count = bumpCount(counterFile);
    const threshold = parseInt(process.env.COMPACT_THRESHOLD || '', 10) || DEFAULT_THRESHOLD;

    if (count === threshold) {
      return {
        additionalContext: [
          `[StrategicCompact] ${threshold} edit/write calls reached — if a phase boundary is near (plan done, milestone shipped, debugging over), suggest /compact to the user before starting the next phase. See the strategic-compact skill for the decision table.`,
        ],
        exitCode: 0,
      };
    }

    if (count > threshold && count % REMINDER_INTERVAL === 0) {
      return {
        additionalContext: [
          `[StrategicCompact] ${count} edit/write calls — good checkpoint for /compact if the current context is mostly stale exploration or dead-end debugging. Do not suggest it mid-implementation.`,
        ],
        exitCode: 0,
      };
    }
  } catch {
    // ignore parse errors and pass through
  }

  return typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput);
}

if (require.main === module) {
  const { buildPreToolUseAdditionalContext } = require('./pretooluse-visible-output');
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (raw.length < MAX_STDIN) {
      const remaining = MAX_STDIN - raw.length;
      raw += chunk.substring(0, remaining);
    }
  });

  process.stdin.on('end', () => {
    const result = run(raw);
    if (result && typeof result === 'object') {
      if (Object.prototype.hasOwnProperty.call(result, 'additionalContext')) {
        process.stdout.write(buildPreToolUseAdditionalContext(result.additionalContext));
      } else {
        process.stdout.write(String(result.stdout || ''));
      }
      process.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : 0;
      return;
    }

    process.stdout.write(String(result));
  });
}

module.exports = { run };
