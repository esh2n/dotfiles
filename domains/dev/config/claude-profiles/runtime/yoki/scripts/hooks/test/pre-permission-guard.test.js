'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hook = require('../pre-permission-guard.js');

/** Sets env vars for the duration of `fn`, restoring (or deleting) each one
 * afterwards — YOKI_HARNESS plus the per-harness dir vars the hook resolves
 * its permissions.json from. */
function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    process.env[key] = vars[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function withClaudeDir(claudeDir, fn) {
  return withEnv({ CLAUDE_DIR: claudeDir }, fn);
}

function writePermissions(claudeDir, denyEntries) {
  const dir = path.join(claudeDir, '.yoki');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'permissions.json'), JSON.stringify({ deny: denyEntries }), 'utf8');
}

function freshClaudeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-permission-guard-'));
}

function payload(toolName, toolInput) {
  return JSON.stringify({ tool_name: toolName, tool_input: toolInput });
}

function isDeny(result, pattern) {
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(parsed.hookSpecificOutput.permissionDecisionReason, `yoki permission-guard: ${pattern}`);
}

function isPassthrough(result, raw) {
  assert.equal(result, raw);
}

test('Bash: a trailing-glob deny pattern (rm -rf /*) blocks the literal command', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Bash(rm -rf /*)', reason: 'wildcard' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Bash', { command: 'rm -rf /*' });
    isDeny(hook.run(raw), 'Bash(rm -rf /*)');
  });
});

// The whole point of the pattern: a trailing '*' glued to the last token is a
// PREFIX wildcard. Read as an exact match it fired on nothing real, and since
// to-codex.js cannot express these as execpolicy tokens, this hook is their
// only enforcement point on Codex and omp.
test('Bash: rm -rf /* blocks a real destructive command under / (prefix wildcard)', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Bash(rm -rf /*)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Bash', { command: 'rm -rf /etc/foo' })), 'Bash(rm -rf /*)');
  });
});

test('Bash: > /dev/* blocks a raw device redirect', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Bash(> /dev/*)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Bash', { command: '> /dev/sda' })), 'Bash(> /dev/*)');
  });
});

test('Bash: rm -rf ~/* blocks a home-directory wipe', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Bash(rm -rf ~/*)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Bash', { command: 'rm -rf ~/x' })), 'Bash(rm -rf ~/*)');
  });
});

test('Bash: a trailing-glob pattern still does not match a command outside its prefix', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Bash(rm -rf /*)' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Bash', { command: 'rm -rf ./build' });
    isPassthrough(hook.run(raw), raw);
  });
});

test('Bash: a prefix pattern (ending " *") blocks the bare command and any trailing args', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Bash(git reset --hard *)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Bash', { command: 'git reset --hard' })), 'Bash(git reset --hard *)');
    isDeny(hook.run(payload('Bash', { command: 'git reset --hard HEAD~1' })), 'Bash(git reset --hard *)');
  });
});

test('Bash: a prefix pattern does not match a command that only shares a text prefix', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Bash(git reset --hard *)' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Bash', { command: 'git reset --hardcoded-thing' });
    isPassthrough(hook.run(raw), raw);
  });
});

test('Edit: a double-star extension glob (**/*.pem) blocks a nested path', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Edit(**/*.pem)', reason: 'secret' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Edit', { file_path: '/repo/certs/server.pem' });
    isDeny(hook.run(raw), 'Edit(**/*.pem)');
  });
});

test('Edit: the same glob also blocks a top-level file with no directory', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Edit(**/*.pem)' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Edit', { file_path: 'server.pem' });
    isDeny(hook.run(raw), 'Edit(**/*.pem)');
  });
});

test('Edit: Edit(**/.env) blocks .env but not .env.local', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Edit(**/.env)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Edit', { file_path: '/repo/.env' })), 'Edit(**/.env)');
    const raw = payload('Edit', { file_path: '/repo/.env.local' });
    isPassthrough(hook.run(raw), raw);
  });
});

test('Write and MultiEdit tool names are also matched against Edit(...) deny patterns', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Edit(**/*.key)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Write', { file_path: '/repo/id.key' })), 'Edit(**/*.key)');
    isDeny(hook.run(payload('MultiEdit', { file_path: '/repo/id.key', edits: [] })), 'Edit(**/*.key)');
  });
});

test('a non-matching file passes through untouched', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Edit(**/*.pem)' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Edit', { file_path: '/repo/src/index.js' });
    isPassthrough(hook.run(raw), raw);
  });
});

// Claude's own grouping: an Edit(...) rule gates the WRITE-side tools only.
// A Read of a path an Edit pattern names is not what that pattern denies —
// the read side has its own Read(...) rows.
test('a Read is not matched against an Edit(...) deny pattern', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Edit(**/*.pem)' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Read', { file_path: '/repo/server.pem' });
    isPassthrough(hook.run(raw), raw);
  });
});

