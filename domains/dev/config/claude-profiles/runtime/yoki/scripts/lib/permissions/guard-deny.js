'use strict';

/**
 * The deny set `hooks/pre-permission-guard.js` enforces, and the one place
 * that decides what belongs in it.
 *
 * Every harness gets a `<harness dir>/.yoki/permissions.json` written at
 * apply time (`{deny: [{pattern, reason}]}`); the guard reads whichever one
 * matches `YOKI_HARNESS`. What goes in it is the union of two things:
 *
 *   1. `enforce: [hook]` entries — patterns permissions.yaml itself declares
 *      no declarative permission match can be trusted for anywhere (shell
 *      redirection, wildcard rm targets, the write side of in-workspace
 *      secret globs).
 *   2. Whatever the target's own converter could NOT express declaratively.
 *      This is the half that used to be lost: on omp every path/domain-shaped
 *      deny (`Read(...)`, `Edit(...)`, `WebFetch(domain:...)`) has no
 *      config.yml equivalent at all, and on Codex the `Edit(...)` denies have
 *      neither an execpolicy rule nor a `[permissions.yoki.filesystem]` row.
 *      Those entries read as enforced in permissions.yaml while nothing
 *      enforced them.
 *
 * Both converters compute (2) themselves — they are the only code that knows
 * what their own target can express — and hand it here to be unioned with
 * (1) and deduped, so the shape the guard consumes is defined once.
 */

/**
 * The deny entries marked `enforce: [hook]` in permissions.yaml.
 *
 * @param {{deny: Array<{pattern:string, reason?:string, enforce?:string[]}>}} merged
 * @returns {Array<{pattern:string, reason:string}>}
 */
function hookEnforcedDeny(merged) {
  return ((merged && merged.deny) || [])
    .filter(entry => Array.isArray(entry.enforce) && entry.enforce.includes('hook'))
    .map(entry => ({ pattern: entry.pattern, reason: entry.reason || '' }));
}

/**
 * Unions any number of `{pattern, reason}` lists, first occurrence winning
 * (so a yaml-declared reason is kept over a converter-generated one).
 *
 * @param {...Array<{pattern:string, reason?:string}>} lists
 * @returns {Array<{pattern:string, reason:string}>}
 */
function mergeGuardDeny(...lists) {
  const byPattern = new Map();
  for (const list of lists) {
    for (const entry of list || []) {
      if (!entry || typeof entry.pattern !== 'string') continue;
      if (byPattern.has(entry.pattern)) continue;
      byPattern.set(entry.pattern, { pattern: entry.pattern, reason: entry.reason || '' });
    }
  }
  return [...byPattern.values()];
}

module.exports = { hookEnforcedDeny, mergeGuardDeny };
