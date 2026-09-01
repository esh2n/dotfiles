'use strict';
// yoki-prepush: allow-file openai-key,aws-access-key,private-key,jwt,email,home-path
// (the fixtures below have to look like the real thing to exercise the regexes)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  loadSecretRules,
  scanLine,
  isReservedEmail,
  parseAllowMarkers,
  allowedCategoriesAt,
  symlinkTargetIssue,
  parseAddedLines,
  parseTouchedFiles,
  parseNumstat,
  hasTextExtension,
  headSymlinkTarget,
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

test('isReservedEmail: reserved testing TLDs and example.com/.org/.net are not hits', () => {
  for (const address of [
    'a@b.test',
    'someone@corp.example',
    'x@host.invalid',
    'root@localhost.localhost',
    'Viewer@Example.COM',
    'owner@sub.example.org',
    'ops@example.net',
    'noreply@github.com',
    'no-reply@service.io',
  ]) {
    assert.equal(isReservedEmail(address), true, address);
  }
});

test('isReservedEmail: a real-looking domain is still a hit, including look-alikes of the reserved names', () => {
  for (const address of [
    'someone.personal@mailhost.dev',
    'b@x.io',
    'me@example.io',
    'me@testing.dev',
    'me@example.com.evil.dev',
    'me@notexample.com',
  ]) {
    assert.equal(isReservedEmail(address), false, address);
  }
});

test('scanLine treats reserved-TLD and example.* addresses as non-hits by default', () => {
  const rules = loadSecretRules(SECRET_PATTERNS_PATH);
  assert.deepEqual(scanLine('share --to a@b.test --to c@d.test', rules), []);
  assert.deepEqual(scanLine('viewer: Owner@Example.com', rules), []);
  assert.deepEqual(scanLine('viewer: b@x.io', rules), ['email']);
});

test('scanLine flags /Users/<name>/ and /home/<name>/ but not the allow-listed fixture accounts', () => {
  const rules = loadSecretRules(SECRET_PATTERNS_PATH);
  assert.deepEqual(scanLine('path: /Users/somebody/.config/prompts/global', rules), ['home-path']);
  assert.deepEqual(scanLine('path: /home/somebody/.config', rules), ['home-path']);
  assert.deepEqual(scanLine('sandboxed HOME is /Users/agent/ in the container', rules), []);
  assert.deepEqual(scanLine('sandboxed HOME is /home/agent/ in the container', rules), []);
  assert.deepEqual(scanLine("fixture: '/Users/exampleperson/.codex/hooks.json'", rules), []);
  assert.deepEqual(scanLine('HOME: /home/exampleperson/', rules), []);
});

test('scanLine returns multiple categories for one line without duplicates', () => {
  const rules = loadSecretRules(SECRET_PATTERNS_PATH);
  const hit = scanLine('email someone.personal@mailhost.dev lives at /Users/somebody/', rules);
  assert.deepEqual(hit.sort(), ['email', 'home-path']);
});

// ---------------------------------------------------------------------------
// pure helpers: allow markers
// ---------------------------------------------------------------------------

test('parseAllowMarkers reads one or more categories from any comment syntax', () => {
  assert.deepEqual(parseAllowMarkers('const x = 1; // yoki-prepush: allow home-path'), [
    { scope: 'line', categories: ['home-path'] },
  ]);
  assert.deepEqual(parseAllowMarkers('# yoki-prepush: allow email, home-path'), [
    { scope: 'line', categories: ['email', 'home-path'] },
  ]);
  assert.deepEqual(parseAllowMarkers(' * yoki-prepush: allow openai-key,jwt'), [
    { scope: 'line', categories: ['openai-key', 'jwt'] },
  ]);
  assert.deepEqual(parseAllowMarkers('-- yoki-prepush: allow credential-query'), [
    { scope: 'line', categories: ['credential-query'] },
  ]);
  assert.deepEqual(parseAllowMarkers('<!-- yoki-prepush: allow email -->'), [
    { scope: 'line', categories: ['email'] },
  ]);
  assert.deepEqual(parseAllowMarkers('// yoki-prepush: allow-file email,home-path'), [
    { scope: 'file', categories: ['email', 'home-path'] },
  ]);
  assert.deepEqual(parseAllowMarkers('nothing to see here'), []);
  assert.deepEqual(parseAllowMarkers('yoki-prepush: allow'), []); // no category → not a marker
});

