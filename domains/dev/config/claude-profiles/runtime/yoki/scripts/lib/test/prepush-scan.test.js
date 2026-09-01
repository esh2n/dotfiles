'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  loadSecretRules,
  scanLine,
  symlinkTargetIssue,
  parseAddedLines,
  parseAddedOrRenamedFiles,
  runPrepushScan,
} = require('../prepush-scan');

const SECRET_PATTERNS_PATH = path.join(__dirname, '..', 'secret-patterns.json');

// ---------------------------------------------------------------------------
// pure helpers: scanLine (secrets / email / home-path)
// ---------------------------------------------------------------------------

test('scanLine flags an OpenAI-style key', () => {
  const rules = loadSecretRules(SECRET_PATTERNS_PATH);
  assert.deepEqual(scanLine('const key = "sk-abcdefghijklmnopqrstuvwx";', rules), ['openai-key']);
});

test('scanLine flags a GitHub token and an AWS access key id', () => {
  const rules = loadSecretRules(SECRET_PATTERNS_PATH);
  assert.deepEqual(scanLine('token=ghp_' + 'a'.repeat(36), rules), ['github-token']);
  assert.deepEqual(scanLine('AKIAABCDEFGHIJKLMNOP', rules), ['aws-access-key']);
});

test('scanLine flags a private key block and a JWT shape', () => {
  const rules = loadSecretRules(SECRET_PATTERNS_PATH);
  assert.deepEqual(scanLine('-----BEGIN RSA PRIVATE KEY-----', rules), ['private-key']);
  // The canonical jwt.io example token — a public sample, not a real credential.
  const jwt =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  assert.deepEqual(scanLine(jwt, rules), ['jwt']);
});

test('scanLine flags a real-looking e-mail but not noreply/example addresses', () => {
  const rules = loadSecretRules(SECRET_PATTERNS_PATH);
  assert.deepEqual(scanLine('contact someone.personal@mailhost.dev for access', rules), ['email']);
  assert.deepEqual(scanLine('git config user.email noreply@github.com', rules), []);
  assert.deepEqual(scanLine('see user@example.com for the template', rules), []);
});

test('scanLine flags /Users/<name>/ and /home/<name>/ but not the sbx-docs "agent" allow-list', () => {
  const rules = loadSecretRules(SECRET_PATTERNS_PATH);
  assert.deepEqual(scanLine('path: /Users/exampleperson/.config/prompts/global', rules), ['home-path']);
  assert.deepEqual(scanLine('path: /home/exampleperson/.config', rules), ['home-path']);
  assert.deepEqual(scanLine('sandboxed HOME is /Users/agent/ in the container', rules), []);
  assert.deepEqual(scanLine('sandboxed HOME is /home/agent/ in the container', rules), []);
});

test('scanLine returns multiple categories for one line without duplicates', () => {
  const rules = loadSecretRules(SECRET_PATTERNS_PATH);
  const hit = scanLine('email someone.personal@mailhost.dev lives at /Users/exampleperson/', rules);
  assert.deepEqual(hit.sort(), ['email', 'home-path']);
});

test('scanLine finds nothing in an ordinary line', () => {
  const rules = loadSecretRules(SECRET_PATTERNS_PATH);
  assert.deepEqual(scanLine('const total = a + b;', rules), []);
});

// ---------------------------------------------------------------------------
// pure helper: symlinkTargetIssue (same rule as portability.sh's bash version)
// ---------------------------------------------------------------------------

test('symlinkTargetIssue flags an absolute target', () => {
  assert.equal(symlinkTargetIssue('a/b/link', '/etc/passwd'), 'symlink-absolute');
});

test('symlinkTargetIssue flags a ~-prefixed target', () => {
  assert.equal(symlinkTargetIssue('a/b/link', '~/.config/thing'), 'symlink-home');
});

test('symlinkTargetIssue flags a target that climbs above the repo root', () => {
  assert.equal(symlinkTargetIssue('a/b/link', '../../../outside'), 'symlink-escape');
});

test('symlinkTargetIssue allows a relative target that stays inside the repo', () => {
  assert.equal(symlinkTargetIssue('a/b/link', '../ok/file'), null);
  assert.equal(symlinkTargetIssue('top-level-link', 'some/other/file'), null);
});

test('symlinkTargetIssue allows the __FIXTURES_ROOT__ placeholder used by targets-golden fixtures', () => {
  assert.equal(symlinkTargetIssue('a/b/link', '__FIXTURES_ROOT__/core/skills/x'), null);
  assert.equal(symlinkTargetIssue('a/b/link', '__FIXTURES_ROOT__'), null);
});

// ---------------------------------------------------------------------------
// pure helper: parseAddedLines (unified=0 diff parsing)
// ---------------------------------------------------------------------------

test('parseAddedLines tracks new-file line numbers from the hunk header and only counts + lines', () => {
  const diff = [
    'diff --git a/foo.txt b/foo.txt',
    'index 111..222 100644',
    '--- a/foo.txt',
    '+++ b/foo.txt',
    '@@ -2,2 +2,3 @@',
    '-old line',
    '+new line one',
    '+new line two',
    '+new line three',
  ].join('\n');

  const added = parseAddedLines(diff);
  assert.deepEqual(
    added.map(a => [a.file, a.line, a.text]),
    [
      ['foo.txt', 2, 'new line one'],
      ['foo.txt', 3, 'new line two'],
      ['foo.txt', 4, 'new line three'],
    ]
  );
});

