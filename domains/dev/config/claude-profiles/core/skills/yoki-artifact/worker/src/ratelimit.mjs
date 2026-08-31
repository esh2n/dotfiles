// ratelimit.mjs — a per-isolate sliding-window limiter.
//
// Honest about what it is: Workers isolates come and go and there may be many
// at once, so this is a backstop against one runaway client (a CLI loop, a
// polling script), not a security boundary. The real gate is Cloudflare Access
// in front of the Worker plus the account's free-tier request ceiling.

export const DEFAULT_LIMIT = 240;
export const DEFAULT_WINDOW_MS = 60 * 1000;
/** Distinct keys kept before the oldest are dropped, so memory stays bounded. */
const MAX_KEYS = 2000;

export function createRateLimiter({ limit = DEFAULT_LIMIT, windowMs = DEFAULT_WINDOW_MS } = {}) {
  const windows = new Map();

  return {
    /**
     * @returns {{ok: boolean, remaining: number, retryAfterSec: number}}
     */
    check(key, now = Date.now()) {
      const current = windows.get(key);
      if (!current || current.startedAt + windowMs <= now) {
        if (windows.size >= MAX_KEYS) {
          const oldest = windows.keys().next();
          if (!oldest.done) windows.delete(oldest.value);
        }
        windows.set(key, { startedAt: now, count: 1 });
        return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
      }
      const next = { startedAt: current.startedAt, count: current.count + 1 };
      windows.set(key, next);
      if (next.count > limit) {
        const retryAfterSec = Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1000));
        return { ok: false, remaining: 0, retryAfterSec };
      }
      return { ok: true, remaining: limit - next.count, retryAfterSec: 0 };
    },
  };
}
