'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cli = require('../cli');
const plist = require('../plist');
const state = require('../state');

function withTempHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-loop-cli-'));
  try {
    return fn({ HOME: home });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function withTempDotfilesRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-loop-cli-root-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function makeIO() {
  const out = [];
  const err = [];
  return {
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
    out,
    err,
  };
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test('parseArgs: run <name> with flags', () => {
  const parsed = cli.parseArgs(['run', 'demo', '--harness', 'codex', '--cwd', '.', '--prompt', 'hi']);
  assert.equal(parsed.command, 'run');
  assert.equal(parsed.name, 'demo');
  assert.equal(parsed.options.harness, 'codex');
  assert.equal(parsed.options.cwd, '.');
  assert.equal(parsed.options.prompt, 'hi');
});

test('parseArgs: install <name> --every plus run flags, preserved verbatim in rawFlagArgv', () => {
  const argv = ['install', 'demo', '--harness', 'omp', '--cwd', '.', '--prompt', 'do it', '--every', '30m'];
  const parsed = cli.parseArgs(argv);
  assert.equal(parsed.command, 'install');
  assert.deepEqual(parsed.rawFlagArgv, argv.slice(2));
  assert.equal(parsed.options.every, '30m');
});

test('parseArgs: status with no name', () => {
  assert.deepEqual(cli.parseArgs(['status']), { command: 'status', name: null, options: {}, rawFlagArgv: [] });
});

test('parseArgs: status <name>', () => {
  const parsed = cli.parseArgs(['status', 'demo']);
  assert.equal(parsed.name, 'demo');
});

test('parseArgs: list takes no positionals', () => {
  assert.deepEqual(cli.parseArgs(['list']), { command: 'list', name: null, options: {}, rawFlagArgv: [] });
});

test('parseArgs: missing command throws a usage error', () => {
  assert.throws(() => cli.parseArgs([]), /missing command/);
});

test('parseArgs: unknown command throws', () => {
  assert.throws(() => cli.parseArgs(['fly']), /unknown command/);
});

test('parseArgs: run with no name throws', () => {
  assert.throws(() => cli.parseArgs(['run']), /missing <name>/);
});

test('parseArgs: unrecognized flag throws', () => {
  assert.throws(() => cli.parseArgs(['run', 'demo', '--bogus']), /unrecognized flag/);
});

// ---------------------------------------------------------------------------
// withoutEveryFlag
// ---------------------------------------------------------------------------

test('withoutEveryFlag: drops --every and its value, keeps order of the rest', () => {
  const out = cli.withoutEveryFlag(['--harness', 'codex', '--every', '30m', '--cwd', '.']);
  assert.deepEqual(out, ['--harness', 'codex', '--cwd', '.']);
});

test('withoutEveryFlag: no-op when --every is absent', () => {
  const out = cli.withoutEveryFlag(['--harness', 'codex', '--cwd', '.']);
  assert.deepEqual(out, ['--harness', 'codex', '--cwd', '.']);
});

// ---------------------------------------------------------------------------
// resolvePrompt
// ---------------------------------------------------------------------------

test('resolvePrompt: --prompt is used verbatim', () => {
  assert.equal(cli.resolvePrompt({ prompt: 'hi there' }, {}), 'hi there');
});

test('resolvePrompt: --prompt-file reads the file', () => {
  withTempDotfilesRoot((dir) => {
    const file = path.join(dir, 'p.txt');
    fs.writeFileSync(file, 'from a file\n');
    assert.equal(cli.resolvePrompt({ promptFile: file }, {}), 'from a file\n');
  });
});

test('resolvePrompt: throws when no prompt source is given', () => {
  assert.throws(() => cli.resolvePrompt({}, {}), /one of --prompt/);
});

test('resolvePrompt: throws when more than one prompt source is given', () => {
  assert.throws(() => cli.resolvePrompt({ prompt: 'a', promptFile: 'b' }, {}), /mutually exclusive/);
});

// ---------------------------------------------------------------------------
// main: run (dry-run only — no real agent invocation)
// ---------------------------------------------------------------------------

test('main: run --dry-run prints argv and exits 0', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const io = makeIO();
      const code = cli.main(['run', 'demo', '--harness', 'codex', '--cwd', '.', '--prompt', 'hi', '--dry-run'], {
        dotfilesRoot,
        env,
        stdout: io.stdout,
        stderr: io.stderr,
      });
      assert.equal(code, 0);
      assert.match(io.out.join(''), /^codex exec /);
      assert.deepEqual(state.readRuns('demo', env), []);
    });
  });
});

test('main: --sandbox reaches the built codex argv (the unattended-inbox lockdown)', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const io = makeIO();
      const code = cli.main(
        ['run', 'demo', '--harness', 'codex', '--cwd', '.', '--prompt', 'hi', '--sandbox', 'read-only', '--dry-run'],
        { dotfilesRoot, env, stdout: io.stdout, stderr: io.stderr }
      );
      assert.equal(code, 0);
      assert.match(io.out.join(''), /-s read-only/);
      assert.doesNotMatch(io.out.join(''), /workspace-write/);
    });
  });
});

