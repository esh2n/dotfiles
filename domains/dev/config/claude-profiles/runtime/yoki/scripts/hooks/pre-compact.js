#!/usr/bin/env node
/**
 * PreCompact Hook - Save LLM-generated summary before context compaction
 *
 * Cross-platform (Windows, macOS, Linux)
 *
 * Runs before Claude compacts context. Generates a rich LLM summary of the
 * current session and, on Claude, writes it to the active session .tmp file
 * so that the next session start gets a high-quality summary even after
 * lossy compaction. Falls back to a plain log entry when transcript_path is
 * unavailable or the LLM call fails.
 *
 * Cross-harness (T18): the session .tmp marker file above is Claude Code's
 * own next-session-start convention — Codex and omp have no equivalent file
 * and no reason to grow one — so this hook only touches it when
 * `process.env.YOKI_HARNESS` is unset or 'claude'. For the other two
 * harnesses, the same LLM summary is generated and delivered through
 * whichever channel that harness actually has for PreCompact:
 *
 * - omp: PreCompact maps onto `session_before_compact`
 *   (lib/harness/response.js's OMP_EVENT_MAP), which the bridge turns into
 *   a `{summary}` return — this hook prints that JSON on stdout directly
 *   (`{summary: <text>}`) rather than Claude's hookSpecificOutput shape,
 *   since PreCompact has no additionalContext channel on Claude to reuse.
 * - codex: PreCompact fires (see lib/targets/codex-hooks-merge.js's
 *   KNOWN_EVENTS) but — per that file's own comment — is "unreachable from
 *   `codex exec`" and has no context-injection channel even when the TUI
 *   does reach it. The summary is queued instead
 *   (../lib/pending-context.js, source 'compaction', 2h TTL) for
 *   prompt-pending-context.js to surface as additionalContext on the next
 *   UserPromptSubmit. PostCompact was added alongside PreCompact to that
 *   KNOWN_EVENTS set for the same reason — see codex-hooks-merge.js.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { getSessionsDir, getDateTimeString, getTimeString, findFiles, ensureDir, appendFile, readFile, writeFile, log } = require('../lib/utils');
const llmSummaryLib = require('../lib/llm-summary');
const { enqueue } = require('../lib/pending-context');

const SUMMARY_START_MARKER = '<!-- ECC:SUMMARY:START -->';
const SUMMARY_END_MARKER = '<!-- ECC:SUMMARY:END -->';
// Long enough to survive the gap between compaction and the next prompt
// without expiring, short enough that a summary from a stale/abandoned
// session doesn't linger indefinitely.
const COMPACTION_TTL_SEC = 2 * 60 * 60;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Same chain artifact-comments.js/prompt-pending-context.js resolve session
 * identity with, so a summary enqueued here lands in the same queue file
 * prompt-pending-context.js later drains. */
function resolveSessionId(input) {
  const fromPayload = input && typeof input.session_id === 'string' ? input.session_id.trim() : '';
  if (fromPayload) return fromPayload;
  const fromEnv = String(process.env.YOKI_SESSION_ID || process.env.CLAUDE_SESSION_ID || '').trim();
  return fromEnv || 'default';
}

/**
 * Runs the PreCompact hook body against raw stdin text. Returns
 * `{stdout, exitCode}` for the caller to emit — never calls
 * `process.exit()` itself, so it is safe to call directly (run-with-flags.js
 * does exactly that, and so does this file's own test).
 */
function run(rawInput) {
  let input = null;
  let transcriptPath = null;
  try {
    input = JSON.parse(rawInput);
    if (input && typeof input.transcript_path === 'string' && input.transcript_path.length > 0) {
      transcriptPath = input.transcript_path;
    }
  } catch {
    // stdin not JSON or missing — proceed without transcript
  }

  const harness = process.env.YOKI_HARNESS || 'claude';

  if (harness !== 'claude') {
    const llmSummary = transcriptPath && fs.existsSync(transcriptPath)
      ? llmSummaryLib.generateSessionSummary(transcriptPath)
      : null;

    if (harness === 'omp') {
      return { stdout: llmSummary ? JSON.stringify({ summary: llmSummary }) : '', exitCode: 0 };
    }

    if (harness === 'codex') {
      if (llmSummary) {
        try {
          enqueue({ harness: 'codex', sessionId: resolveSessionId(input) }, {
            source: 'compaction',
            text: llmSummary,
            ttlSec: COMPACTION_TTL_SEC,
          });
        } catch (err) {
          log(`[PreCompact] could not enqueue pending-context summary: ${err.message}`);
        }
      }
      return { stdout: '', exitCode: 0 };
    }

    // Unknown non-claude harness value: fail open, no side effects.
    return { stdout: '', exitCode: 0 };
  }

  // --- Claude path (unchanged) ---
  const sessionsDir = getSessionsDir();
  const compactionLog = path.join(sessionsDir, 'compaction-log.txt');

  ensureDir(sessionsDir);

  const timestamp = getDateTimeString();
  appendFile(compactionLog, `[${timestamp}] Context compaction triggered\n`);

  const sessions = findFiles(sessionsDir, '*-session.tmp');
  if (sessions.length === 0) {
    log('[PreCompact] No active session file found');
    return { stdout: '', exitCode: 0 };
  }

  const activeSession = sessions[0].path;
  const timeStr = getTimeString();

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    appendFile(activeSession, `\n---\n**[Compaction occurred at ${timeStr}]** - Context was summarized\n`);
    log('[PreCompact] No transcript available; logged compaction event only');
    return { stdout: '', exitCode: 0 };
  }

  // Generate LLM summary right before compaction — most critical timing
  log('[PreCompact] Generating LLM summary before compaction...');
  const llmSummary = llmSummaryLib.generateSessionSummary(transcriptPath);

  if (!llmSummary) {
    appendFile(activeSession, `\n---\n**[Compaction occurred at ${timeStr}]** - Context was summarized\n`);
    log('[PreCompact] LLM summary unavailable; logged compaction event only');
    return { stdout: '', exitCode: 0 };
  }

  const existing = readFile(activeSession);
  if (existing && existing.includes(SUMMARY_START_MARKER) && existing.includes(SUMMARY_END_MARKER)) {
    const newBlock = `${SUMMARY_START_MARKER}\n${llmSummary}\n<!-- LLM_SUMMARY:pre-compact:${timeStr} -->\n${SUMMARY_END_MARKER}`;
    const updated = existing.replace(new RegExp(`${escapeRegExp(SUMMARY_START_MARKER)}[\\s\\S]*?${escapeRegExp(SUMMARY_END_MARKER)}`), () => newBlock);
    writeFile(activeSession, updated);
    log('[PreCompact] LLM summary written to session file before compaction');
  } else {
    appendFile(activeSession, `\n---\n**[Compaction at ${timeStr}]**\n\n${llmSummary}\n`);
    log('[PreCompact] LLM summary appended (no summary markers found)');
  }

  return { stdout: '', exitCode: 0 };
}

if (require.main === module) {
  const MAX_STDIN = 1024 * 1024;
  let stdinData = '';
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', chunk => {
    if (stdinData.length < MAX_STDIN) {
      stdinData += chunk.substring(0, MAX_STDIN - stdinData.length);
    }
  });

  process.stdin.on('end', () => {
    let result;
    try {
      result = run(stdinData);
    } catch (err) {
      log(`[PreCompact] Error: ${err.message}`);
      process.exit(0);
      return;
    }
    if (result && result.stdout) process.stdout.write(result.stdout);
    process.exit(Number.isInteger(result && result.exitCode) ? result.exitCode : 0);
  });
}

module.exports = { run, resolveSessionId };