// ---------------------------------------------------------------------------
// Read(...) / WebFetch(domain:...) patterns. On Claude these are defense in
// depth over Claude's own permission match; on omp and codex the guard is
// their ONLY enforcement point, which is why the hook gates the read side at
// all (it used to return early for every tool but Bash/Write/Edit/MultiEdit).
// ---------------------------------------------------------------------------

test('Read: a Read(...) deny blocks the Read tool', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Read(**/*.pem)', reason: 'secret' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Read', { file_path: '/repo/certs/server.pem' })), 'Read(**/*.pem)');
  });
});

test('Read: Glob, Grep and LS are gated by the same Read(...) pattern', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Read(**/*.key)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Glob', { path: '/repo/id.key' })), 'Read(**/*.key)');
    isDeny(hook.run(payload('Grep', { path: '/repo/id.key', pattern: 'BEGIN' })), 'Read(**/*.key)');
    isDeny(hook.run(payload('LS', { path: '/repo/id.key' })), 'Read(**/*.key)');
  });
});

test('Read: an Edit/Write call is NOT matched against a Read(...) pattern', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Read(**/*.pem)' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Write', { file_path: '/repo/server.pem' });
    isPassthrough(hook.run(raw), raw);
  });
});

test('WebFetch: domain:<host> is matched against the URL host, not the whole URL', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'WebFetch(domain:evil.example)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('WebFetch', { url: 'https://evil.example/page' })), 'WebFetch(domain:evil.example)');

    // The host appearing anywhere else in the URL is not the host.
    const raw = payload('WebFetch', { url: 'https://ok.example/?ref=evil.example' });
    isPassthrough(hook.run(raw), raw);
  });
});

test('WebFetch: a wildcard host matches a subdomain, and an unparseable URL matches nothing', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'WebFetch(domain:*.internal.example)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('WebFetch', { url: 'https://wiki.internal.example/x' })), 'WebFetch(domain:*.internal.example)');
    const raw = payload('WebFetch', { url: 'not a url' });
    isPassthrough(hook.run(raw), raw);
  });
});

test('matchDomain: host-only comparison, wildcards allowed, junk URLs never match', () => {
  assert.equal(hook.matchDomain('domain:example.com', 'https://example.com/a/b'), true);
  assert.equal(hook.matchDomain('domain:example.com', 'https://sub.example.com/'), false);
  assert.equal(hook.matchDomain('domain:*', 'https://anything.test/'), true);
  assert.equal(hook.matchDomain('domain:example.com', ''), false);
  assert.equal(hook.matchDomain('example.com', 'https://example.com/'), false); // not a domain: pattern
});

// ---------------------------------------------------------------------------
// Per-harness permissions.json. The hook-tagged subset is all Claude Code
// needs (it enforces every other pattern itself), but omp has no declarative
// path permission list at all and codex expresses only the READ side of the
// secret paths — so each harness gets its own file, and the hook has to read
// the one belonging to the harness it is running under.
// ---------------------------------------------------------------------------

test('resolvePermissionsFile: one path per harness, each overridable by its dir env var', () => {
  assert.equal(
    hook.resolvePermissionsFile({ YOKI_HARNESS: 'omp', OMP_AGENT_DIR: '/tmp/omp-agent' }),
    path.join('/tmp/omp-agent', '.yoki', 'permissions.json')
  );
  assert.equal(
    hook.resolvePermissionsFile({ YOKI_HARNESS: 'codex', CODEX_DIR: '/tmp/codex' }),
    path.join('/tmp/codex', '.yoki', 'permissions.json')
  );
  assert.equal(
    hook.resolvePermissionsFile({ CLAUDE_DIR: '/tmp/claude' }),
    path.join('/tmp/claude', '.yoki', 'permissions.json')
  );
  // Unknown harness -> the Claude path, never "no file": the hook-tagged
  // subset is correct on every harness.
  assert.equal(
    hook.resolvePermissionsFile({ YOKI_HARNESS: 'something-new', CLAUDE_DIR: '/tmp/claude' }),
    path.join('/tmp/claude', '.yoki', 'permissions.json')
  );
  assert.equal(hook.resolvePermissionsFile({ YOKI_HARNESS: 'omp' }), path.join(os.homedir(), '.omp', 'agent', '.yoki', 'permissions.json'));
});

test('omp: a Read of ~/.ssh/id_ed25519 is denied from the omp permissions file', () => {
  const ompDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-permission-guard-omp-'));
  writePermissions(ompDir, [{ pattern: 'Read(~/.ssh/id_*)', reason: 'private keys' }]);
  // Claude's own file deliberately does NOT carry this row — that is the
  // whole point: under YOKI_HARNESS=omp the hook must read omp's file.
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, []);

  withEnv({ YOKI_HARNESS: 'omp', OMP_AGENT_DIR: ompDir, CLAUDE_DIR: claudeDir }, () => {
    const keyPath = path.join(os.homedir(), '.ssh', 'id_ed25519');
    isDeny(hook.run(payload('Read', { path: keyPath })), 'Read(~/.ssh/id_*)');
  });
});

test('omp: the same Read passes through when only Claude\'s file carries the deny', () => {
  const ompDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-permission-guard-omp-'));
  writePermissions(ompDir, []);
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Read(~/.ssh/id_*)' }]);

  withEnv({ YOKI_HARNESS: 'omp', OMP_AGENT_DIR: ompDir, CLAUDE_DIR: claudeDir }, () => {
    const raw = payload('Read', { path: path.join(os.homedir(), '.ssh', 'id_ed25519') });
    isPassthrough(hook.run(raw), raw);
  });
});

test('omp: a WebFetch domain deny in the omp file is enforced', () => {
  const ompDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-permission-guard-omp-'));
  writePermissions(ompDir, [{ pattern: 'WebFetch(domain:secrets.example)' }]);
  withEnv({ YOKI_HARNESS: 'omp', OMP_AGENT_DIR: ompDir }, () => {
    isDeny(hook.run(payload('WebFetch', { url: 'https://secrets.example/dump' })), 'WebFetch(domain:secrets.example)');
  });
});

test('omp: Bash matching is unaffected by the harness switch', () => {
  const ompDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-permission-guard-omp-'));
  writePermissions(ompDir, [{ pattern: 'Bash(rm -rf /*)' }]);
  withEnv({ YOKI_HARNESS: 'omp', OMP_AGENT_DIR: ompDir }, () => {
    isDeny(hook.run(payload('Bash', { command: 'rm -rf /etc/foo' })), 'Bash(rm -rf /*)');
    const raw = payload('Bash', { command: 'rm -rf ./build' });
    isPassthrough(hook.run(raw), raw);
  });
});

test('codex: the deny list comes from CODEX_DIR', () => {
  const codexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoki-permission-guard-codex-'));
  writePermissions(codexDir, [{ pattern: 'Edit(~/.ssh/id_*)', reason: 'write side' }]);
  withEnv({ YOKI_HARNESS: 'codex', CODEX_DIR: codexDir }, () => {
    isDeny(
      hook.run(payload('Write', { file_path: path.join(os.homedir(), '.ssh', 'id_ed25519') })),
      'Edit(~/.ssh/id_*)'
    );
  });
});

test('a missing permissions.json fails open (passthrough), not an exception', () => {
  const claudeDir = freshClaudeDir(); // no .yoki/permissions.json written
  withClaudeDir(claudeDir, () => {
    const raw = payload('Bash', { command: 'rm -rf /*' });
    assert.doesNotThrow(() => isPassthrough(hook.run(raw), raw));
  });
});

test('a malformed permissions.json fails open', () => {
  const claudeDir = freshClaudeDir();
  fs.mkdirSync(path.join(claudeDir, '.yoki'), { recursive: true });
  fs.writeFileSync(path.join(claudeDir, '.yoki', 'permissions.json'), '{not json', 'utf8');
  withClaudeDir(claudeDir, () => {
    const raw = payload('Bash', { command: 'rm -rf /*' });
    assert.doesNotThrow(() => isPassthrough(hook.run(raw), raw));
  });
});

test('malformed stdin (not JSON) passes through unchanged', () => {
  const result = hook.run('not json at all');
  assert.equal(result, 'not json at all');
});

test('matchBash: a trailing "*" glued to the last token is a prefix wildcard', () => {
  assert.equal(hook.matchBash('rm -rf ~/*', 'rm -rf ~/*'), true);
  assert.equal(hook.matchBash('rm -rf ~/*', 'rm -rf ~/foo'), true);
  assert.equal(hook.matchBash('rm -rf ~/*', 'rm -rf /foo'), false);
  assert.equal(hook.matchBash('rm -rf /*', 'rm -rf /etc/foo'), true);
  assert.equal(hook.matchBash('> /dev/*', '> /dev/sda'), true);
  assert.equal(hook.matchBash('>> /dev/*', '>> /dev/null'), true);
});

test('matchBash: " *" keeps word-boundary semantics (a prefix star is not a bare prefix)', () => {
  assert.equal(hook.matchBash('git push *', 'git push'), true);
  assert.equal(hook.matchBash('git push *', 'git push --force'), true);
  assert.equal(hook.matchBash('git push *', 'git pushx'), false);
});

test('matchBash: a pattern with no trailing star stays an exact match', () => {
  assert.equal(hook.matchBash('shutdown now', 'shutdown now'), true);
  assert.equal(hook.matchBash('shutdown now', 'shutdown now -h'), false);
});

test('globToRegExp: "**/" matches zero or more directories', () => {
  const re = hook.globToRegExp('**/*.pem');
  assert.ok(re.test('a.pem'));
  assert.ok(re.test('a/b/c.pem'));
  assert.ok(!re.test('a.key'));
});

