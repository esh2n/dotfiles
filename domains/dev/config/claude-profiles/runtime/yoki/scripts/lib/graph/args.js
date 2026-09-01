'use strict';

/**
 * The flag parsing both CLIs in this directory share: `yoki-graph`
 * (cli.js) and `yoki-agent` (agent-cli.js).
 *
 * It lived twice, once per CLI, as byte-for-byte copies — and had already
 * started to drift: cli.js knew `--watch` was a boolean flag and
 * agent-cli.js did not, so the same argv parsed differently depending on
 * which CLI read it. Unlike the provider-lane helpers in
 * core/workflows/lib/lanes.js, nothing forces the duplication here: both
 * files are ordinary Node modules that already `require` their siblings.
 *
 * The boolean set is the one thing that legitimately differs per CLI, so it
 * is a parameter rather than a constant.
 */

/**
 * `--key value` -> `{key: 'value'}`, `--flag` (in `booleanFlags`, or followed
 * by another `--flag`, or last) -> `{flag: true}`, everything else -> `_`.
 *
 * @param {string[]} argv
 * @param {string[]|Set<string>} [booleanFlags] flags that never take a value
 * @returns {{_: string[]} & Record<string, string|true>}
 */
function parseArgs(argv, booleanFlags = []) {
  const booleans = booleanFlags instanceof Set ? booleanFlags : new Set(booleanFlags);
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    if (booleans.has(key)) { out[key] = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) { out[key] = true; continue; }
    out[key] = value;
    i += 1;
  }
  return out;
}

/** A numeric flag, or `undefined` when it was absent or unusable — the
 *  caller then falls back to its documented default. */
function numberFlag(value) {
  if (value === undefined || value === true) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

module.exports = { parseArgs, numberFlag };
