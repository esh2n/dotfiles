#!/usr/bin/env node
/**
 * Cost Tracker Hook (v2)
 *
 * Reads transcript_path from Stop hook stdin, sums usage across all
 * assistant turns in the session JSONL, and appends one row to
 * ~/.claude/metrics/costs.jsonl.
 *
 * Stop hook stdin payload: { session_id, transcript_path, cwd, hook_event_name, ... }
 * The Stop payload does NOT include `usage` or `model` directly. The previous
 * version of this hook expected those fields and silently produced zero-filled
 * rows (verified: 2,340 rows captured with 0.0% non-zero token rate over 52
 * days). The fix is to read the transcript file Claude Code already passes us.
 *
 * JSONL assistant entry shape (per Claude Code):
 *   { type: "assistant", message: { model, usage: { input_tokens, output_tokens,
 *     cache_creation_input_tokens, cache_read_input_tokens } } }
 *
 * Cumulative behavior: Stop fires per assistant response, not per session.
 * Each row therefore represents the cumulative session total up to that point.
 * To get per-session cost, take the last row per session_id. To get per-day
 * spend, aggregate.
 *
 * Harness-cost contract (optional, opt-in by the statusline):
 *   If the user's statusline (which receives `cost.total_cost_usd` directly
 *   from Claude Code) writes `{ts, cost_usd}` to
 *   `<os.tmpdir()>/harness-cost-<session_id>.json` on each render, this hook
 *   prefers that authoritative value over the transcript-sum estimate when
 *   the cache is fresh (≤ 300s). The transcript-sum is kept as a safe
 *   fallback because:
 *     - the hard-coded rate table cannot represent Opus 4.7's >200K-token
 *       2x tier or the 1h-cache 2x tier (under-counts on long sessions);
 *     - summing the full transcript double-counts work done across
 *       `--resume` boundaries while `cost.total_cost_usd` is per-process.
 *   Absent a writer, behavior is unchanged.
 *
 * Cross-harness support (#T17): the session file is located through
 * `lib/harness/session.js`'s `resolveSessionFile(payload, harness, env)`
 * (`harness = process.env.YOKI_HARNESS || 'claude'`, set by run-with-flags —
 * absent under Claude, so this is a no-op there). For Claude the row schema,
 * the transcript-sum-of-every-turn behavior, and the harness-cost cache
 * override above are all unchanged. For Codex and omp:
 *   - Codex rollout JSONL's `token_count` records carry both a per-turn
 *     `last_token_usage` delta (what `harness/session.js`'s `readUsage` uses
 *     for the compact-signal, current-context-size use case) and a running
 *     `total_token_usage` — already the cumulative session total, verified
 *     against a real rollout file (`total_token_usage.input_tokens` at turn N
 *     equals the sum of every turn's own `last_token_usage.input_tokens` up
 *     to N). Cost tracking wants that cumulative total, so `readUsage` isn't
 *     reused here; `readCodexCumulativeUsage` below reads `total_token_usage`
 *     from the newest `token_count` record directly.
 *   - omp session JSONL's per-assistant-message `usage.{input,output,
 *     cacheRead,cacheWrite}` are per-turn deltas, not cumulative (verified
 *     against a real session file — each entry's numbers are comparable in
 *     magnitude to the previous, not growing monotonically the way a running
 *     total would). `sumOmpUsageFromSession` below sums every assistant
 *     message's own usage, mirroring `sumUsageFromTranscript`'s approach for
 *     Claude, so the row is a true session-to-date total there too.
 *   - Both Codex and omp's normalized Stop-equivalent payload
 *     (`harness/payload.js`) carries `model` directly (Codex passes it
 *     through unchanged off the raw event; omp's `ompCommon()` copies
 *     `ctx.model`), so `input.model` is preferred over whatever the session
 *     file itself says, per-harness usage above being sourced there mainly to
 *     avoid re-deriving a model name Claude's own Stop payload never carries.
 *   - Cost is priced through `lib/cost-estimate.js`'s `estimateHarnessCost`,
 *     which prices by exact harness model id (not Claude's fuzzy tier-name
 *     substring match) and returns `null` — never `NaN` — for an unpriced or
 *     unrecognized model.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureDir, appendFile, getClaudeDir, sanitizeSessionId } = require('../lib/utils');
const { resolveSessionFile } = require('../lib/harness/session');
const { estimateHarnessCost } = require('../lib/cost-estimate');

const HARNESS_COST_MAX_AGE_SECONDS = 300;

/**
 * Read authoritative harness cost from the per-session cache file.
 * @param {string} sessionId
 * @param {number} maxAgeSeconds
 * @returns {number|null} cost in USD, or null on miss / stale / parse error
 */
