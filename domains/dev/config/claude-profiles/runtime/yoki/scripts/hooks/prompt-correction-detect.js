#!/usr/bin/env node
'use strict';

/**
 * UserPromptSubmit hook — detect user-correction utterances and record them
 * as learning candidates (correction-driven learning: signal fires only
 * when the user pushes back, instead of observing every tool call).
 *
 * Harness-agnostic replacement for the old Stop-hook `correction-detect.sh`.
 * A Stop hook only ever sees a finished transcript, so the previous
 * implementation had to tail it for the last user turn; every harness this
 * repo targets normalizes UserPromptSubmit's text into `payload.prompt`
 * (Claude and Codex send it natively, the omp bridge maps
 * `before_agent_start.payload.prompt` onto it — see
 * ../lib/harness/payload.js), so this hook reads that field directly
 * instead.
 *
 * A matched correction is appended to
 * `${CLV2_HOMUNCULUS_DIR:-~/.claude/homunculus}/corrections.jsonl` (the
 * instinct pipeline's input) and a systemMessage suggests distilling it via
 * /learn or the retrospective-codify skill. When CORRECTION_DISTILL=1
 * (opt-in, default off), a background read-only distiller additionally
 * drafts a rule update into ~/.claude/homunculus/drafts/ — see
 * personal/scripts/correction-distill.sh.
 *
 * Contract: never blocks the prompt. Every path returns either the raw
 * input unchanged (pass-through / "no opinion") or a JSON string carrying
 * only `systemMessage` — run-with-flags.js forwards a string run() result
 * to stdout verbatim, exit 0, which is exactly what the old Stop hook's
 * `printf '{"systemMessage":...}'` produced.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// Correction signal patterns (JP + EN), copied verbatim from the retired
// correction-detect.sh. Deliberately biased toward false positives — the
// output is only a log line and a suggestion, never a block.
const CORRECTION_PATTERN =
  '違う|ちがう|そうじゃな|じゃなくて|なんで(そう|こう|これ)|間違|まちがって|やめて|戻して|直して|修正して|しないで|するな|ルール|指示した|言ったのに|覚えて|してほしかった|wrong|not what I|why did you|I said|undo that|revert that|don.t do';
const CORRECTION_REGEXP = new RegExp(CORRECTION_PATTERN);

const SYSTEM_MESSAGE =
  '是正シグナルを検出しました（homunculus/corrections.jsonl に記録）。/learn か retrospective-codify で恒久ルール化を検討してください。';

const DEFAULT_DAILY_CAP = 5;
const SNIPPET_MAX_CHARS = 500;

function resolveClaudeDir() {
  return process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude');
}

// Keep the exact legacy path so markers written by the retired Stop hook
// still count toward the per-session debounce and daily cap.
function resolveStateDir() {
  return path.join(resolveClaudeDir(), '.cache', 'correction-detect');
}

function resolveHomunculusDir() {
  const override = process.env.CLV2_HOMUNCULUS_DIR;
  if (typeof override === 'string' && override.trim()) return override.trim();
  return path.join(resolveClaudeDir(), 'homunculus');
}

// Mirrors run-with-flags.js's own resolveHarness fallback: unset/unknown
// resolves to 'claude' rather than reject.
function resolveHarness() {
  const value = String(process.env.YOKI_HARNESS || 'claude').trim().toLowerCase();
  return value || 'claude';
}

function sanitizeSessionId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dayKey(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function localTimestamp(date) {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  );
}

function resolveDailyCap() {
  const raw = parseInt(process.env.CORRECTION_DETECT_DAILY_CAP, 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DAILY_CAP;
}

function markerPath(stateDir, sessionId) {
  return path.join(stateDir, `${sessionId}.done`);
}

function countPath(stateDir, day) {
  return path.join(stateDir, `count-${day}`);
}

function alreadyDetected(stateDir, sessionId) {
  return fs.existsSync(markerPath(stateDir, sessionId));
}

function readDailyCount(stateDir, day) {
  let raw;
  try {
    raw = fs.readFileSync(countPath(stateDir, day), 'utf8');
  } catch {
    return 0;
  }
  const digits = raw.replace(/[^0-9]/g, '');
  const parsed = parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordDetection(stateDir, sessionId, day, nextCount) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(markerPath(stateDir, sessionId), '');
    fs.writeFileSync(countPath(stateDir, day), String(nextCount));
  } catch {
    // Best-effort persistence: a missed write only means this session (or
    // day) may re-detect once more, never a crash — the debounce is an
    // optimization, not a safety property.
  }
}

function appendCorrection(homunculusDir, row) {
  try {
    fs.mkdirSync(homunculusDir, { recursive: true });
    fs.appendFileSync(path.join(homunculusDir, 'corrections.jsonl'), `${JSON.stringify(row)}\n`);
  } catch {
    // Losing one log row must never block the prompt.
  }
}

// Opt-in distillation: draft a rule update from this correction in the
// background (read-only headless agent; the draft lands in
// ~/.claude/homunculus/drafts/). Launching only after a recorded correction
// means it inherits this hook's debounce and daily cap. Recursion guards
// mirror correction-distill.sh's own: YOKI_SKIP_DISTILL short-circuits a
// child invocation, and the spawned env carries it (plus CLAUDECODE='') so
// the distiller's own `claude -p` session can never re-trigger this hook.
function maybeSpawnDistill({ transcriptPath, sessionId, snippet }) {
  if (process.env.CORRECTION_DISTILL !== '1') return;
  if (process.env.YOKI_SKIP_DISTILL) return;

  const distillScript = path.join(resolveClaudeDir(), 'scripts', 'correction-distill.sh');
  if (!fs.existsSync(distillScript)) return;

  try {
    const child = spawn('bash', [distillScript, String(transcriptPath || ''), sessionId, snippet], {
      detached: true,
      stdio: 'ignore',
      env: Object.assign({}, process.env, { YOKI_SKIP_DISTILL: '1', CLAUDECODE: '' })
    });
    child.unref();
  } catch {
    // Best-effort background spawn; never block the prompt on failure.
  }
}

function parseInput(rawInput) {
  if (typeof rawInput !== 'string') return rawInput && typeof rawInput === 'object' ? rawInput : null;
  if (!rawInput.trim()) return null;
  try {
    return JSON.parse(rawInput);
  } catch {
    return null;
  }
}

function passthrough(rawInput) {
  return typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput);
}

/**
 * @param {string} rawInput the raw UserPromptSubmit JSON payload
 */
