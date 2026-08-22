#!/usr/bin/env node
'use strict';

// PreToolUse(WebFetch|WebSearch): advisory reminder to delegate WebFetch and
// WebSearch to a subagent when the MAIN session is running on an expensive
// model tier (Fable/Mythos/Opus) — see core CLAUDE.md "Expensive-Model
// Delegation". Advisory only, never blocks (exitCode always 0); silent when
// the model can't be determined (fail open).
//
// Signal: the latest assistant `usage` record's `model` field from the
// session transcript — the same tail-read already used by
// pre-edit-write-suggest-compact.js to size context. That record reflects
// whichever agent (main session or subagent) is about to make this tool
// call, so a subagent already running on a cheaper model stays silent.

const MAX_STDIN = 1024 * 1024;
const { buildPreToolUseAdditionalContext } = require('./pretooluse-visible-output');
const { readLatestContextTokens } = require('../lib/transcript-context');

const EXPENSIVE_MODEL_MARKERS = ['fable', 'mythos', 'opus'];

function isExpensiveModel(model) {
  if (typeof model !== 'string' || !model) return false;
  const lower = model.toLowerCase();
  return EXPENSIVE_MODEL_MARKERS.some(marker => lower.includes(marker));
}

let raw = '';

function run(rawInput) {
  try {
    const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    const toolName = String(input.tool_name || input.tool || '');
    if (!/^(WebFetch|WebSearch)$/.test(toolName)) {
      return typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput);
    }

    const transcriptPath = typeof input.transcript_path === 'string' ? input.transcript_path : '';
    const usage = readLatestContextTokens(transcriptPath);
    const model = usage ? usage.model : '';

    if (isExpensiveModel(model)) {
      return {
        additionalContext: [
          'yoki: expensive main session — delegate WebFetch/WebSearch to a subagent (core CLAUDE.md Expensive-Model Delegation)',
        ],
        exitCode: 0,
      };
    }
  } catch {
    // ignore parse/transcript errors and pass through (fail open)
  }

  return typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput);
}

if (require.main === module) {
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
      if (result.stderr) {
        process.stderr.write(`${result.stderr}\n`);
      }
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
