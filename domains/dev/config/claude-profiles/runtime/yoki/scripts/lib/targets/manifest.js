'use strict';

/**
 * The per-target generated-output manifest (`<out>/.yoki/<target>-manifest.json`)
 * and its containment rules.
 *
 * The manifest is the ONLY input to `--prune`, and `--prune` deletes
 * recursively. It is also a plain JSON file inside the user's home dir that
 * any process (or any agent with a shell) can rewrite — the same
 * attacker-controllable-state-file situation ../path-safety.js was written
 * for (GHSA-hfpv-w6mp-5g95). So:
 *
 *   - WRITE side: only destinations under `<out>` are recorded. A generated
 *     destination outside `out` (Codex's port-less-skill symlinks into
 *     `~/.agents/skills/<name>`) is deliberately NOT prunable — losing an
 *     automatic cleanup there is a far smaller cost than making `--prune`
 *     able to delete anywhere under `$HOME`.
 *   - READ side: an entry outside `<out>` means the file was tampered with
 *     (this generator can no longer produce one), so the whole manifest is
 *     rejected and NOTHING is deleted — never "skip the bad entry and prune
 *     the rest", which would let an attacker suppress a real prune.
 */

const path = require('path');

const { isWithinRoot } = require('../path-safety');

/** `<out>/.yoki/<target>-manifest.json`. */
function manifestRelativePath(target) {
  return path.join('.yoki', `${target}-manifest.json`);
}

function manifestPathFor(out, target) {
  return path.join(out, manifestRelativePath(target));
}

/**
 * Destinations to record for a plan. Ops with `layer === 'generated'` are
 * merged-in-place singletons (hooks.json/config.toml/AGENTS.md/RULES.md/…)
 * that are never candidates for pruning; `remove` ops are the prune itself.
 *
 * @param {Array<{kind:string, destinationPath:string, layer?:string}>} operations
 * @param {string} out
 * @returns {string[]}
 */
function manifestDestinations(operations, out) {
  return operations
    .filter(op => op.layer !== 'generated' && op.kind !== 'remove')
    .map(op => op.destinationPath)
    .filter(destinationPath => isWithinRoot(destinationPath, out));
}

/**
 * @param {string} manifestPath
 * @param {string} out
 * @param {(p: string) => any} readJsonIfExists injected so this module stays
 *   free of a dependency on ./layers (which depends on much more)
 * @returns {string[]} the recorded destinations, or `[]` when there is no
 *   manifest yet.
 * @throws when the manifest exists but lists a destination outside `out`.
 */
function readManifest(manifestPath, out, readJsonIfExists) {
  const previous = readJsonIfExists(manifestPath);
  if (previous === null || previous === undefined) return [];
  if (!Array.isArray(previous)) {
    throw new Error(`Refusing to prune: ${manifestPath} is not a JSON array of destination paths.`);
  }

  const entries = [];
  for (const entry of previous) {
    if (typeof entry !== 'string' || entry === '') {
      throw new Error(`Refusing to prune: ${manifestPath} contains a non-path entry (${JSON.stringify(entry)}). No files were removed.`);
    }
    if (!isWithinRoot(entry, out)) {
      throw new Error(
        `Refusing to prune: ${manifestPath} lists "${entry}", which is outside the install root "${out}". ` +
        'This generator only ever records paths under that root, so the manifest has been altered. ' +
        'No files were removed — re-run the generator WITHOUT --prune to rewrite the manifest, then prune again.'
      );
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * @param {{manifestPath: string, out: string, prunableDestinations: string[],
 *   prune: boolean, readJsonIfExists: Function}} args
 * @returns {Array<{kind:'remove', destinationPath:string, layer:'generated'}>}
 */
function buildPruneOperations({ manifestPath, out, prunableDestinations, prune, readJsonIfExists }) {
  if (!prune) return [];
  const previous = readManifest(manifestPath, out, readJsonIfExists);
  const current = new Set(prunableDestinations);
  return previous
    .filter(destinationPath => !current.has(destinationPath))
    .map(destinationPath => ({ kind: 'remove', destinationPath, layer: 'generated' }));
}

module.exports = {
  manifestRelativePath,
  manifestPathFor,
  manifestDestinations,
  readManifest,
  buildPruneOperations,
};