test('main: an unknown --sandbox value fails the run instead of widening it', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const io = makeIO();
      const code = cli.main(
        ['run', 'demo', '--harness', 'codex', '--cwd', '.', '--prompt', 'hi', '--sandbox', 'yolo', '--dry-run'],
        { dotfilesRoot, env, stdout: io.stdout, stderr: io.stderr }
      );
      assert.notEqual(code, 0);
      assert.match(io.err.join(''), /unknown --sandbox "yolo"/);
    });
  });
});

test('main: install forwards --sandbox verbatim into the plist ProgramArguments', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const io = makeIO();
      const code = cli.main(
        ['install', 'demo', '--harness', 'codex', '--cwd', '/repo', '--prompt-from-artifact-inbox',
          '--sandbox', 'read-only', '--every', '30m'],
        { dotfilesRoot, env, stdout: io.stdout, stderr: io.stderr }
      );
      assert.equal(code, 0);
      const xml = fs.readFileSync(plist.plistPath('demo', env.HOME), 'utf8');
      assert.match(xml, /<string>--sandbox<\/string>/);
      assert.match(xml, /<string>read-only<\/string>/);
    });
  });
});

test('main: run with a missing --harness is a usage error (exit 2)', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const io = makeIO();
      const code = cli.main(['run', 'demo', '--cwd', '.', '--prompt', 'hi', '--dry-run'], {
        dotfilesRoot,
        env,
        stdout: io.stdout,
        stderr: io.stderr,
      });
      assert.equal(code, 2);
      assert.match(io.err.join(''), /--harness must be one of/);
    });
  });
});

test('main: --prompt-from-artifact-inbox with nothing unread skips the run (exit 0, no error)', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const io = makeIO();
      const code = cli.main(
        ['run', 'demo', '--harness', 'claude', '--cwd', '.', '--prompt-from-artifact-inbox', '--dry-run'],
        { dotfilesRoot, env, stdout: io.stdout, stderr: io.stderr }
      );
      assert.equal(code, 0);
      assert.match(io.out.join(''), /nothing unread/);
    });
  });
});

// ---------------------------------------------------------------------------
// main: install / uninstall / status / list
// ---------------------------------------------------------------------------

test('main: install writes a plist and prints the bootstrap command, never runs launchctl', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const io = makeIO();
      const code = cli.main(
        ['install', 'demo', '--harness', 'codex', '--cwd', '.', '--prompt', 'hi', '--every', '30m'],
        { dotfilesRoot, env, stdout: io.stdout, stderr: io.stderr }
      );
      assert.equal(code, 0);

      const filePath = plist.plistPath('demo', env.HOME);
      assert.ok(fs.existsSync(filePath));
      const xml = fs.readFileSync(filePath, 'utf8');
      assert.equal(plist.readStartIntervalSeconds(xml), 1800);
      assert.doesNotMatch(xml, /--every/);
      assert.match(xml, /<string>run<\/string>/);
      assert.match(xml, /<string>demo<\/string>/);

      assert.match(io.out.join(''), /launchctl bootstrap gui\//);
    });
  });
});

test('main: install puts YOKI_UNATTENDED=1 in the plist EnvironmentVariables', () => {
  // launchd hands the job a near-empty environment, so the flag that arms
  // hooks/unattended-guard.sh has to be written into the plist itself —
  // otherwise the guard is inert for exactly the runs it exists for.
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const io = makeIO();
      cli.main(
        ['install', 'demo', '--harness', 'codex', '--cwd', '.', '--prompt', 'hi', '--every', '30m'],
        { dotfilesRoot, env, stdout: io.stdout, stderr: io.stderr }
      );
      const xml = fs.readFileSync(plist.plistPath('demo', env.HOME), 'utf8');
      assert.match(
        xml,
        /<key>EnvironmentVariables<\/key>[\s\S]*<key>YOKI_UNATTENDED<\/key>\s*<string>1<\/string>/
      );
      // PATH/HOME are still there — the flag is added, not substituted for them.
      assert.match(xml, /<key>PATH<\/key>/);
      assert.match(xml, /<key>HOME<\/key>/);
    });
  });
});

test('main: install requires --every', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const io = makeIO();
      const code = cli.main(['install', 'demo', '--harness', 'codex', '--cwd', '.', '--prompt', 'hi'], {
        dotfilesRoot,
        env,
        stdout: io.stdout,
        stderr: io.stderr,
      });
      assert.equal(code, 2);
      assert.match(io.err.join(''), /--every is required/);
    });
  });
});