function run(rawInput) {
  const input = parseInput(rawInput);
  if (!input) return passthrough(rawInput);

  const eventName = typeof input.hook_event_name === 'string' ? input.hook_event_name : '';
  if (eventName && eventName !== 'UserPromptSubmit') return passthrough(rawInput);

  if (process.env.CORRECTION_DETECT_DISABLED === '1') return passthrough(rawInput);

  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  if (!prompt.trim()) return passthrough(rawInput);

  // Input validation (defense in depth): a session id too short to be real
  // is treated the same as a missing one — never used to key state on disk.
  const sessionId = sanitizeSessionId(input.session_id);
  if (sessionId.length < 8) return passthrough(rawInput);

  const stateDir = resolveStateDir();

  // Debounce: at most one detection per session, capped per day.
  if (alreadyDetected(stateDir, sessionId)) return passthrough(rawInput);

  const now = new Date();
  const day = dayKey(now);
  const count = readDailyCount(stateDir, day);
  if (count >= resolveDailyCap()) return passthrough(rawInput);

  if (!CORRECTION_REGEXP.test(prompt)) return passthrough(rawInput);

  const snippet = prompt.slice(0, SNIPPET_MAX_CHARS);
  const cwd = typeof input.cwd === 'string' ? input.cwd : '';
  const harness = resolveHarness();

  appendCorrection(resolveHomunculusDir(), {
    ts: localTimestamp(now),
    session: sessionId,
    cwd,
    correction: snippet,
    harness
  });

  recordDetection(stateDir, sessionId, day, count + 1);

  maybeSpawnDistill({ transcriptPath: input.transcript_path, sessionId, snippet });

  return JSON.stringify({ systemMessage: SYSTEM_MESSAGE });
}

module.exports = {
  run,
  CORRECTION_PATTERN,
  CORRECTION_REGEXP,
  SYSTEM_MESSAGE,
  sanitizeSessionId,
  resolveClaudeDir,
  resolveStateDir,
  resolveHomunculusDir,
  resolveHarness
};
