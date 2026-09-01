'use strict';

/**
 * yoki-loop (task T19) — the real CLI logic behind `domains/dev/bin/yoki-loop`
 * (a thin node launcher that just resolves DOTFILES_ROOT and calls
 * `main()` here, the same split `hook-flags.js`/`gen.js` use elsewhere).
 *
 * Commands:
 *   run <name>        build + run (or --dry-run print) the headless command
 *                      (`--sandbox read-only|workspace-write|danger-full-access`
 *                       narrows or widens a codex run; default workspace-write)
 *   install <name>    write a launchd plist; print, never run, the
 *                      `launchctl bootstrap` command
 *   uninstall <name>  remove the plist; print the `launchctl bootout` command
 *   status [name]     recent runs.jsonl rows + estimated next fire time
 *   list              installed loop names
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const configModule = require('./config');
const state = require('./state');
const plist = require('./plist');
const inbox = require('./inbox');
const runner = require('./runner');

const VALID_HARNESSES = new Set(['claude', 'codex', 'omp']);
const LAUNCH_AGENTS_DIR_SEGMENTS = ['Library', 'LaunchAgents'];
const STATUS_RUN_LIMIT = 10;

function usageError(message) {
  const err = new Error(message);
  err.isUsageError = true;
  return err;
}

// ---------------------------------------------------------------------------
// argument parsing
// ---------------------------------------------------------------------------

/** Flags shared by `run` and `install`; mutates and returns `options`. */
function parseFlags(argv, startIndex, options) {
  for (let i = startIndex; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--harness':
        options.harness = argv[++i];
        break;
      case '--cwd':
        options.cwd = argv[++i];
        break;
      case '--prompt':
        options.prompt = argv[++i];
        break;
      case '--prompt-file':
        options.promptFile = argv[++i];
        break;
      case '--prompt-from-artifact-inbox':
        options.promptFromArtifactInbox = true;
        break;
      case '--model':
        options.model = argv[++i];
        break;
      case '--sandbox':
        options.sandbox = argv[++i];
        break;
      case '--resume':
        options.resume = true;
        break;
      case '--max-runs':
        options.maxRuns = Number(argv[++i]);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--every':
        options.every = argv[++i];
        break;
      default:
        throw usageError(`yoki-loop: unrecognized flag "${arg}"`);
    }
  }
  return options;
}

/**
 * @returns {{command: string, name: string|null, options: object,
 *   rawFlagArgv: string[]}} `rawFlagArgv` is the exact flag tokens as typed
 *   (from index 2 onward) — `install` forwards these verbatim into the
 *   plist's `ProgramArguments` (an argv array needs no shell re-quoting),
 *   rather than re-serializing parsed option values.
 */
function parseArgs(argv) {
  const command = argv[0];
  if (!command) throw usageError('yoki-loop: missing command (run|install|uninstall|status|list)');
  if (!['run', 'install', 'uninstall', 'status', 'list'].includes(command)) {
    throw usageError(`yoki-loop: unknown command "${command}" (run|install|uninstall|status|list)`);
  }

  if (command === 'list') return { command, name: null, options: {}, rawFlagArgv: [] };

  const second = argv[1];
  const hasName = typeof second === 'string' && !second.startsWith('--');
  if (command === 'status') {
    const name = hasName ? second : null;
    return { command, name, options: {}, rawFlagArgv: [] };
  }

  if (!hasName) throw usageError(`yoki-loop ${command}: missing <name>`);
  const rawFlagArgv = argv.slice(2);
  const options = parseFlags(argv, 2, {});
  return { command, name: second, options, rawFlagArgv };
}

/** Drops a `--every <value>` pair from a raw flag token list — `install`
 *  consumes `--every` itself; it must not also land in the re-invoked
 *  `yoki-loop run` inside the plist. */
