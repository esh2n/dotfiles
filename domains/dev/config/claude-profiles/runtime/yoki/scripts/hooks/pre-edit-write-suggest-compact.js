#!/usr/bin/env node
'use strict';

// PreToolUse(Edit|Write|MultiEdit): suggest manual /compact at logical
// boundaries, driven by two signals:
//
// - Context size (primary): the latest assistant `usage` record from the
//   session transcript, compared against a window-scaled token threshold
//   (COMPACT_CONTEXT_THRESHOLD; default 160k on a 200k window, 250k on 1M),
//   re-reminding after every COMPACT_CONTEXT_INTERVAL tokens of growth
//   (default 60k).
// - Edit/write call count (secondary): first at COMPACT_THRESHOLD (default
//   50), then every 25 calls past it. A weak proxy on its own — a few large
//   reads can fill the window in very few calls — kept as a fallback for
//   transcripts without usage records.

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  readLatestContextTokens,
  resolveContextWindowTokens,
  resolveContextThreshold,
  resolveContextInterval,
  computeContextBucket,
  formatWindowLabel
} = require('../lib/transcript-context');

const MAX_STDIN = 1024 * 1024;
const DEFAULT_THRESHOLD = 50;
const REMINDER_INTERVAL = 25;
const COUNTER_PREFIX = 'claude-tool-count-';
const BUCKET_PREFIX = 'claude-context-bucket-';
const STATE_PREFIXES = [COUNTER_PREFIX, BUCKET_PREFIX];
const DEFAULT_STATE_TTL_DAYS = 14;

let raw = '';

function safeSessionId(sessionId) {
  return String(sessionId || 'default').replace(/[^A-Za-z0-9_-]/g, '') || 'default';
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

function readLastBucket(bucketFile) {
  try {
    const parsed = parseInt(fs.readFileSync(bucketFile, 'utf8').trim(), 10);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 1000000 ? parsed : -1;
  } catch {
    return -1;
  }
}

function stateTtlDays() {
  const parsed = Number.parseInt(process.env.COMPACT_STATE_TTL_DAYS || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_STATE_TTL_DAYS;
}

// Nothing else removes the per-session state files, so without a sweep they
// accumulate one per session forever. Active session files are always kept.
function sweepStaleState(tempDir, keepFiles) {
  let entries;
  try {
    entries = fs.readdirSync(tempDir, { withFileTypes: true });
  } catch {
    return;
  }
  const cutoffMs = Date.now() - stateTtlDays() * 24 * 60 * 60 * 1000;
  const keep = new Set(keepFiles.map(file => path.basename(file)));
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!STATE_PREFIXES.some(prefix => entry.name.startsWith(prefix))) continue;
    if (keep.has(entry.name)) continue;
    const fullPath = path.join(tempDir, entry.name);
    try {
      if (fs.statSync(fullPath).mtimeMs < cutoffMs) {
        fs.rmSync(fullPath, { force: true });
      }
    } catch {
      // sweep is best-effort
    }
  }
}

// Primary signal. Returns a suggestion string when the session has crossed
// into a new context bucket, null when silent (no transcript, below
// threshold, disabled via COMPACT_CONTEXT_THRESHOLD=0, or already fired).
function contextSuggestion(transcriptPath, bucketFile) {
  try {
    const usage = readLatestContextTokens(transcriptPath);
    if (!usage) return null;

    const windowTokens = resolveContextWindowTokens(usage.tokens, usage.model);
    const threshold = resolveContextThreshold(process.env, windowTokens);
    if (threshold <= 0) return null;

    const interval = resolveContextInterval(process.env);
    const bucket = computeContextBucket(usage.tokens, threshold, interval);
    if (bucket < 0 || bucket <= readLastBucket(bucketFile)) return null;

    try {
      fs.writeFileSync(bucketFile, String(bucket));
    } catch {
      // bucket state is best-effort; never block the tool call
    }

    const percent = Math.round((usage.tokens / windowTokens) * 100);
    return `[StrategicCompact] Context ~${Math.round(usage.tokens / 1000)}k tokens (${percent}% of ${formatWindowLabel(windowTokens)} window) — suggest /compact to the user at the next logical boundary (plan done, milestone shipped, debugging over). See the strategic-compact skill for the decision table.`;
  } catch {
    return null;
  }
}

function run(rawInput) {
  try {
    const input = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    const sessionId = safeSessionId(input.session_id);
    const counterFile = path.join(os.tmpdir(), `${COUNTER_PREFIX}${sessionId}`);
    const bucketFile = path.join(os.tmpdir(), `${BUCKET_PREFIX}${sessionId}`);

    sweepStaleState(os.tmpdir(), [counterFile, bucketFile]);

    const messages = [];

    const transcriptPath = typeof input.transcript_path === 'string' ? input.transcript_path : '';
    const fromContext = contextSuggestion(transcriptPath, bucketFile);
    if (fromContext) messages.push(fromContext);

    const count = bumpCount(counterFile);
    const threshold = parseInt(process.env.COMPACT_THRESHOLD || '', 10) || DEFAULT_THRESHOLD;

    if (count === threshold) {
      messages.push(
        `[StrategicCompact] ${threshold} edit/write calls reached — if a phase boundary is near (plan done, milestone shipped, debugging over), suggest /compact to the user before starting the next phase. See the strategic-compact skill for the decision table.`
      );
    } else if (count > threshold && (count - threshold) % REMINDER_INTERVAL === 0) {
      messages.push(
        `[StrategicCompact] ${count} edit/write calls — good checkpoint for /compact if the current context is mostly stale exploration or dead-end debugging. Do not suggest it mid-implementation.`
      );
    }

    if (messages.length > 0) {
      return {
        additionalContext: messages,
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
