#!/usr/bin/env node
'use strict';

/**
 * Install-target generator CLI (task T9 / spike S6 "Minimal generator
 * interface"). Computes a plan of filesystem operations from the layered
 * `claude-profiles` sources and, unless `--dry-run`, applies it.
 *
 *   node gen.js --target codex|omp --sources <core>,<pack…>,<personal> \
 *        --out <home dir> [--dry-run] [--json] [--prune] \
 *        [--home <dir>] [--dotfiles-root <dir>]
 *
 * Exit 0 on success (dry-run included), 1 on a plan/validation error, 2 when
 * a write was refused by lib/path-safety.js's assertWithinTrustedRoot.
 *
 * `apply()` is not a transaction — the destinations are the user's real
 * `~/.codex` / `~/.omp/agent`, so there is nothing to roll back to. What it
 * guarantees instead:
 *   - every file write is temp-file + same-directory rename, so no
 *     destination is ever observed truncated or half-written
 *     (`writeFileAtomic`)
 *   - the mutually-dependent files land in a safe order — config.toml's
 *     trust hashes before hooks.json, the manifest last (`sortOpsForApply`)
 *   - a thrown error names every destination that was already updated, so
 *     an interrupted apply is legible rather than silent
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { assertWithinTrustedRoot, isWithinRoot } = require('../path-safety');
const { manifestPathFor, manifestDestinations } = require('./manifest');
const codexTarget = require('./codex');
const ompTarget = require('./omp');

const TARGETS = { codex: codexTarget, omp: ompTarget };

function parseArgs(argv) {
  const options = { dryRun: false, json: false, prune: false };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--target':
        options.target = argv[++i];
        break;
      case '--sources':
        options.sources = String(argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
        break;
      case '--out':
        options.out = argv[++i];
        break;
      case '--home':
        options.home = argv[++i];
        break;
      case '--dotfiles-root':
        options.dotfilesRoot = argv[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--prune':
        options.prune = true;
        break;
      default:
        positional.push(arg);
    }
  }

  return { options, positional };
}

function defaultOutFor(target, home) {
  if (target === 'codex') return path.join(home, '.codex');
  if (target === 'omp') return path.join(home, '.omp', 'agent');
  return undefined;
}

/**
 * @param {{target: string, sources: string[], out?: string, home?: string,
 *   dotfilesRoot?: string, prune?: boolean, env?: NodeJS.ProcessEnv}} options
 */
function plan(options) {
  const targetModule = TARGETS[options.target];
  if (!targetModule) {
    throw new Error(`gen.js: unknown --target "${options.target}" (known: ${Object.keys(TARGETS).join(', ')})`);
  }
  if (!Array.isArray(options.sources) || options.sources.length === 0) {
    throw new Error('gen.js: --sources is required (comma-separated layer roots, core first, personal last)');
  }

  const home = options.home || os.homedir();
  const out = options.out || defaultOutFor(options.target, home);
  if (!out) {
    throw new Error('gen.js: --out is required (no default for this target)');
  }

  return targetModule.plan({
    sources: options.sources,
    out,
    home,
    env: options.env,
    prune: Boolean(options.prune),
    dotfilesRoot: options.dotfilesRoot,
  });
}

/** Picks whichever of `out`/`home` actually contains `destinationPath` —
 * most ops resolve under `out` (`~/.codex`), but a plain-skill port
 * (`~/.agents/skills/<name>`) resolves under `home` instead. */
