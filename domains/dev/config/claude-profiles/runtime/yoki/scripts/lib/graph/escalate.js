'use strict';

/**
 * The escalation queue — the durable state behind `/escalate`.
 *
 * The design question (model-tier-escalation-design): let a cheap main agent
 * defer a hard decision to an expensive frontier model WITHOUT (a) blocking
 * the main agent or (b) auto-spending on the frontier. The answer, matching
 * LangGraph's interrupt+checkpoint prior art, is a human-gated async queue:
 *
 *   1. A workflow (or pi) calls `escalate(question)` — this ENQUEUES a
 *      pending record and returns immediately. The main lane never blocks and
 *      no frontier model is called.
 *   2. A human reviews the queue (`yoki-graph escalate list`) and runs the
 *      chosen ones (`yoki-graph escalate run <id>`). Running the command IS
 *      the gate and the spend authorization; only then does the `consult`
 *      role's backend actually answer.
 *
 * Records live one-file-per-escalation under the same state root as run
 * journals (`<stateRoot>/yoki/escalations/<id>.json`), so the queue survives
 * process exit and is visible across sessions. Writes are atomic (temp +
 * rename) so a concurrent reader never sees a half-written record.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { stateRoot } = require('./journal');

const STATUSES = ['pending', 'answered', 'failed'];

function escalationsDir(env = process.env) {
  return path.join(stateRoot(env), 'yoki', 'escalations');
}

function recordPath(id, env = process.env) {
  return path.join(escalationsDir(env), `${sanitizeId(id)}.json`);
}

/** Ids are our own (newId) so this is belt-and-braces against a caller-passed
 *  id escaping the directory; a bad id becomes a flat filename, never a path. */
function sanitizeId(id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '_');
}

// Monotonic within this process so two escalations enqueued in the same
// millisecond still sort in creation order (their `createdAt` ties otherwise).
let seq = 0;
function newId() {
  const n = (seq += 1).toString(36).padStart(4, '0');
  return `esc-${Date.now().toString(36)}-${n}-${crypto.randomBytes(2).toString('hex')}`;
}

function atomicWriteJson(file, obj) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/**
 * Enqueue a pending escalation. Returns the written record. `role` defaults
 * to `consult` (the frontier architect); `source` records who raised it
 * ('workflow' | 'pi' | ...). Everything else is metadata for the human
 * reviewing the queue.
 */
function enqueue(input = {}, env = process.env) {
  const id = input.id ? sanitizeId(input.id) : newId();
  const record = {
    id,
    status: 'pending',
    question: String(input.question || '').trim(),
    context: input.context != null ? String(input.context) : '',
    role: typeof input.role === 'string' && input.role.trim() ? input.role.trim() : 'consult',
    runId: input.runId || null,
    label: input.label || null,
    source: input.source || null,
    createdAt: new Date().toISOString(),
  };
  if (!record.question) throw new Error('escalate: a question is required');
  fs.mkdirSync(escalationsDir(env), { recursive: true });
  atomicWriteJson(recordPath(id, env), record);
  return record;
}

/** All records, oldest first. `{status}` filters to one status. Missing dir
 *  or malformed files degrade to "skip", never throw — a broken record must
 *  not hide the rest of the queue. */
function list(env = process.env, { status } = {}) {
  let files;
  try { files = fs.readdirSync(escalationsDir(env)); } catch { return []; }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(escalationsDir(env), f), 'utf8'));
      if (rec && typeof rec === 'object' && (!status || rec.status === status)) out.push(rec);
    } catch { /* skip a half-written or corrupt record */ }
  }
  out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))
    || String(a.id).localeCompare(String(b.id)));
  return out;
}

function get(id, env = process.env) {
  try {
    return JSON.parse(fs.readFileSync(recordPath(id, env), 'utf8'));
  } catch {
    return null;
  }
}

/** Merge `patch` into an existing record and rewrite it atomically. */
function update(id, patch, env = process.env) {
  const rec = get(id, env);
  if (!rec) throw new Error(`escalation "${id}" not found`);
  const next = { ...rec, ...patch, updatedAt: new Date().toISOString() };
  atomicWriteJson(recordPath(id, env), next);
  return next;
}

module.exports = {
  STATUSES,
  escalationsDir,
  recordPath,
  newId,
  enqueue,
  list,
  get,
  update,
};