// ---------------------------------------------------------------------------
// Read-shaped Bash commands (Gap B). On Codex a file read shells out as
// `cat`/`sed`/… (no dedicated read tool — scratchpad/codex-read-tool-spike.md),
// so a Read(glob) deny is enforced by parsing the command's path arguments.
// ---------------------------------------------------------------------------

test('readCommandPaths: extracts the file argument of a read-shaped command', () => {
  assert.deepEqual(hook.readCommandPaths('cat x.txt'), ['x.txt']);
  assert.deepEqual(hook.readCommandPaths("sed -n '1,200p' ./x.txt"), ['1,200p', './x.txt']);
  assert.deepEqual(hook.readCommandPaths('head -n 5 a.txt'), ['5', 'a.txt']);
});

test('readCommandPaths: splits a pipeline/list and only reads from read commands', () => {
  // pwd + rg are not read commands here; only the sed segment yields a path.
  assert.deepEqual(hook.readCommandPaths('pwd && rg --files | sed -n 1,10p package.json'), ['1,10p', 'package.json']);
  assert.deepEqual(hook.readCommandPaths('echo hi'), []);
  assert.deepEqual(hook.readCommandPaths(''), []);
  assert.deepEqual(hook.readCommandPaths(undefined), []);
});

test('readCommandPaths: expands a leading ~/ to the home dir', () => {
  assert.deepEqual(hook.readCommandPaths('cat ~/.ssh/known_hosts'), [path.join(os.homedir(), '.ssh/known_hosts')]);
});

