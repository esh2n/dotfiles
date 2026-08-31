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
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { assertWithinTrustedRoot, isWithinRoot } = require('../path-safety');
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

function applyOp(op, ctx) {
  if (op.kind === 'skip') return;

  if (op.kind === 'remove') {
    const dest = assertParentWithinTrustedRoot(op.destinationPath, ctx.out, ctx.home, op.kind);
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
    fs.writeFileSync(dest, op.content, 'utf8');
    return;
  }

  if (op.kind === 'merge-json') {
    ensureParentDir(dest);
    fs.writeFileSync(dest, `${JSON.stringify(op.content, null, 2)}\n`, 'utf8');
    return;
  }

  throw new Error(`gen.js apply: unknown op kind "${op.kind}"`);
}

/** Ops with `layer !== 'generated'` come from one specific source-layer file
 * (an agent, a skill, a command) rather than being a merged singleton
 * (hooks.json/config.toml/AGENTS.md/rules/yoki.rules) — those are the ones a
 * later `--prune` run can safely remove once their source disappears. */
function writeManifest(planResult) {
  if (planResult.target !== 'codex') return; // only codex.js emits/reads this manifest today
  const manifestPath = path.join(planResult.out, codexTarget.MANIFEST_RELATIVE_PATH);
  const destinations = planResult.operations
    .filter(op => op.layer !== 'generated' && op.kind !== 'remove')
    .map(op => op.destinationPath);
  ensureParentDir(manifestPath);
  fs.writeFileSync(manifestPath, `${JSON.stringify(destinations, null, 2)}\n`, 'utf8');
}

/**
 * @param {{target: string, out: string, home?: string, sources: string[],
 *   operations: Array<object>, warnings: string[]}} planResult a `plan()`
 *   result — `home` MUST be the same value `plan()` used to compute any
 *   destination outside `out` (e.g. `~/.agents/skills/...`), or those ops
 *   will be refused by assertWithinTrustedRoot rather than silently
 *   redirected to a different home.
 */
function apply(planResult) {
  const home = planResult.home || os.homedir();
  for (const op of planResult.operations) {
    applyOp(op, { out: planResult.out, home });
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

module.exports = { plan, apply, parseArgs };

if (require.main === module) {
  main();
}