function readHarnessCost(sessionId, maxAgeSeconds) {
  if (!sessionId) return null;
  try {
    const fp = path.join(os.tmpdir(), `harness-cost-${sessionId}.json`);
    if (!fs.existsSync(fp)) return null;
    const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const ts = Number(obj && obj.ts);
    const cost = Number(obj && obj.cost_usd);
    if (!Number.isFinite(ts) || !Number.isFinite(cost) || cost < 0) return null;
    const age = Math.floor(Date.now() / 1000) - ts;
    if (age < 0 || age > maxAgeSeconds) return null;
    return cost;
  } catch {
    return null;
  }
}

// Approximate per-1M-token billing rates (USD).
// Cache creation: 1.25x input rate. Cache read: 0.1x input rate.
const RATE_TABLE = {
  haiku:  { in: 0.80,  out: 4.0,  cacheWrite: 1.00,  cacheRead: 0.08 },
  sonnet: { in: 3.00,  out: 15.0, cacheWrite: 3.75,  cacheRead: 0.30 },
  opus:   { in: 15.00, out: 75.0, cacheWrite: 18.75, cacheRead: 1.50 }
};

function getRates(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('haiku')) return RATE_TABLE.haiku;
  if (m.includes('opus'))  return RATE_TABLE.opus;
  return RATE_TABLE.sonnet;
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Scan the session JSONL and sum token usage across all assistant turns.
 * Returns { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, model }
 * or null on read failure.
 */
function sumUsageFromTranscript(transcriptPath) {
  let content;
  try {
    content = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return null;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;
  let model = 'unknown';

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry.type !== 'assistant') continue;
    const msg = entry.message;
    if (!msg || !msg.usage) continue;

    const u = msg.usage;
    inputTokens      += toNumber(u.input_tokens);
    outputTokens     += toNumber(u.output_tokens);
    cacheWriteTokens += toNumber(u.cache_creation_input_tokens);
    cacheReadTokens  += toNumber(u.cache_read_input_tokens);

    if (msg.model && msg.model !== 'unknown') model = msg.model;
  }

  return { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, model };
}

/**
 * Scan a Codex rollout JSONL and return the newest `token_count` record's
 * `total_token_usage` — already the session-cumulative total (see file
 * header), so this reads rather than sums. Model comes from the newest
 * `turn_context` record seen, as a fallback for callers that don't already
 * have `model` off the Stop payload itself.
 * Returns { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, model }
 * or null when the file is unreadable or carries no `token_count` record.
 */
function readCodexCumulativeUsage(rolloutPath) {
  let content;
  try {
    content = fs.readFileSync(rolloutPath, 'utf8');
  } catch {
    return null;
  }

  let model = 'unknown';
  let total = null;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry.type === 'turn_context' && entry.payload && typeof entry.payload.model === 'string') {
      model = entry.payload.model;
    }

    if (entry.type === 'event_msg' && entry.payload && entry.payload.type === 'token_count') {
      const info = entry.payload.info;
      if (info && info.total_token_usage && typeof info.total_token_usage === 'object') {
        total = info.total_token_usage;
      }
    }
  }

  if (!total) return null;

  return {
    inputTokens:      toNumber(total.input_tokens),
    outputTokens:     toNumber(total.output_tokens),
    cacheWriteTokens: toNumber(total.cache_write_input_tokens),
    cacheReadTokens:  toNumber(total.cached_input_tokens),
    model
  };
}

/**
 * Scan an omp session JSONL and sum token usage across every assistant
 * message — each message's `usage.{input,output,cacheRead,cacheWrite}` is a
 * per-turn delta, not a running total (see file header), so this sums rather
 * than reads the newest one, mirroring `sumUsageFromTranscript` above.
 * Returns { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, model }
 * or null when the file is unreadable or carries no assistant usage record.
 */
function sumOmpUsageFromSession(sessionFilePath) {
  let content;
  try {
    content = fs.readFileSync(sessionFilePath, 'utf8');
  } catch {
    return null;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;
  let model = 'unknown';
  let found = false;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry.type !== 'message') continue;
    const message = entry.message;
    if (!message || message.role !== 'assistant' || !message.usage) continue;

    const u = message.usage;
    inputTokens      += toNumber(u.input);
    outputTokens     += toNumber(u.output);
    cacheWriteTokens += toNumber(u.cacheWrite);
    cacheReadTokens  += toNumber(u.cacheRead);
    found = true;

    if (typeof message.model === 'string' && message.model) model = message.model;
  }

  return found ? { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, model } : null;
}