function withoutEveryFlag(rawFlagArgv) {
  const out = [];
  for (let i = 0; i < rawFlagArgv.length; i++) {
    if (rawFlagArgv[i] === '--every') {
      i += 1; // skip its value too
      continue;
    }
    out.push(rawFlagArgv[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// prompt resolution (run only — install stores the flags, not a prompt)
// ---------------------------------------------------------------------------

function resolvePrompt(options, env) {
  const sources = [options.prompt != null, !!options.promptFile, !!options.promptFromArtifactInbox].filter(Boolean);
  if (sources.length === 0) {
    throw usageError('yoki-loop run: one of --prompt, --prompt-file, or --prompt-from-artifact-inbox is required');
  }
  if (sources.length > 1) {
    throw usageError('yoki-loop run: --prompt, --prompt-file, and --prompt-from-artifact-inbox are mutually exclusive');
  }

  if (options.prompt != null) return options.prompt;
  if (options.promptFile) return fs.readFileSync(options.promptFile, 'utf8');
  return inbox.consumeArtifactInboxPrompt(env); // null when nothing unread
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

function cmdRun(name, options, ctx) {
  const { dotfilesRoot, env, stdout, stderr } = ctx;

  if (!options.harness || !VALID_HARNESSES.has(options.harness)) {
    throw usageError('yoki-loop run: --harness must be one of claude, codex, omp');
  }
  if (!options.cwd) throw usageError('yoki-loop run: --cwd is required');

  const prompt = resolvePrompt(options, env);
  if (prompt === null) {
    stdout.write('yoki-loop: --prompt-from-artifact-inbox found nothing unread — skipping this run\n');
    return 0;
  }

  const result = runner.run(
    {
      name,
      harness: options.harness,
      cwd: options.cwd,
      prompt,
      model: options.model,
      sandbox: options.sandbox,
      resume: !!options.resume,
      maxRuns: options.maxRuns,
      dryRun: !!options.dryRun,
      dotfilesRoot,
      env,
    },
    { writeOut: (text) => stdout.write(text) }
  );

  if (!result.dryRun) {
    stderr.write(`yoki-loop: ${options.harness} exited ${result.row.exit} in ${result.row.durationMs}ms\n`);
  }
  return result.dryRun || result.row.exit === 0 ? 0 : result.row.exit;
}

// ---------------------------------------------------------------------------
// install / uninstall
// ---------------------------------------------------------------------------

function cmdInstall(name, options, rawFlagArgv, ctx) {
  const { dotfilesRoot, env, stdout } = ctx;

  if (!options.every) throw usageError('yoki-loop install: --every is required (e.g. 30m, 1h)');
  const intervalSeconds = plist.parseInterval(options.every);

  const home = env.HOME || os.homedir();
  const binPath = path.join(dotfilesRoot, 'domains', 'dev', 'bin', 'yoki-loop');
  const loopDir = state.loopDir(name, env);
  const stdoutPath = path.join(loopDir, 'stdout.log');
  const stderrPath = path.join(loopDir, 'stderr.log');

  const programArguments = [process.execPath, binPath, 'run', name, ...withoutEveryFlag(rawFlagArgv)];

  const xml = plist.buildPlistXml({
    name,
    programArguments,
    intervalSeconds,
    stdoutPath,
    stderrPath,
    // YOKI_UNATTENDED=1 belongs in the plist as well as in runner.js's own
    // child env (see runner.childEnv): launchd starts `yoki-loop run` with a
    // near-empty environment, and the flag has to be true for the RUNNER
    // process too — not just its harness child — so any hook or guard the
    // runner itself triggers sees an unattended run.
    env: {
      PATH: env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: home,
      YOKI_UNATTENDED: '1',
    },
  });

  const filePath = plist.plistPath(name, home);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.mkdirSync(loopDir, { recursive: true });
  fs.writeFileSync(filePath, xml, 'utf8');

  stdout.write(`yoki-loop: wrote ${filePath}\n`);
  stdout.write(`${plist.bootstrapCommand(process.getuid ? process.getuid() : '$UID', filePath)}\n`);
  return 0;
}

function cmdUninstall(name, ctx) {
  const { env, stdout } = ctx;
  const home = env.HOME || os.homedir();
  const filePath = plist.plistPath(name, home);

  if (!fs.existsSync(filePath)) {
    stdout.write(`yoki-loop: ${filePath} not found — nothing to uninstall\n`);
    return 0;
  }

  stdout.write(`${plist.bootoutCommand(process.getuid ? process.getuid() : '$UID', filePath)}\n`);
  fs.rmSync(filePath);
  stdout.write(`yoki-loop: removed ${filePath}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// status / list
// ---------------------------------------------------------------------------

function installedLoopNames(env) {
  const home = env.HOME || os.homedir();
  const dir = path.join(home, ...LAUNCH_AGENTS_DIR_SEGMENTS);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.startsWith(`${plist.label('')}`) && f.endsWith('.plist'))
    .map((f) => f.slice(plist.label('').length, -'.plist'.length))
    .sort();
}

function estimateNextFire(name, env, now) {
  const home = env.HOME || os.homedir();
  const filePath = plist.plistPath(name, home);
  let intervalSeconds = null;
  let mtimeMs = null;
  try {
    const xml = fs.readFileSync(filePath, 'utf8');
    intervalSeconds = plist.readStartIntervalSeconds(xml);
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
  if (!intervalSeconds) return null;

  const runs = state.readRuns(name, env);
  const lastRun = runs.length > 0 ? runs[runs.length - 1] : null;
  const baseMs = lastRun && typeof lastRun.ts === 'string' ? Date.parse(lastRun.ts) : mtimeMs;
  if (!Number.isFinite(baseMs)) return null;

  let next = baseMs + intervalSeconds * 1000;
  const nowMs = now.getTime();
  while (next <= nowMs) next += intervalSeconds * 1000;
  return new Date(next);
}

function printStatusFor(name, ctx) {
  const { env, stdout, now } = ctx;
  const runs = state.readRuns(name, env);
  const recent = runs.slice(-STATUS_RUN_LIMIT);

  stdout.write(`${name}:\n`);
  if (recent.length === 0) {
    stdout.write('  no runs recorded\n');
  } else {
    for (const row of recent) {
      stdout.write(`  ${row.ts} ${row.harness} exit=${row.exit} ${row.durationMs}ms session=${row.sessionId || '-'}\n`);
      // The recorded argv, prompt already fingerprinted by the runner (see
      // state.promptPlaceholder) — status shows the placeholder, never the
      // prompt, because the log itself never held the prompt.
      const argv = Array.isArray(row.cmd) ? row.cmd : [];
      const stdinNote = row.prompt && !argv.includes(row.prompt) ? ` <stdin ${row.prompt}>` : '';
      if (argv.length) stdout.write(`    ${argv.join(' ')}${stdinNote}\n`);
    }
  }

  const next = estimateNextFire(name, env, now());
  stdout.write(`  next fire (estimated): ${next ? next.toISOString() : 'unknown (not installed, or no StartInterval)'}\n`);
}

function cmdStatus(name, ctx) {
  const names = name ? [name] : installedLoopNames(ctx.env);
  if (names.length === 0) {
    ctx.stdout.write('yoki-loop: no installed loops\n');
    return 0;
  }
  for (const n of names) printStatusFor(n, ctx);
  return 0;
}

function cmdList(ctx) {
  const names = installedLoopNames(ctx.env);
  if (names.length === 0) {
    ctx.stdout.write('yoki-loop: no installed loops\n');
    return 0;
  }
  for (const n of names) ctx.stdout.write(`${n}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// entrypoint
// ---------------------------------------------------------------------------

/**
 * @param {string[]} argv `process.argv.slice(2)`
 * @param {object} [ctx]
 * @param {string} [ctx.dotfilesRoot] repo root (default: resolved from this
 *   file's own location)
 * @param {NodeJS.ProcessEnv} [ctx.env]
 * @param {{write: (s: string) => void}} [ctx.stdout]
 * @param {{write: (s: string) => void}} [ctx.stderr]
 * @param {() => Date} [ctx.now]
 * @returns {number} process exit code
 */
function main(argv, ctx = {}) {
  const context = {
    dotfilesRoot: ctx.dotfilesRoot || path.resolve(__dirname, '..', '..', '..', '..', '..', '..', '..', '..', '..'),
    env: ctx.env || process.env,
    stdout: ctx.stdout || process.stdout,
    stderr: ctx.stderr || process.stderr,
    now: ctx.now || (() => new Date()),
  };

  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    context.stderr.write(`${err.message}\n`);
    return 2;
  }

  try {
    switch (parsed.command) {
      case 'run':
        return cmdRun(parsed.name, parsed.options, context);
      case 'install':
        return cmdInstall(parsed.name, parsed.options, parsed.rawFlagArgv, context);
      case 'uninstall':
        return cmdUninstall(parsed.name, context);
      case 'status':
        return cmdStatus(parsed.name, context);
      case 'list':
        return cmdList(context);
      default:
        return 2;
    }
  } catch (err) {
    context.stderr.write(`${err.message}\n`);
    return err.isUsageError ? 2 : 1;
  }
}

module.exports = {
  main,
  parseArgs,
  withoutEveryFlag,
  resolvePrompt,
  installedLoopNames,
  estimateNextFire,
};
