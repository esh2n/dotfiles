'use strict';

/**
 * One active process per runId.
 *
 * The journal is an append-only JSONL file and `run.json` is rewritten
 * wholesale at the end of a run, so two `yoki-graph run --resume <runId>`
 * processes on the same id interleave their entries: the prefix-replay
 * cursor of each sees the other's writes, and the surviving `run.json` is
 * whichever finished last. A lock file in the run directory makes the
 * second process refuse instead.
 *
 * Held as `<runDir>/lock`, created with the `wx` flag so creation is atomic
 * (no check-then-create race), containing `{pid, host, startedAt, token}`.
 * A lock is STALE — and gets taken over — when its owning pid is gone on
 * this host, or when it is older than `staleMs` (default 1h) regardless of
 * host, because a pid from another machine says nothing about liveness here.
 * `token` makes release safe: a process only removes the lock it wrote, so
 * releasing a lock that was already stolen from it is a no-op rather than
 * an eviction of the current holder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { runDir } = require('./journal');

const DEFAULT_STALE_MS = 60 * 60 * 1000; // 1 hour

function lockPath(runId) {
  return path.join(runDir(runId), 'lock');
}

function readLockFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    // Missing, truncated, or garbage: treat as an unowned lock, which
    // isStale() below turns into "take it over".
    return null;
  }
}

/** `kill(pid, 0)` sends no signal — it only asks whether the pid exists.
 *  EPERM means it exists and belongs to someone else, i.e. alive. */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function isStale(info, { staleMs = DEFAULT_STALE_MS, now = Date.now(), hostname = os.hostname() } = {}) {
  if (!info) return true;
  const startedAt = Date.parse(info.startedAt);
  const ageMs = Number.isFinite(startedAt) ? now - startedAt : Infinity;
  if (ageMs > staleMs) return true;
  // A pid is only meaningful on the machine that minted it; a lock from
  // another host is trusted until it ages out.
  if (info.host !== hostname) return false;
  return !pidAlive(info.pid);
}

/**
 * Take the lock for `runId`.
 *
 * @returns {{file:string, token:string, stolen:boolean, release:() => void}}
 * @throws {Error} with `code: 'ERUNACTIVE'` when a live lock is held.
 */
function acquire(runId, options = {}) {
  const { staleMs = DEFAULT_STALE_MS, now = Date.now(), hostname = os.hostname() } = options;
  const dir = runDir(runId);
  fs.mkdirSync(dir, { recursive: true });
  const file = lockPath(runId);
  const token = crypto.randomBytes(8).toString('hex');
  const payload = JSON.stringify({
    runId, pid: process.pid, host: hostname, startedAt: new Date(now).toISOString(), token,
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, 'wx');
      try { fs.writeFileSync(fd, payload); } finally { fs.closeSync(fd); }
      return { file, token, stolen: attempt > 0, release: () => release(file, token) };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const info = readLockFile(file);
      if (!isStale(info, { staleMs, now, hostname })) {
        const held = new Error(
          `run ${runId} is already active (pid ${info.pid} on ${info.host}, since ${info.startedAt}) — `
          + `wait for it to finish, or delete ${file} if you know that process is gone`,
        );
        held.code = 'ERUNACTIVE';
        held.lock = info;
        throw held;
      }
      // Stale: drop it and let the next iteration's `wx` decide the winner
      // if several processes reached this point together.
      try { fs.unlinkSync(file); } catch { /* someone else already took it over */ }
    }
  }

  const lost = new Error(`run ${runId}: could not take the run lock at ${file} (another process took over a stale lock first)`);
  lost.code = 'ERUNACTIVE';
  throw lost;
}

/** Remove the lock, but only if it is still the one `token` created. */
function release(file, token) {
  try {
    const info = readLockFile(file);
    if (info && info.token !== token) return; // stolen since; not ours to remove
    fs.unlinkSync(file);
  } catch {
    // Already gone, or an unwritable state dir — releasing is best-effort by
    // design: a leftover lock ages out via staleMs.
  }
}

module.exports = { acquire, release, isStale, pidAlive, lockPath, readLockFile, DEFAULT_STALE_MS };