// 1MB, matching the other Stop hooks. The Stop payload carries
// last_assistant_message, which routinely exceeded the old 64KB cap and
// made this hook echo a JSON document cut mid-stream (#2090).
const MAX_STDIN = 1024 * 1024;
let raw = '';
let truncated = false;

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (raw.length < MAX_STDIN) {
    const remaining = MAX_STDIN - raw.length;
    raw += chunk.substring(0, remaining);
    if (chunk.length > remaining) truncated = true;
  } else {
    truncated = true;
  }
});

process.stdin.on('end', () => {
  try {
    const input = raw.trim() ? JSON.parse(raw) : {};
    const harness = process.env.YOKI_HARNESS || 'claude';

    // resolveSessionFile returns payload.transcript_path verbatim for
    // 'claude' (identical to the old direct field read); the
    // CLAUDE_TRANSCRIPT_PATH env fallback below only ever applied to Claude,
    // so it stays Claude-only rather than moving into resolveSessionFile.
    let transcriptPath = resolveSessionFile(input, harness, process.env);
    if (!transcriptPath && harness === 'claude') {
      transcriptPath = process.env.CLAUDE_TRANSCRIPT_PATH || null;
    }

    const sessionId =
      sanitizeSessionId(input.session_id) ||
      sanitizeSessionId(process.env.YOKI_SESSION_ID) ||
      sanitizeSessionId(process.env.CLAUDE_SESSION_ID) ||
      'default';

    let usageTotals = null;
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      if (harness === 'codex') {
        usageTotals = readCodexCumulativeUsage(transcriptPath);
      } else if (harness === 'omp') {
        usageTotals = sumOmpUsageFromSession(transcriptPath);
      } else {
        usageTotals = sumUsageFromTranscript(transcriptPath);
      }
    }

    const {
      inputTokens = 0,
      outputTokens = 0,
      cacheWriteTokens = 0,
      cacheReadTokens = 0,
      model: modelFromSession = 'unknown'
    } = usageTotals || {};

    // Codex/omp's normalized Stop-equivalent payload carries `model` directly
    // (harness/payload.js); Claude's Stop payload never does, so this is a
    // no-op for it and `model` keeps coming from the transcript as before.
    const modelFromPayload = typeof input.model === 'string' && input.model ? input.model : '';
    const model = modelFromPayload || modelFromSession;

    let estimatedCostUsd;

    if (harness === 'claude') {
      const rates = getRates(model);
      const transcriptCostUsd = Math.round((
        (inputTokens      / 1e6) * rates.in +
        (outputTokens     / 1e6) * rates.out +
        (cacheWriteTokens / 1e6) * rates.cacheWrite +
        (cacheReadTokens  / 1e6) * rates.cacheRead
      ) * 1e6) / 1e6;

      // Prefer the harness's authoritative `cost.total_cost_usd` when the
      // statusline has written it to the per-session cache (see contract in
      // the file header). The harness number reflects API-billed truth
      // (correct rates, 1h-cache 2x, >200K tier 2x) and is per-process so it
      // does not drift across `--resume`. Cache miss → transcript-sum.
      const harnessCost = readHarnessCost(sessionId, HARNESS_COST_MAX_AGE_SECONDS);
      estimatedCostUsd = harnessCost !== null
        ? Math.round(harnessCost * 1e6) / 1e6
        : transcriptCostUsd;
    } else {
      // Codex/omp price by exact model id (lib/cost-estimate.js); null for an
      // unpriced or unrecognized model — never a guessed number, never NaN.
      estimatedCostUsd = estimateHarnessCost(harness, model, inputTokens, outputTokens);
    }

    const metricsDir = path.join(getClaudeDir(), 'metrics');
    ensureDir(metricsDir);

    const row = {
      timestamp:          new Date().toISOString(),
      session_id:         sessionId,
      transcript_path:    transcriptPath || '',
      harness,
      model,
      input_tokens:       inputTokens,
      output_tokens:      outputTokens,
      cache_write_tokens: cacheWriteTokens,
      cache_read_tokens:  cacheReadTokens,
      estimated_cost_usd: estimatedCostUsd
    };

    appendFile(path.join(metricsDir, 'costs.jsonl'), `${JSON.stringify(row)}\n`);
  } catch {
    // Non-blocking — never fail the Stop hook.
  }

  // Pass stdin through (ECC hook convention) — but never echo truncated
  // stdin: invalid JSON on stdout is reported as a Stop hook failure (#2090).
  if (truncated) {
    process.stderr.write('[Hook] cost-tracker: stdin exceeded 1MB; suppressing pass-through (fail-open)\n');
    return;
  }
  process.stdout.write(raw);
});