test('allowedCategoriesAt: same-line and immediately-preceding-line markers apply, farther ones do not', () => {
  const lines = [
    'line 1',
    '// yoki-prepush: allow home-path',
    'const home = "/Users/somebody/";',
    'const other = "/Users/somebody/";',
    'const key = "x"; // yoki-prepush: allow openai-key',
  ];
  assert.deepEqual([...allowedCategoriesAt(lines, 3)], ['home-path']); // preceding line
  assert.deepEqual([...allowedCategoriesAt(lines, 4)], []); // two lines away: not covered
  assert.deepEqual([...allowedCategoriesAt(lines, 5)], ['openai-key']); // same line
  assert.deepEqual([...allowedCategoriesAt(lines, 1)], []);
});

test('allowedCategoriesAt: allow-file within the first 5 lines covers the whole file, later ones do not', () => {
  const early = ['#!/bin/sh', '# yoki-prepush: allow-file email,home-path', '', '', '', 'x', 'y'];
  assert.deepEqual([...allowedCategoriesAt(early, 7)].sort(), ['email', 'home-path']);
  assert.deepEqual([...allowedCategoriesAt(early, 1)].sort(), ['email', 'home-path']);

  const late = ['', '', '', '', '', '# yoki-prepush: allow-file email', 'x'];
  assert.deepEqual([...allowedCategoriesAt(late, 7)], []);

  // an inline `allow` in the head does not become file-wide, and an
  // `allow-file` on the hit line does not act as an inline marker.
  const mixed = ['// yoki-prepush: allow email', '', '', '', '', 'x // yoki-prepush: allow-file jwt'];
  assert.deepEqual([...allowedCategoriesAt(mixed, 6)], []);
  assert.deepEqual([...allowedCategoriesAt(mixed, 1)], ['email']);
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

test('parseAddedLines does not mistake an added line starting with "++ " for a file header', () => {
  // The exact repro: a doc/patch fixture whose own added content quotes a
  // diff. `++ b/secrets.env` reaches the parser as `+++ b/secrets.env`.
  const diff = [
    'diff --git a/doc.md b/doc.md',
    '--- /dev/null',
    '+++ b/doc.md',
    '@@ -0,0 +1,5 @@',
    '+AKIAIOSFODNN7EXAMPLE',
    '+++ b/secrets.env',
    '+AKIAIOSFODNN7EXAMPLE',
    '++ /dev/null',
    '+AKIAIOSFODNN7EXAMPLE',
  ].join('\n');

  const added = parseAddedLines(diff);
  assert.deepEqual(
    added.map(a => [a.file, a.line, a.text]),
    [
      ['doc.md', 1, 'AKIAIOSFODNN7EXAMPLE'],
      ['doc.md', 2, '++ b/secrets.env'], // scanned as content, attributed to doc.md
      ['doc.md', 3, 'AKIAIOSFODNN7EXAMPLE'],
      ['doc.md', 4, '+ /dev/null'], // "++ /dev/null" must not blank out currentFile
      ['doc.md', 5, 'AKIAIOSFODNN7EXAMPLE'],
    ]
  );
});

test('parseAddedLines does not mistake a removed line starting with "-- " for a file header', () => {
  const diff = [
    'diff --git a/doc.md b/doc.md',
    '--- a/doc.md',
    '+++ b/doc.md',
    '@@ -1,2 +1,1 @@',
    '--- a/quoted.txt',
    '+kept',
  ].join('\n');
  assert.deepEqual(parseAddedLines(diff).map(a => [a.file, a.line, a.text]), [['doc.md', 1, 'kept']]);
});

test('parseAddedLines still honours a real "+++ /dev/null" header (deleted file) after a hunk', () => {
  const diff = [
    'diff --git a/kept.txt b/kept.txt',
    '--- a/kept.txt',
    '+++ b/kept.txt',
    '@@ -0,0 +1 @@',
    '+in kept',
    'diff --git a/gone.txt b/gone.txt',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye',
  ].join('\n');
  assert.deepEqual(parseAddedLines(diff).map(a => [a.file, a.text]), [['kept.txt', 'in kept']]);
});

// ---------------------------------------------------------------------------
// pure helper: parseTouchedFiles (git diff --name-status)
// ---------------------------------------------------------------------------

test('parseTouchedFiles keeps Added, Modified, Typechanged and Renamed-to paths, drops Deleted', () => {
  const nameStatus = [
    'A\tnew-file.txt',
    'M\tchanged.txt',
    'T\tnow-a-symlink',
    'D\tremoved.txt',
    'R100\told-name.txt\tnew-name.txt',
    'C75\tsource.txt\tcopy.txt',
  ].join('\n');
  assert.deepEqual(parseTouchedFiles(nameStatus), [
    'new-file.txt',
    'changed.txt',
    'now-a-symlink',
    'new-name.txt',
    'copy.txt',
  ]);
});

test('parseTouchedFiles tolerates trailing blank lines', () => {
  assert.deepEqual(parseTouchedFiles('A\tfoo.txt\n\n'), ['foo.txt']);
});

// ---------------------------------------------------------------------------
// pure helpers: binary-text guard (parseNumstat / hasTextExtension)
// ---------------------------------------------------------------------------

test('parseNumstat reads counts, binary markers and rename records from -z output', () => {
  const numstat = ['3\t1\tsrc/a.js\0', '-\t-\tassets/logo.png\0', '2\t0\0old/name.md\0new/name.md\0'].join('');
  assert.deepEqual(parseNumstat(numstat), [
    { added: '3', deleted: '1', path: 'src/a.js' },
    { added: '-', deleted: '-', path: 'assets/logo.png' },
    { added: '2', deleted: '0', path: 'new/name.md' },
  ]);
});

test('hasTextExtension covers the reviewable-source extensions and excludes vendored binaries', () => {
  for (const p of ['a.js', 'a.mjs', 'a.ts', 'a.sh', 'a.md', 'a.json', 'a.yaml', 'a.yml', 'a.toml', 'a.nix', 'a.html', 'a.css', 'a.txt', 'a.zsh', 'DIR/B.JSON']) {
    assert.equal(hasTextExtension(p), true, p);
  }
  for (const p of ['logo.png', 'font.woff2', 'clip.mp4', 'blob.bin', 'archive.tar.gz', 'no-extension']) {
    assert.equal(hasTextExtension(p), false, p);
  }
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
        'const home = "/Users/somebody/.config";',
      ].join('\n') + '\n'
    );
    fs.symlinkSync('/etc/passwd', path.join(repoRoot, 'bad-link'));
    commit(repoRoot, 'add hit-laden file and an unsafe symlink');

    const findings = runPrepushScan({ repoRoot, base: 'main', secretPatternsPath: SECRET_PATTERNS_PATH });
    const categories = findings.map(f => f.category).sort();
    assert.deepEqual(categories, ['email', 'home-path', 'openai-key', 'symlink-absolute']);
    assert.ok(findings.every(f => f.status === 'fail'));

    // Standing on main itself, the same scan sees none of it — the range is
    // base-relative, not repo-wide. (Scanning `main...HEAD` from main is the
    // empty range; the hits above live only on the branch.)
    git(repoRoot, ['checkout', '-q', 'main']);
    const mainFindings = runPrepushScan({ repoRoot, base: 'main', secretPatternsPath: SECRET_PATTERNS_PATH });
    assert.deepEqual(mainFindings, []);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runPrepushScan: marked hits come back as [allow], unmarked ones as [fail]', () => {
  const repoRoot = makeTmpDir('yoki-prepush-scan-allow-');
  try {
    git(repoRoot, ['init', '-q']);
    fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
    commit(repoRoot, 'init');
    git(repoRoot, ['branch', '-m', 'main']);

    git(repoRoot, ['checkout', '-q', '-b', 'feature']);
    fs.writeFileSync(
      path.join(repoRoot, 'fixtures.js'),
      [
        '// yoki-prepush: allow-file openai-key',
        'const key = "sk-abcdefghijklmnopqrstuvwx";',
        '// the byte-exact command the golden hash was produced from',
        '// yoki-prepush: allow home-path',
        'const home = "/Users/somebody/.config";',
        'const leak = "someone.else@mailhost.dev";',
        'const mail = "someone.personal@mailhost.dev"; // yoki-prepush: allow email',
        'const other = "/Users/somebody/.local";',
      ].join('\n') + '\n'
    );
    commit(repoRoot, 'add fixtures with markers');

    const findings = runPrepushScan({ repoRoot, base: 'main', secretPatternsPath: SECRET_PATTERNS_PATH });
    assert.deepEqual(
      findings.map(f => [f.status, f.line, f.category]),
      [
        ['allow', 2, 'openai-key'],
        ['allow', 5, 'home-path'], // preceding-line marker
        ['fail', 6, 'email'], // two lines under the home-path marker, and a different category anyway
        ['allow', 7, 'email'], // same-line marker
        ['fail', 8, 'home-path'], // the same-line marker above covers email only
      ]
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runPrepushScan: a marker on a line that is not part of the diff still covers the added line after it', () => {
  const repoRoot = makeTmpDir('yoki-prepush-scan-allow-ctx-');
  try {
    git(repoRoot, ['init', '-q']);
    fs.writeFileSync(path.join(repoRoot, 'app.js'), ['// yoki-prepush: allow home-path', 'const a = 1;'].join('\n') + '\n');
    commit(repoRoot, 'init');
    git(repoRoot, ['branch', '-m', 'main']);

    git(repoRoot, ['checkout', '-q', '-b', 'feature']);
    fs.writeFileSync(
      path.join(repoRoot, 'app.js'),
      ['// yoki-prepush: allow home-path', 'const home = "/Users/somebody/";', 'const a = 1;'].join('\n') + '\n'
    );
    commit(repoRoot, 'insert a marked line under a pre-existing marker');

    const findings = runPrepushScan({ repoRoot, base: 'main', secretPatternsPath: SECRET_PATTERNS_PATH });
    assert.deepEqual(findings.map(f => [f.status, f.line, f.category]), [['allow', 2, 'home-path']]);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runPrepushScan: the CLI exits 0 with [allow] lines when every hit is marked', () => {
  const repoRoot = makeTmpDir('yoki-prepush-scan-allow-cli-');
  try {
    git(repoRoot, ['init', '-q']);
    fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
    commit(repoRoot, 'init');
    git(repoRoot, ['branch', '-m', 'main']);

    git(repoRoot, ['checkout', '-q', '-b', 'feature']);
    fs.writeFileSync(path.join(repoRoot, 'a.sh'), '# yoki-prepush: allow-file home-path\nHOME=/Users/somebody/\n');
    commit(repoRoot, 'marked hit');

    const proc = spawnSync(process.execPath, [path.join(__dirname, '..', 'prepush-scan.js'), '--repo-root', repoRoot], {
      encoding: 'utf8',
    });
    assert.equal(proc.status, 0, proc.stderr);
    assert.equal(proc.stdout, '[allow] a.sh:2 home-path\n[ok] no hits in diff main...HEAD (1 allowed)\n');
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

test('runPrepushScan reads symlinks from HEAD: an uncommitted rm/replace cannot clear the hit', () => {
  const repoRoot = makeTmpDir('yoki-prepush-scan-symlink-head-');
  try {
    git(repoRoot, ['init', '-q']);
    fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
    commit(repoRoot, 'init');
    git(repoRoot, ['branch', '-m', 'main']);

    git(repoRoot, ['checkout', '-q', '-b', 'feature']);
    fs.symlinkSync('/etc/passwd', path.join(repoRoot, 'bad-link'));
    commit(repoRoot, 'commit an unsafe symlink');

    assert.deepEqual(
      runPrepushScan({ repoRoot, base: 'main', secretPatternsPath: SECRET_PATTERNS_PATH }),
      [{ status: 'fail', file: 'bad-link', line: 0, category: 'symlink-absolute' }]
    );

    // The committed object is what `git push` sends: swapping the worktree
    // copy for a harmless regular file must not turn this into an all-clear.
    fs.unlinkSync(path.join(repoRoot, 'bad-link'));
    fs.writeFileSync(path.join(repoRoot, 'bad-link'), 'harmless placeholder\n');
    assert.deepEqual(
      runPrepushScan({ repoRoot, base: 'main', secretPatternsPath: SECRET_PATTERNS_PATH }),
      [{ status: 'fail', file: 'bad-link', line: 0, category: 'symlink-absolute' }]
    );

    // ...and deleting it outright likewise leaves the committed hazard.
    fs.unlinkSync(path.join(repoRoot, 'bad-link'));
    assert.deepEqual(
      runPrepushScan({ repoRoot, base: 'main', secretPatternsPath: SECRET_PATTERNS_PATH }),
      [{ status: 'fail', file: 'bad-link', line: 0, category: 'symlink-absolute' }]
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runPrepushScan flags a typechange (T) into a symlink and a repointed (M) symlink, not just added ones', () => {
  const repoRoot = makeTmpDir('yoki-prepush-scan-symlink-tm-');
  try {
    git(repoRoot, ['init', '-q']);
    fs.mkdirSync(path.join(repoRoot, 'sub'));
    fs.writeFileSync(path.join(repoRoot, 'sub', 'regular.txt'), 'plain file\n');
    fs.writeFileSync(path.join(repoRoot, 'sub', 'inside.txt'), 'target\n');
    fs.symlinkSync('inside.txt', path.join(repoRoot, 'sub', 'safe-link'));
    commit(repoRoot, 'init');
    git(repoRoot, ['branch', '-m', 'main']);

    git(repoRoot, ['checkout', '-q', '-b', 'feature']);
    // T: a tracked regular file becomes a symlink to an absolute path.
    fs.unlinkSync(path.join(repoRoot, 'sub', 'regular.txt'));
    fs.symlinkSync('/etc/hosts', path.join(repoRoot, 'sub', 'regular.txt'));
    // M: an existing safe relative symlink is repointed out of the repo.
    fs.unlinkSync(path.join(repoRoot, 'sub', 'safe-link'));
    fs.symlinkSync('../../../secrets', path.join(repoRoot, 'sub', 'safe-link'));
    commit(repoRoot, 'convert a file to a symlink and repoint an existing one');

    const findings = runPrepushScan({ repoRoot, base: 'main', secretPatternsPath: SECRET_PATTERNS_PATH });
    assert.deepEqual(
      findings.map(f => [f.file, f.category]).sort(),
      [
        ['sub/regular.txt', 'symlink-absolute'],
        ['sub/safe-link', 'symlink-escape'],
      ]
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('headSymlinkTarget returns the committed target and null for a non-symlink', () => {
  const repoRoot = makeTmpDir('yoki-prepush-scan-headsym-');
  try {
    git(repoRoot, ['init', '-q']);
    fs.mkdirSync(path.join(repoRoot, 'nested'));
    fs.writeFileSync(path.join(repoRoot, 'nested', 'file.txt'), 'x\n');
    fs.symlinkSync('/etc/passwd', path.join(repoRoot, 'nested', 'link'));
    commit(repoRoot, 'init');

    assert.equal(headSymlinkTarget(repoRoot, 'nested/link'), '/etc/passwd');
    assert.equal(headSymlinkTarget(repoRoot, 'nested/file.txt'), null);
    assert.equal(headSymlinkTarget(repoRoot, 'nested/missing'), null);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runPrepushScan fails a text-extension file git classifies as binary (it bypasses the line scan)', () => {
  const repoRoot = makeTmpDir('yoki-prepush-scan-binary-text-');
  try {
    git(repoRoot, ['init', '-q']);
    fs.writeFileSync(path.join(repoRoot, 'README.md'), 'hello\n');
    commit(repoRoot, 'init');
    git(repoRoot, ['branch', '-m', 'main']);

    git(repoRoot, ['checkout', '-q', '-b', 'feature']);
    // A stray NUL is enough for git to call the whole file binary — the diff
    // then carries no `+` lines at all, so this secret is invisible to the
    // text scan. Exactly how a committed .js file once hid its own diff.
    fs.writeFileSync(
      path.join(repoRoot, 'lib.js'),
      // NUL written as an escape so this test file itself stays text.
      `const sep = "\u0000";\nconst key = "sk-abcdefghijklmnopqrstuvwx";\n`
    );
    // a real binary asset must NOT be flagged
    fs.writeFileSync(path.join(repoRoot, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
    commit(repoRoot, 'add a NUL-bearing js file and a png');

    const findings = runPrepushScan({ repoRoot, base: 'main', secretPatternsPath: SECRET_PATTERNS_PATH });
    assert.deepEqual(findings, [{ status: 'fail', file: 'lib.js', line: 0, category: 'binary-text' }]);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runPrepushScan does NOT flag binary-text when the range repairs a NUL-bearing file', () => {
  const repoRoot = makeTmpDir('yoki-prepush-scan-binary-text-fix-');
  try {
    git(repoRoot, ['init', '-q']);
    // base already carries the damaged file...
    fs.writeFileSync(path.join(repoRoot, 'lib.js'), 'const sep = "\u0000";\n');
    commit(repoRoot, 'init with a NUL-bearing file');
    git(repoRoot, ['branch', '-m', 'main']);

    // ...and this branch fixes it. `git diff --numstat` still says `-\t-`
    // (the OLD side is binary), so the finding must be gated on HEAD's blob.
    git(repoRoot, ['checkout', '-q', '-b', 'feature']);
    fs.writeFileSync(path.join(repoRoot, 'lib.js'), 'const sep = "\\u0000";\n');
    commit(repoRoot, 'replace the literal NUL with an escape');

    const numstat = git(repoRoot, ['diff', '--numstat', 'main...HEAD']);
    assert.match(numstat, /^-\t-\tlib\.js$/m, 'precondition: git still reports the pair as binary');

    assert.deepEqual(runPrepushScan({ repoRoot, base: 'main', secretPatternsPath: SECRET_PATTERNS_PATH }), []);
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