function resolveTrustedRoot(destinationPath, out, home) {
  return isWithinRoot(destinationPath, out) ? out : home;
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function removeIfExists(destPath) {
  try {
    fs.rmSync(destPath, { recursive: true, force: true });
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }
}

/**
 * Guards a destination whose leaf may already exist as a symlink (every
 * `symlink` op, on a re-run, and any `remove` op that prunes one) by
 * checking containment on the PARENT directory and re-joining the basename,
 * rather than on the full path directly. `assertWithinTrustedRoot` ->
 * `realpathNearestExisting` -> `fs.realpathSync` dereferences an existing
 * symlink all the way to its target — for `~/.codex/skills/<name>` (or
 * `~/.agents/skills/<name>`) that target is deliberately OUTSIDE the
 * trusted root (a claude-profiles skill dir), so checking the leaf itself
 * would refuse every idempotent re-run once the symlink exists. The parent
 * directory is never meant to be a symlink out of root, so checking it is
 * both correct and still fail-closed against a crafted parent-dir escape.
 */
function assertParentWithinTrustedRoot(destinationPath, out, home, action) {
  const parent = path.dirname(destinationPath);
  const root = resolveTrustedRoot(parent, out, home);
  const trustedParent = assertWithinTrustedRoot(parent, root, action);
  return path.join(trustedParent, path.basename(destinationPath));
}

/**
 * `remove` is the one destructive op (`fs.rmSync` recursive), and its
 * destinations come from a manifest file sitting in the user's home dir that
 * any process can rewrite. So it gets the STRICTEST root: `out` only, never
 * the `home` fallback resolveTrustedRoot() allows for the `~/.agents/skills`
 * symlink ports. `<out>/.yoki/<target>-manifest.json` can only ever list
 * paths under `out` (lib/targets/manifest.js enforces that on both the read
 * and the write side), so nothing legitimate is lost.
 *
 * Containment is still checked on the PARENT and the basename re-joined,
 * for the reason assertParentWithinTrustedRoot documents: a `remove` target
 * may itself BE a symlink pointing deliberately outside the root (omp's
 * `config.yml -> <repo>/domains/dev/config/omp/config.yml`, which this
 * generator replaces with a real file), and realpath'ing the leaf would
 * refuse exactly that case. A parent inside `out` plus a plain basename is
 * inside `out` by construction.
 */
function assertRemoveWithinOut(destinationPath, out) {
  const parent = path.dirname(destinationPath);
  const trustedParent = assertWithinTrustedRoot(parent, out, 'remove');
  const dest = path.join(trustedParent, path.basename(destinationPath));
  if (!isWithinRoot(parent, out)) {
    throw new Error(`Refusing to remove outside the install root: '${destinationPath}' is not within '${out}'.`);
  }
  return dest;
}

/**
 * Writes `content` to `dest` atomically: a temp file in the SAME directory
 * (so the rename is a same-filesystem operation, which POSIX makes atomic),
 * then `fs.renameSync` over the destination. A crash, Ctrl-C or OOM-kill
 * mid-write therefore leaves either the old file or the new one, never a
 * truncated or half-written one.
 *
 * This matters most for the codex pair: hooks.json holds the hook
 * definitions and config.toml holds their `[hooks.state]` trust hashes, and
 * a hooks.json whose hashes are still the previous run's is exactly the
 * silent-skip state doctor's trust-drift check exists to catch. Atomicity
 * per file plus the ordering in `sortOpsForApply` is what keeps an
 * interrupted apply out of that state.
 *
 * The temp name carries the pid so two concurrent applies cannot collide on
 * it, and it is removed on a failed write rather than left behind.
 */
function writeFileAtomic(dest, content) {
  const tmp = `${dest}.yoki-tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, dest);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

function applyOp(op, ctx) {
  if (op.kind === 'skip') return;

  if (op.kind === 'remove') {
    const dest = assertRemoveWithinOut(op.destinationPath, ctx.out);
    removeIfExists(dest);
    return;
  }

  if (op.kind === 'symlink') {
    const dest = assertParentWithinTrustedRoot(op.destinationPath, ctx.out, ctx.home, op.kind);
    ensureParentDir(dest);
    removeIfExists(dest);
    fs.symlinkSync(op.sourcePath, dest, 'dir');
    return;
  }

  const root = resolveTrustedRoot(op.destinationPath, ctx.out, ctx.home);
  const dest = assertWithinTrustedRoot(op.destinationPath, root, op.kind);

  if (op.kind === 'write' || op.kind === 'toml-block') {
    ensureParentDir(dest);
    writeFileAtomic(dest, op.content);
    return;
  }

  if (op.kind === 'merge-json') {
    ensureParentDir(dest);
    writeFileAtomic(dest, `${JSON.stringify(op.content, null, 2)}\n`);
    return;
  }

  throw new Error(`gen.js apply: unknown op kind "${op.kind}"`);
}

/**
 * `apply()` has no transaction across files — it cannot, since the
 * destinations are the user's real `~/.codex` / `~/.omp/agent`. What it CAN
 * control is the order in which the two mutually-dependent files land, so
 * that an interruption between them leaves the *recoverable* half-state
 * rather than the silent one:
 *
 *   config.toml (trust hashes)  →  hooks.json  →  everything else  →  manifest
 *
 * Hashes-before-hooks means an interrupted run leaves config.toml carrying
 * trust entries for handlers hooks.json does not have yet. Codex ignores a
 * `[hooks.state]` key that names a hook it cannot find, so the machine keeps
 * running the PREVIOUS, still-trusted hooks.json — a no-op, not a downgrade.
 * The reverse order leaves the new hooks.json untrusted, which is the
 * "codex exec で無言スキップされる" state.
 *
 * The manifest goes last for the same reason it always did: it is the record
 * of what a later `--prune` may delete, so it must never claim a destination
 * that was not actually written.
 *
 * Ops that are neither of those two keep their relative order (a stable
 * sort), because agent/skill/command ops are independent of each other.
 *
 * @param {Array<object>} operations
 * @returns {Array<object>} a new array; `operations` is not mutated
 */
function sortOpsForApply(operations) {
  const rank = (op) => {
    const base = path.basename(String(op.destinationPath || ''));
    if (base === 'config.toml') return 0;
    if (base === 'hooks.json') return 1;
    return 2;
  };
  return operations
    .map((op, index) => ({ op, index }))
    .sort((a, b) => (rank(a.op) - rank(b.op)) || (a.index - b.index))
    .map((entry) => entry.op);
}

/** Ops with `layer !== 'generated'` come from one specific source-layer file
 * (an agent, a skill, a command) rather than being a merged singleton
 * (hooks.json/config.toml/AGENTS.md/RULES.md/rules/yoki.rules) — those are
 * the ones a later `--prune` run can safely remove once their source
 * disappears. Written for EVERY target (omp's `agents/<name>.md` outputs
 * have exactly the same staleness problem codex's do); destinations outside
 * `out` are excluded by manifestDestinations(), which is what keeps
 * `--prune` unable to delete anywhere but `out`. */
function writeManifest(planResult) {
  const manifestPath = manifestPathFor(planResult.out, planResult.target);
  const destinations = manifestDestinations(planResult.operations, planResult.out);
  ensureParentDir(manifestPath);
  writeFileAtomic(manifestPath, `${JSON.stringify(destinations, null, 2)}\n`);
}

/**
 * @param {{target: string, out: string, home?: string, sources: string[],
 *   operations: Array<object>, warnings: string[]}} planResult a `plan()`
 *   result — `home` MUST be the same value `plan()` used to compute any
 *   destination outside `out` (e.g. `~/.agents/skills/...`), or those ops
 *   will be refused by assertWithinTrustedRoot rather than silently
 *   redirected to a different home.
 */
function apply(planResult, deps = {}) {
  const home = planResult.home || os.homedir();
  const runOp = deps.applyOp || applyOp;
  const ordered = sortOpsForApply(planResult.operations);
  const applied = [];

  for (const op of ordered) {
    try {
      runOp(op, { out: planResult.out, home });
    } catch (err) {
      // An interrupted apply is not silent: say exactly which destinations
      // already changed, so the reader knows what state the machine is in
      // and does not have to guess whether a re-run is safe (it is —
      // `apply` is idempotent — but that is only obvious once you know how
      // far it got).
      err.appliedDestinations = applied;
      err.message = [
        err.message,
        '',
        `gen.js apply: stopped at ${op.kind} ${op.destinationPath}`,
        applied.length === 0
          ? 'gen.js apply: no files were updated before this point.'
          : `gen.js apply: ${applied.length} file(s) already updated:\n${applied.map(d => `  ${d}`).join('\n')}`,
        'gen.js apply: the manifest was NOT written; re-run `yoki-switch apply` to finish (it is idempotent).',
      ].join('\n');
      throw err;
    }
    if (op.kind !== 'skip') applied.push(op.destinationPath);
  }

  writeManifest(planResult);
  return planResult;
}

function formatOpLine(op) {
  const src = op.sourcePath ? ` <- ${op.sourcePath}` : '';
  return `${op.kind}  ${op.destinationPath}${src}`;
}

function main() {
  const { options } = parseArgs(process.argv.slice(2));

  let planResult;
  try {
    planResult = plan(options);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
    return;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(planResult, null, 2)}\n`);
  } else {
    for (const op of planResult.operations) process.stdout.write(`${formatOpLine(op)}\n`);
    // Every hook command that could not be translated, printed one per line.
    // A dropped guard is a protection downgrade, so it is never left to a
    // reader to notice its absence from the op list.
    for (const entry of planResult.skipped || []) {
      process.stdout.write(`skipped  ${entry.event}/${entry.matcher}  ${entry.command}  -- ${entry.reason}\n`);
    }
    for (const warning of planResult.warnings) process.stderr.write(`warning: ${warning}\n`);
  }

  if (options.dryRun) {
    process.exit(0);
    return;
  }

  try {
    apply(planResult);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(err && err.message && err.message.includes('Refusing to') ? 2 : 1);
    return;
  }

  process.exit(0);
}

module.exports = { plan, apply, parseArgs, applyOp, sortOpsForApply, writeFileAtomic };

if (require.main === module) {
  main();
}