test('Bash read of a denied path (cat .env) is blocked by a Read(**) glob', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Read(**/.env)', reason: 'env files' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Bash', { command: 'cat .env' })), 'Read(**/.env)');
    isDeny(hook.run(payload('Bash', { command: 'sed -n 1,5p ./.env' })), 'Read(**/.env)');
  });
});

test('Bash read of a denied secret file (cat server.pem) is blocked', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Read(**/*.pem)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Bash', { command: 'cat certs/server.pem' })), 'Read(**/*.pem)');
  });
});

test('Bash read of a ~/-rooted denied path is blocked (token ~ expanded)', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Read(~/.ssh/*_ed25519)' }]);
  withClaudeDir(claudeDir, () => {
    isDeny(hook.run(payload('Bash', { command: 'cat ~/.ssh/id_ed25519' })), 'Read(~/.ssh/*_ed25519)');
  });
});

test('Bash command that reads nothing denied is passed through', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Read(**/.env)' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Bash', { command: 'cat README.md' });
    isPassthrough(hook.run(raw), raw);
    // A non-read command touching a denied name is not a read -> not blocked here.
    const raw2 = payload('Bash', { command: 'ls -la .env' });
    isPassthrough(hook.run(raw2), raw2);
  });
});

test('Bash read deny does not fire when only Edit(...) patterns are configured', () => {
  const claudeDir = freshClaudeDir();
  writePermissions(claudeDir, [{ pattern: 'Edit(**/.env)' }]);
  withClaudeDir(claudeDir, () => {
    const raw = payload('Bash', { command: 'cat .env' });
    isPassthrough(hook.run(raw), raw);
  });
});

test('codex harness: a shell read of ~/.ssh/id_ed25519 is blocked via CODEX_DIR permissions', () => {
  // End state of the Gap B follow-up: to-codex.js now unions the ~-rooted
  // Read denies (previously [permissions.yoki.filesystem]-only) into
  // guardDeny, so the hook is the layer that still enforces them when the
  // native table is off (--dangerously-bypass-approvals-and-sandbox) and for
  // shell reads, which that table never gated.
  const codexDir = freshClaudeDir();
  writePermissions(codexDir, [{ pattern: 'Read(~/.ssh/id_*)', reason: 'private keys' }]);
  withEnv({ YOKI_HARNESS: 'codex', CODEX_DIR: codexDir }, () => {
    isDeny(hook.run(payload('Bash', { command: 'cat ~/.ssh/id_ed25519' })), 'Read(~/.ssh/id_*)');
    isDeny(hook.run(payload('Bash', { command: `cat ${path.join(os.homedir(), '.ssh/id_ed25519')}` })), 'Read(~/.ssh/id_*)');
    // A non-secret read under the same harness still passes.
    const raw = payload('Bash', { command: 'cat ~/.ssh/known_hosts' });
    isPassthrough(hook.run(raw), raw);
  });
});
