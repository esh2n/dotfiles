'use strict';

/**
 * Session-id extraction from each harness's headless JSON stdout (task T19
 * spec: "sessionId (parsed from the JSON stream: claude `session_id`, codex
 * thread id, omp `{type:'session'}` header)").
 *
 * claude `-p --output-format json` prints one JSON object to stdout with a
 * top-level `session_id`. codex and omp `--json`/`--mode json` stream
 * newline-delimited JSON events; both are scanned line by line for the
 * first event carrying the relevant id. No spike report backs the exact
 * codex/omp event shapes the way `lib/harness/session.js` is pinned to
 * spikes S1-S2/S4-S5 — these are matched defensively against a few
 * plausible key names/nesting rather than a single verified shape, and
 * `null` (no id found) is always a safe, handled outcome: it just means
 * the next run cannot pass `--resume`/`resume`.
 */

function parseJsonLines(text) {
  const records = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // Non-JSON or truncated line (partial stdout) — skip, don't throw.
    }
  }
  return records;
}

function extractClaudeSessionId(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed?.session_id === 'string' && parsed.session_id ? parsed.session_id : null;
  } catch {
    // Fall back to a line scan in case stdout carries extra log lines
    // around the single JSON result object.
    for (const record of parseJsonLines(trimmed)) {
      if (typeof record?.session_id === 'string' && record.session_id) return record.session_id;
    }
    return null;
  }
}

function extractCodexThreadId(stdout) {
  for (const record of parseJsonLines(stdout)) {
    const direct = record?.thread_id;
    if (typeof direct === 'string' && direct) return direct;
    const nested = record?.msg?.thread_id;
    if (typeof nested === 'string' && nested) return nested;
  }
  return null;
}

function extractOmpSessionId(stdout) {
  for (const record of parseJsonLines(stdout)) {
    if (record?.type !== 'session') continue;
    const id = record.sessionId ?? record.session_id ?? record.id;
    if (typeof id === 'string' && id) return id;
  }
  return null;
}

/**
 * @param {'claude'|'codex'|'omp'} harness
 * @param {string} stdout the child process's captured stdout
 * @returns {string|null}
 */
function extractSessionId(harness, stdout) {
  if (harness === 'claude') return extractClaudeSessionId(stdout);
  if (harness === 'codex') return extractCodexThreadId(stdout);
  if (harness === 'omp') return extractOmpSessionId(stdout);
  return null;
}

module.exports = { extractSessionId };
