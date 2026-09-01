'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Cross-harness session-file resolution and usage-record parsing (#T3).
 *
 * Claude Code's hook stdin always carries `transcript_path`; Codex CLI and
 * omp mostly do too (via `harness/payload.js` normalization — omp's bridge
 * copies `ctx.session_file` into `transcript_path`), but Codex `transcript_path`
 * can be absent on some event shapes, so it also needs a session-id lookup
 * fallback. Facts here are pinned to two spike reports — Codex CLI 0.147.0
 * rollout JSONL (spikes/S1-S2-codex-hooks.md) and omp 18.0.4 session JSONL
 * (spikes/S4-S5-omp.md) — plus one real file read under each harness's
 * session directory (read-only; message content itself was never printed,
 * only record shapes/keys). Do not "improve" the field mapping without a
 * new spike backing the change — these are observed facts, not guesses.
 */

// ---------------------------------------------------------------------------
// resolveSessionFile
// ---------------------------------------------------------------------------

/**
 * Codex rollout filenames embed the local start time and session id:
 *   rollout-YYYY-MM-DDTHH-MM-SS-<session_id>.jsonl
 * under `$CODEX_HOME/sessions/YYYY/MM/DD/` (spike S1-S2-codex-hooks.md line
 * 80). Walk day directories newest first and stop at the first filename that
 * ends in `-<session_id>.jsonl` — the suffix already pins the exact session.
 */
function findCodexRolloutBySessionId(codexHome, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) return null;

  const sessionsDir = path.join(codexHome, 'sessions');
  const suffix = `-${sessionId}.jsonl`;

  const listDescending = (dir, pattern) => {
    try {
      return fs
        .readdirSync(dir)
        .filter((name) => pattern.test(name))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  };

  for (const year of listDescending(sessionsDir, /^\d{4}$/)) {
    const yearDir = path.join(sessionsDir, year);
    for (const month of listDescending(yearDir, /^\d{2}$/)) {
      const monthDir = path.join(yearDir, month);
      for (const day of listDescending(monthDir, /^\d{2}$/)) {
        const dayDir = path.join(monthDir, day);
        let files;
        try {
          files = fs.readdirSync(dayDir);
        } catch {
          continue;
        }
        const match = files.find((name) => name.startsWith('rollout-') && name.endsWith(suffix));
        if (match) return path.join(dayDir, match);
      }
    }
  }

  return null;
}

/**
 * resolveSessionFile(payload, harness, env) -> absolute path | null
 *
 * - claude: `payload.transcript_path` verbatim (existing hook-stdin field).
 * - omp: `payload.transcript_path` verbatim too — `harness/payload.js`'s
 *   `ompCommon()` already copies the bridge's `ctx.session_file` in there.
 * - codex: `payload.transcript_path` when the event carries one (true for
 *   every event type observed in the spike); otherwise search
 *   `${CODEX_HOME||~/.codex}/sessions/**\/rollout-*-${session_id}.jsonl`.
 */
function resolveSessionFile(payload, harness, env) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const environment = env && typeof env === 'object' ? env : process.env;

  const direct = typeof p.transcript_path === 'string' && p.transcript_path ? p.transcript_path : null;
  if (direct) return direct;

  if (harness === 'codex') {
    const codexHome =
      typeof environment.CODEX_HOME === 'string' && environment.CODEX_HOME
        ? environment.CODEX_HOME
        : path.join(os.homedir(), '.codex');
    return findCodexRolloutBySessionId(codexHome, p.session_id);
  }

  return null;
}

// ---------------------------------------------------------------------------
// readUsage
// ---------------------------------------------------------------------------

function readLinesReversed(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n');
  lines.reverse();
  return lines;
}

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Claude transcript usage record — same fields `transcript-context.js`
 * already reads (`message.usage.{input_tokens,cache_read_input_tokens,
 * cache_creation_input_tokens,output_tokens}`, `message.model`), reshaped
 * into this module's common `{inputTokens, outputTokens, cacheRead,
 * cacheWrite, model, contextTokens}` output.
 */
function readClaudeUsage(filePath) {
  const lines = readLinesReversed(filePath);
  if (lines === null) return null;

  for (const line of lines) {
    const record = parseLine(line);
    const usage = record && record.message && record.message.usage;
    if (!usage || typeof usage !== 'object') continue;

    const inputTokens = Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0;
    const cacheRead = Number.isFinite(usage.cache_read_input_tokens) ? usage.cache_read_input_tokens : 0;
    const cacheWrite = Number.isFinite(usage.cache_creation_input_tokens) ? usage.cache_creation_input_tokens : 0;
    const outputTokens = Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0;
    const contextTokens = inputTokens + cacheRead + cacheWrite;
    if (contextTokens <= 0) continue;

    const model = typeof record.message.model === 'string' ? record.message.model : '';
    return { inputTokens, outputTokens, cacheRead, cacheWrite, model, contextTokens };
  }

  return null;
}

/**
 * Codex rollout JSONL usage record.
 *
 * Keys relied on (verified against spikes/S1-S2-codex-hooks.md Appendix B's
 * `--json` event stream and a real rollout file under
 * `~/.codex/sessions/**\/rollout-*.jsonl`):
 * - `{"type":"event_msg","payload":{"type":"token_count","info":{
 *     "last_token_usage":{"input_tokens","cached_input_tokens",
 *     "cache_write_input_tokens","output_tokens"}, "model_context_window"}}}`
 *   — `last_token_usage` is the newest turn's usage (vs. `total_token_usage`,
 *   which accumulates across the whole session); its three input fields sum
 *   to the current context size, mirroring Claude's
 *   input+cache_read+cache_creation split.
 * - `{"type":"turn_context","payload":{"model": "..."}}` — the active model;
 *   not present on `token_count` records themselves.
 * Not every rollout file has a `token_count` record (older/aborted sessions
 * can lack one entirely) — that's a `null` result, not an error.
 */