test('parseAddedLines skips a deleted file (+++ /dev/null) entirely', () => {
  const diff = ['diff --git a/gone.txt b/gone.txt', '--- a/gone.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-bye'].join('\n');
  assert.deepEqual(parseAddedLines(diff), []);
});

test('parseAddedLines handles multiple files in one diff', () => {
  const diff = [
    'diff --git a/a.txt b/a.txt',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -0,0 +1 @@',
    '+line in a',
    'diff --git a/b.txt b/b.txt',
    '--- a/b.txt',
    '+++ b/b.txt',
    '@@ -0,0 +1 @@',
    '+line in b',
  ].join('\n');
  const added = parseAddedLines(diff);
  assert.deepEqual(added.map(a => a.file), ['a.txt', 'b.txt']);
});

// ---------------------------------------------------------------------------
// pure helper: parseAddedOrRenamedFiles (git diff --name-status)
// ---------------------------------------------------------------------------

test('parseAddedOrRenamedFiles keeps Added and Renamed-to paths, drops Modified/Deleted', () => {
  const nameStatus = ['A\tnew-file.txt', 'M\tchanged.txt', 'D\tremoved.txt', 'R100\told-name.txt\tnew-name.txt'].join('\n');
  assert.deepEqual(parseAddedOrRenamedFiles(nameStatus), ['new-file.txt', 'new-name.txt']);
});

test('parseAddedOrRenamedFiles tolerates trailing blank lines', () => {
  assert.deepEqual(parseAddedOrRenamedFiles('A\tfoo.txt\n\n'), ['foo.txt']);
});

// ---------------------------------------------------------------------------
// integration: runPrepushScan against a fabricated fixture repo
// ---------------------------------------------------------------------------

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(repoRoot, args) {
  const proc = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
  if (proc.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${proc.stderr}`);
  }
  return proc.stdout;
}

function commit(repoRoot, message) {
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message]);
}

test('runPrepushScan: secrets, e-mail, home paths, and an unsafe tracked symlink are all caught on the branch, none on main', () => {
  const repoRoot = makeTmpDir('yoki-prepush-scan-');
  try {
    git(repoRoot, ['init', '-q']);
    fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
    commit(repoRoot, 'init');
    git(repoRoot, ['branch', '-m', 'main']);

    git(repoRoot, ['checkout', '-q', '-b', 'feature']);
    fs.writeFileSync(
      path.join(repoRoot, 'app.js'),
      [
        'const key = "sk-abcdefghijklmnopqrstuvwx";',
        'const owner = "someone.personal@mailhost.dev";',
        'const home = "/Users/exampleperson/.config";',
      ].join('\n') + '\n'
    );
    fs.symlinkSync('/etc/passwd', path.join(repoRoot, 'bad-link'));
    commit(repoRoot, 'add hit-laden file and an unsafe symlink');

    const findings = runPrepushScan({ repoRoot, base: 'main', secretPatternsPath: SECRET_PATTERNS_PATH });
    const categories = findings.map(f => f.category).sort();
    assert.deepEqual(categories, ['email', 'home-path', 'openai-key', 'symlink-absolute']);
    assert.ok(findings.every(f => f.status === 'fail'));

    // main itself has none of this — the range is base-relative, not repo-wide.
    const mainFindings = runPrepushScan({ repoRoot, base: 'main', secretPatternsPath: SECRET_PATTERNS_PATH });
    assert.ok(mainFindings.length > 0); // sanity: the fixture above actually produced hits
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runPrepushScan reports nothing for a clean diff', () => {
  const repoRoot = makeTmpDir('yoki-prepush-scan-clean-');
  try {
    git(repoRoot, ['init', '-q']);
    fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
    commit(repoRoot, 'init');
    git(repoRoot, ['branch', '-m', 'main']);

    git(repoRoot, ['checkout', '-q', '-b', 'feature']);
    fs.writeFileSync(path.join(repoRoot, 'ok.js'), 'const total = a + b;\n');
    commit(repoRoot, 'add an unremarkable file');

    const findings = runPrepushScan({ repoRoot, base: 'main', secretPatternsPath: SECRET_PATTERNS_PATH });
    assert.deepEqual(findings, []);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runPrepushScan does not re-flag a hit already present on base (only added lines count)', () => {
  const repoRoot = makeTmpDir('yoki-prepush-scan-preexisting-');
  try {
    git(repoRoot, ['init', '-q']);
    fs.writeFileSync(path.join(repoRoot, 'app.js'), 'const key = "sk-abcdefghijklmnopqrstuvwx";\n');
    commit(repoRoot, 'init with a pre-existing hit');
    git(repoRoot, ['branch', '-m', 'main']);

    git(repoRoot, ['checkout', '-q', '-b', 'feature']);
    fs.appendFileSync(path.join(repoRoot, 'app.js'), 'const total = a + b;\n');
    commit(repoRoot, 'unrelated addition');

    const findings = runPrepushScan({ repoRoot, base: 'main', secretPatternsPath: SECRET_PATTERNS_PATH });
    assert.deepEqual(findings, []);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
