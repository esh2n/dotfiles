#!/usr/bin/env node
/**
 * Codex `notify` external program (`config.toml`: `notify = ["node",
 * "<YOKI_ROOT>/scripts/hooks/codex-notify.js"]` — see lib/targets/codex.js).
 *
 * Codex spawns the configured `notify` program directly (not through a
 * hooks.json handler), and the exact payload shape it passes was left
 * unverified by scratchpad spikes S1/S7 — the spike only confirmed the
 * `notify = [...]` config key exists, not what argv/stdin carries. This
 * script therefore parses defensively from either source, logs the raw
 * payload once per process so the real shape can be captured from a live
 * run, and only acts on a payload it can confidently classify — an
 * unrecognized shape is logged and silently ignored rather than guessed at
 * with a possibly-wrong notification.
 *
 * Recognized events forward to the same macOS `osascript` notifications the
 * Claude Code `Notification` hooks use (personal/settings.personal.json):
 * a permission/approval request, or a turn/task going idle.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const LOG_PATH = path.join(os.homedir(), '.local', 'state', 'yoki', 'codex-notify.log');

function readStdinSync() {
  try {
    if (process.stdin.isTTY) return '';
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** argv[2] is the first argument after the script path when Codex invokes
 * `node codex-notify.js <payload>`; stdin is the fallback (S1/S7: shape
 * unverified — Codex may prefer either). */
function readRawPayload(argv) {
  const argPayload = argv[2];
  if (typeof argPayload === 'string' && argPayload.trim()) return argPayload;
  return readStdinSync();
}

function logRaw(raw) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${raw}\n`);
  } catch {
    // best-effort logging only; never let a logging failure block the notifier
  }
}

/** Every string field this script might find a classifiable event name in,
 * across the several shapes a Codex notify payload could plausibly take. */
function candidateStrings(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const fields = [payload.type, payload.event, payload.kind, payload.status];
  if (payload.msg && typeof payload.msg === 'object') {
    fields.push(payload.msg.type, payload.msg.event);
  }
  return fields.filter(v => typeof v === 'string');
}

function classify(payload) {
  const strings = candidateStrings(payload).map(s => s.toLowerCase());
  if (strings.some(s => /approval|permission/.test(s))) return 'permission_prompt';
  if (strings.some(s => /idle|turn-complete|task-complete|complete|done/.test(s))) return 'idle_prompt';
  return null;
}

const NOTIFICATIONS = {
  permission_prompt: { message: '承認が必要です', sound: 'Ping' },
  idle_prompt: { message: 'タスク完了', sound: 'Glass' },
};

function osascriptEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function notify(kind) {
  const spec = NOTIFICATIONS[kind];
  if (!spec || process.platform !== 'darwin') return;
  const script = `display notification "${osascriptEscape(spec.message)}" with title "Codex" sound name "${spec.sound}"`;
  try {
    execFileSync('osascript', ['-e', script], { stdio: 'ignore' });
  } catch {
    // best-effort desktop notification only
  }
}

function main(argv) {
  const raw = readRawPayload(argv);
  logRaw(raw || '(empty)');

  let payload = null;
  try {
    payload = raw && raw.trim() ? JSON.parse(raw) : null;
  } catch {
    payload = null; // non-JSON payload: logged above, nothing to classify
  }

  const kind = classify(payload);
  if (kind) notify(kind);
}

module.exports = { classify, candidateStrings, main };

if (require.main === module) {
  main(process.argv);
}