function readCodexUsage(filePath) {
  const lines = readLinesReversed(filePath);
  if (lines === null) return null;

  let model = '';
  let usageInfo = null;

  for (const line of lines) {
    const record = parseLine(line);
    if (!record) continue;

    if (!model && record.type === 'turn_context' && record.payload && typeof record.payload.model === 'string') {
      model = record.payload.model;
    }

    if (!usageInfo && record.type === 'event_msg' && record.payload && record.payload.type === 'token_count') {
      const info = record.payload.info;
      if (info && info.last_token_usage && typeof info.last_token_usage === 'object') {
        usageInfo = info.last_token_usage;
      }
    }

    if (model && usageInfo) break;
  }

  if (!usageInfo) return null;

  const inputTokens = Number.isFinite(usageInfo.input_tokens) ? usageInfo.input_tokens : 0;
  const cacheRead = Number.isFinite(usageInfo.cached_input_tokens) ? usageInfo.cached_input_tokens : 0;
  const cacheWrite = Number.isFinite(usageInfo.cache_write_input_tokens) ? usageInfo.cache_write_input_tokens : 0;
  const outputTokens = Number.isFinite(usageInfo.output_tokens) ? usageInfo.output_tokens : 0;
  const contextTokens = inputTokens + cacheRead + cacheWrite;
  if (contextTokens <= 0) return null;

  return { inputTokens, outputTokens, cacheRead, cacheWrite, model, contextTokens };
}

/**
 * omp session JSONL usage record.
 *
 * Keys relied on (verified against spikes/S4-S5-omp.md §(c) and a real
 * session file recorded by `ctx.sessionManager` under omp's session dir):
 * - `{"type":"message","message":{"role":"assistant","model":"...","usage":{
 *     "input","output","cacheRead","cacheWrite","totalTokens",
 *     "reasoningTokens","cost"}}}` — one entry per assistant turn; the sum
 *   of `input+cacheRead+cacheWrite` matches the entry's own
 *   `contextSnapshot.promptTokens` exactly, so it's used as the context-size
 *   signal the same way Claude's and Codex's splits are.
 * Other entry types (`title`, `session`, `model_change`,
 * `thinking_level_change`, `custom`, and `message` entries with
 * `role:"user"|"toolResult"`) carry no `usage` and are skipped.
 */
function readOmpUsage(filePath) {
  const lines = readLinesReversed(filePath);
  if (lines === null) return null;

  for (const line of lines) {
    const record = parseLine(line);
    if (!record || record.type !== 'message') continue;

    const message = record.message;
    if (!message || message.role !== 'assistant') continue;

    const usage = message.usage;
    if (!usage || typeof usage !== 'object') continue;

    const inputTokens = Number.isFinite(usage.input) ? usage.input : 0;
    const outputTokens = Number.isFinite(usage.output) ? usage.output : 0;
    const cacheRead = Number.isFinite(usage.cacheRead) ? usage.cacheRead : 0;
    const cacheWrite = Number.isFinite(usage.cacheWrite) ? usage.cacheWrite : 0;
    const contextTokens = inputTokens + cacheRead + cacheWrite;
    if (contextTokens <= 0) continue;

    const model = typeof message.model === 'string' ? message.model : '';
    return { inputTokens, outputTokens, cacheRead, cacheWrite, model, contextTokens };
  }

  return null;
}

/**
 * readUsage(path, harness) -> {inputTokens, outputTokens, cacheRead,
 * cacheWrite, model, contextTokens} | null
 *
 * `contextTokens` is always `inputTokens + cacheRead + cacheWrite` — the
 * full prompt size for the latest turn, comparable across harnesses even
 * though each harness's own field names differ.
 */
function readUsage(sessionFilePath, harness) {
  if (typeof sessionFilePath !== 'string' || !sessionFilePath) return null;

  if (harness === 'claude') return readClaudeUsage(sessionFilePath);
  if (harness === 'codex') return readCodexUsage(sessionFilePath);
  if (harness === 'omp') return readOmpUsage(sessionFilePath);

  return null;
}

module.exports = {
  resolveSessionFile,
  readUsage,
};