test('main: uninstall removes the plist and prints the bootout command', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const io = makeIO();
      cli.main(['install', 'demo', '--harness', 'codex', '--cwd', '.', '--prompt', 'hi', '--every', '30m'], {
        dotfilesRoot,
        env,
        stdout: io.stdout,
        stderr: io.stderr,
      });
      const filePath = plist.plistPath('demo', env.HOME);
      assert.ok(fs.existsSync(filePath));

      const io2 = makeIO();
      const code = cli.main(['uninstall', 'demo'], { dotfilesRoot, env, stdout: io2.stdout, stderr: io2.stderr });
      assert.equal(code, 0);
      assert.ok(!fs.existsSync(filePath));
      assert.match(io2.out.join(''), /launchctl bootout gui\//);
    });
  });
});

test('main: uninstall on a name with no plist is a no-op, not an error', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      const io = makeIO();
      const code = cli.main(['uninstall', 'never-installed'], { dotfilesRoot, env, stdout: io.stdout, stderr: io.stderr });
      assert.equal(code, 0);
      assert.match(io.out.join(''), /not found/);
    });
  });
});

test('main: list reports installed loop names', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      cli.main(['install', 'alpha', '--harness', 'claude', '--cwd', '.', '--prompt', 'a', '--every', '1h'], {
        dotfilesRoot,
        env,
        stdout: makeIO().stdout,
        stderr: makeIO().stderr,
      });
      const io = makeIO();
      const code = cli.main(['list'], { dotfilesRoot, env, stdout: io.stdout, stderr: io.stderr });
      assert.equal(code, 0);
      assert.match(io.out.join(''), /alpha/);
    });
  });
});

test('main: status <name> reports run history and an estimated next fire time', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      cli.main(['install', 'demo', '--harness', 'claude', '--cwd', '.', '--prompt', 'a', '--every', '30m'], {
        dotfilesRoot,
        env,
        stdout: makeIO().stdout,
        stderr: makeIO().stderr,
      });
      state.appendRun(
        'demo',
        { ts: '2026-01-01T00:00:00.000Z', harness: 'claude', cmd: ['claude'], exit: 0, durationMs: 5, sessionId: 's1' },
        env
      );

      const io = makeIO();
      const code = cli.main(['status', 'demo'], { dotfilesRoot, env, stdout: io.stdout, stderr: io.stderr });
      assert.equal(code, 0);
      const text = io.out.join('');
      assert.match(text, /s1/);
      assert.match(text, /next fire \(estimated\):/);
    });
  });
});

test('main: status shows the prompt fingerprint the runner recorded, never the prompt', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      cli.main(['install', 'demo', '--harness', 'claude', '--cwd', '.', '--prompt', 'a', '--every', '30m'], {
        dotfilesRoot,
        env,
        stdout: makeIO().stdout,
        stderr: makeIO().stderr,
      });
      const prompt = 'sweep acme-corp/billing for stale credentials';
      const placeholder = state.promptPlaceholder(prompt);
      // Exactly the row shape runner.run writes.
      state.appendRun(
        'demo',
        {
          ts: '2026-01-01T00:00:00.000Z',
          harness: 'claude',
          cmd: state.redactPromptArgv(['claude', '-p', prompt, '--output-format', 'json'], prompt),
          prompt: placeholder,
          exit: 0,
          durationMs: 5,
          sessionId: 's1',
        },
        env
      );

      const io = makeIO();
      assert.equal(cli.main(['status', 'demo'], { dotfilesRoot, env, stdout: io.stdout, stderr: io.stderr }), 0);
      const text = io.out.join('');
      assert.ok(text.includes(placeholder), 'status must show the placeholder');
      assert.ok(!text.includes('acme-corp'), 'status must not show the prompt');
      // The rest of the argv is still there to read.
      assert.match(text, /claude -p .* --output-format json/);
    });
  });
});

test('main: status notes a codex stdin prompt, whose argv carries no prompt token', () => {
  withTempHome((env) => {
    withTempDotfilesRoot((dotfilesRoot) => {
      cli.main(['install', 'demo', '--harness', 'codex', '--cwd', '.', '--prompt', 'a', '--every', '30m'], {
        dotfilesRoot,
        env,
        stdout: makeIO().stdout,
        stderr: makeIO().stderr,
      });
      const placeholder = state.promptPlaceholder('sweep acme-corp/billing');
      state.appendRun(
        'demo',
        {
          ts: '2026-01-01T00:00:00.000Z',
          harness: 'codex',
          cmd: ['codex', 'exec', '--skip-git-repo-check', '-C', '.', '-s', 'read-only', '--json', '-'],
          prompt: placeholder,
          exit: 0,
          durationMs: 5,
          sessionId: 's1',
        },
        env
      );

      const io = makeIO();
      cli.main(['status', 'demo'], { dotfilesRoot, env, stdout: io.stdout, stderr: io.stderr });
      const text = io.out.join('');
      assert.ok(text.includes(`<stdin ${placeholder}>`));
      assert.ok(!text.includes('acme-corp'));
    });
  });
});
